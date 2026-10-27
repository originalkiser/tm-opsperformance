import { employeeNameKey, readLocationEmployees } from './employeeIdentity.js'

// Collapse duplicate display names, not people or activity. Persist the selected
// roster spelling exactly; the UUID only breaks ties deterministically in the UI.
export function activeEmployeeOptions(rows, locationId) {
  const names = new Map()
  for (const row of [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const key = employeeNameKey(row.name)
    if (row.location_id === locationId && row.is_active === true && key && !names.has(key)) names.set(key, row)
  }
  return [...names.values()].sort((a, b) => employeeNameKey(a.name).localeCompare(employeeNameKey(b.name)))
}

export async function loadDailyLogEmployees(client, locationId) {
  return activeEmployeeOptions(await readLocationEmployees(client, locationId), locationId)
}

export function resolvePastedEmployee(name, previous, employees) {
  // Blank paste cells never erase a recorded name. Preserve historical spelling.
  if (!name || employeeNameKey(name) === employeeNameKey(previous)) return previous
  const match = employees.find(e => employeeNameKey(e.name) === employeeNameKey(name))
  if (!match) throw new Error(`“${name}” is not an active roster name. Review the Employees tab before pasting.`)
  return match.name
}

// Existing checkpoints use PATCH so an unrelated edit cannot overwrite a name
// changed in another session. New checkpoints INSERT: a unique-key conflict asks
// the user to reload instead of overwriting somebody else's checkpoint.
export async function saveDailyLogCheckpoint(client, row, payload) {
  const { employee_id: ignoredId, employee_name: ignoredName, ...fields } = payload
  // Undo may restore the exact name originally loaded for this checkpoint.
  // It cannot introduce another inactive/unmatched name.
  const previous = row._savedEmployeeName ?? ''
  const nameChanged = (row.employee_name || '') !== previous
  if (nameChanged && row.employee_name !== row._recordedEmployeeName) {
    const active = await loadDailyLogEmployees(client, fields.location_id)
    if (!active.some(e => e.name === row.employee_name)) {
      throw new Error('Employee is no longer on the active roster. Choose an active name or review the Employees tab; this checkpoint was not saved.')
    }
  }
  let request
  if (row.id) {
    request = client.from('daily_logs').update({ ...fields, ...(nameChanged ? { employee_name: row.employee_name } : {}) })
      .eq('id', row.id).eq('location_id', fields.location_id).eq('log_date', fields.log_date)
    if (nameChanged) request = previous ? request.eq('employee_name', previous) : request.or('employee_name.is.null,employee_name.eq.')
  } else {
    request = client.from('daily_logs').insert({ ...fields, employee_name: row.employee_name || null })
  }
  const { data, error } = await request.select('id, employee_name').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This checkpoint changed in another session. Reload this date before saving again.')
  return data
}


const checkpointKey = row => `${row.time_slot}|${row.split_index ?? 0}`
const conflict = () => new Error('This checkpoint changed in another session. Reload this date before saving again.')
const same = (a, b) => a === b || (a == null && b == null)

// One queue per mounted location/business date, shared by hourly and loss writes.
// Intents survive removal from the visible array. A completed DELETE retains its
// original record for Undo; an external deletion never grants permission to INSERT.
export function dailyLogPersistence(client, locationId, date, onSaved = () => {}) {
  const entries = new Map()
  let queue = Promise.resolve()
  const scope = request => request.eq('location_id', locationId).eq('log_date', date)
  const checked = async request => {
    const { data, error } = await request
    if (error) throw error
    return data
  }
  const cas = (request, record) => {
    for (const [key, value] of Object.entries(record)) {
      if (value === null) request = request.is(key, null)
      else request = request.eq(key, value)
    }
    return request
  }
  const enqueue = task => {
    const pending = queue.catch(() => {}).then(task)
    queue = pending
    return pending
  }
  const entryFor = row => {
    const key = checkpointKey(row)
    if (!entries.has(key)) entries.set(key, { key, server: null, deleted: null,
      desired: null, revision: 0, applied: 0, originalName: null, insertId: crypto.randomUUID() })
    return entries.get(key)
  }
  const fresh = async entry => {
    if (!entry.server) return null
    const record = await checked(scope(client.from('daily_logs').select('*')).eq('id', entry.server.id).maybeSingle())
    if (!record) throw conflict()
    return record
  }
  const commit = (entry, record, intent, revision) => {
    entry.server = record
    entry.applied = revision
    onSaved(entry.key, record, intent)
  }
  async function drain(entry) {
    while (entry.applied !== entry.revision) {
      const revision = entry.revision, intent = entry.desired && { ...entry.desired }
      const baseline = entry.server
      if (!intent) {
        if (!baseline) {
          if (entry.uncertainInsert) {
            const owned = await checked(scope(client.from('daily_logs').select('*')).eq('id', entry.uncertainInsert.id).maybeSingle())
            if (!owned || Object.keys(entry.uncertainInsert).some(key => !same(entry.uncertainInsert[key], owned[key]))) {
              throw new Error('The previous save outcome is unresolved. Reopen this date and reconcile before continuing.')
            }
            entry.server = owned
            entry.uncertainInsert = null
            continue
          }
          entry.applied = revision
          continue
        }
        const record = await fresh(entry)
        // Deletion removes the whole checkpoint, so every stored field matters.
        if (Object.keys(baseline).some(k => !same(record[k], baseline[k]))) throw conflict()
        if (record.plans_lost_today != null) throw new Error('Daily plans lost must be retained; clear hourly activity instead.')
        // The existing trigger cannot reinsert manual Net Members after daily
        // losses are adopted. Keep that checkpoint rather than destroy Undo data.
        if (Number(record.net_members) !== 0) {
          const anchor = await checked(scope(client.from('daily_logs').select('*')).eq('time_slot', '08:00:00').eq('split_index', 0).maybeSingle())
          if (anchor?.plans_lost_today != null) throw new Error('This historical Net Members checkpoint cannot be safely deleted on a calculated day.')
        }
        const removed = await checked(cas(scope(client.from('daily_logs').delete()), record).select('*').maybeSingle())
        if (!removed) throw conflict()
        entry.deleted = { ...record }
        commit(entry, null, intent, revision)
        continue
      }
      const { employee_name: requestedName, ...fields } = intent
      if (!baseline) {
        const restore = entry.deleted
        const name = restore ? ((requestedName ?? '') === (entry.originalName ?? '') ? entry.originalName : requestedName) : requestedName || null
        if (name && name !== entry.originalName && name !== restore?.employee_name) {
          const active = await loadDailyLogEmployees(client, locationId)
          if (!active.some(e => e.name === name)) throw new Error('Employee is no longer on the active roster. Review the Employees tab.')
        }
        const body = restore ? { ...restore, employee_name: name } : { ...fields, employee_name: name, id: entry.insertId }
        if (restore) {
          const raw = ['google_reviews', 'total_washes', 'member_washes', 'basic', 'good', 'better', 'best', 'reactivations']
          const changed = raw.filter(key => key in fields && Number(fields[key]) !== Number(restore[key]))
          for (const key of changed) body[key] = fields[key]
          if (changed.length) { body.memberships_sold = fields.memberships_sold; body.opportunities = fields.opportunities }
        }
        let record
        entry.uncertainInsert = body
        try {
          record = await checked(client.from('daily_logs').insert(body).select('*').maybeSingle())
        } catch (error) {
          // A response may be lost after INSERT committed. Only our own UUID and
          // exact payload can reconcile that outcome; never adopt a foreign row.
          const owned = await checked(scope(client.from('daily_logs').select('*')).eq('id', body.id).maybeSingle())
          if (!owned || Object.keys(body).some(key => !same(body[key], owned[key]))) {
            if (error.code) entry.uncertainInsert = null
            throw error
          }
          record = owned
        }
        if (!record) throw conflict()
        entry.uncertainInsert = null
        commit(entry, record, intent, revision)
      } else {
        const record = await fresh(entry)
        // Cumulative counters and their derived values form one checkpoint.
        // A concurrent activity/identity change requires reconciliation; only an
        // unrelated display-name change can be safely carried through this edit.
        if (Object.keys(baseline).some(key => !['employee_name', 'updated_at'].includes(key) && !same(record[key], baseline[key]))) throw conflict()
        const patch = {}
        for (const [key, value] of Object.entries(fields)) {
          if (['location_id', 'log_date', 'time_slot', 'split_index'].includes(key)) continue
          if (!same(value, baseline[key])) {
            if (!same(record[key], baseline[key])) throw conflict()
            patch[key] = value
          }
        }
        const nameChanged = (requestedName ?? '') !== (baseline.employee_name ?? '')
        if (nameChanged) {
          if (!same(record.employee_name, baseline.employee_name)) throw conflict()
          if ((requestedName ?? '') !== (entry.originalName ?? '')) {
            const active = await loadDailyLogEmployees(client, locationId)
            if (!active.some(e => e.name === requestedName)) throw new Error('Employee is no longer on the active roster. Review the Employees tab.')
          }
          patch.employee_name = (requestedName ?? '') === (entry.originalName ?? '') ? entry.originalName : requestedName
        }
        const saved = Object.keys(patch).length
          ? await checked(cas(scope(client.from('daily_logs').update(patch)), record).select('*').maybeSingle()) : record
        if (!saved) throw conflict()
        // A later intent is relative to the local version it saw. Rebase only
        // fields this request actually wrote, never unrelated external changes.
        if (entry.revision !== revision && entry.desired) {
          for (const [key, value] of Object.entries(record)) {
            if (key in intent && !(key in patch) && same(entry.desired[key], intent[key])) entry.desired[key] = saved[key]
          }
        }
        commit(entry, saved, intent, revision)
      }
    }
  }
  return {
    load(records) {
      for (const row of records) {
        const entry = entryFor(row)
        entry.server = { ...row }
        entry.originalName = row.employee_name ?? null
      }
    },
    stage(row, payload) {
      const entry = entryFor(row)
      entry.desired = payload ? { ...payload, employee_name: row.employee_name ?? null } : null
      entry.revision++
      return entry.key
    },
    flush() { return enqueue(async () => {
      const errors = []
      for (const entry of entries.values()) { try { await drain(entry) } catch (error) { errors.push(error) } }
      if (errors.length) throw errors[0]
    }) },
    loss(value) {
      return enqueue(async () => {
        const row = { time_slot: '08:00:00', split_index: 0 }
        const entry = entryFor(row)
        const record = await checked(scope(client.from('daily_logs').select('*')).eq('time_slot', row.time_slot).eq('split_index', 0).maybeSingle())
        if ((record && !entry.server) || (entry.server && (!record || record.id !== entry.server.id || !same(record.plans_lost_today, entry.server.plans_lost_today)))) throw conflict()
        const request = record
          ? cas(scope(client.from('daily_logs').update({ plans_lost_today: value })), record)
          : client.from('daily_logs').insert({ location_id: locationId, log_date: date, ...row, plans_lost_today: value })
        const saved = await checked(request.select('*').maybeSingle())
        if (!saved) throw conflict()
        entry.server = entry.server ? { ...entry.server, plans_lost_today: saved.plans_lost_today, updated_at: saved.updated_at } : saved
        onSaved(entry.key, saved, null)
        return saved
      })
    },
  }
}
