import { employeeDeltasByDay } from './logMath.js'

const COUNTS = ['total_washes', 'member_washes', 'basic', 'good', 'better', 'best']
const integer = v => v !== null && v !== undefined && String(v).trim() !== '' && typeof v !== 'boolean' && Number.isSafeInteger(Number(v)) && Number(v) >= 0
const round = v => Math.round(v * 10) / 10
const sales = row => ['basic', 'good', 'better', 'best'].reduce((sum, key) => sum + Number(row[key]), 0)
// Keep the existing ending-checkpoint attribution. Missing hours/days do not
// imply missing work. A real cumulative decrease only makes earlier positive
// contributors to that counter ambiguous; never charge its entering employee.
export function inspectEmployeeDay(rows) {
  const sorted = [...rows].sort((a, b) => String(a.time_slot).localeCompare(String(b.time_slot)) || Number(a.split_index ?? 0) - Number(b.split_index ?? 0))
  const previous = Object.fromEntries(COUNTS.map(key => [key, 0]))
  const contributors = Object.fromEntries(COUNTS.map(key => [key, new Set()]))
  const uncertain = new Map(), issues = new Set()
  const missing = new Set()
  const mark = (name, key) => {
    if (!name) return
    if (!uncertain.has(name)) uncertain.set(name, new Set())
    uncertain.get(name).add(key)
  }
  const normalized = sorted.map(row => {
    const current = { ...row }, name = row.employee_name?.trim().toLowerCase()
    for (const key of COUNTS) {
      // An absent field is not an explicit reset to zero.
      if (row[key] == null || String(row[key]).trim() === '') {
        current[key] = previous[key]
        mark(name, key)
        missing.add(key)
        issues.add('Missing cumulative count; employee attribution is unknown')
      }
      else if (!integer(row[key])) {
        current[key] = previous[key]
        mark(name, key)
        missing.add(key)
        issues.add('Invalid cumulative count; employee attribution is unknown')
      } else current[key] = Number(row[key])
      const delta = current[key] - previous[key]
      if (integer(row[key])) {
        if (missing.has(key) && delta !== 0) mark(name, key)
        missing.delete(key)
      }
      if (delta < 0) {
        contributors[key].forEach(owner => mark(owner, key))
        issues.add('Cumulative counts decreased; earlier contributor attribution is unknown')
      } else if (delta > 0) {
        if (name) contributors[key].add(name)
        else issues.add('Recorded activity has no employee name; not attributed')
      }
      previous[key] = current[key]
    }
    return current
  })
  return { reliable: uncertain.size === 0, issues: [...issues], uncertain, rows: normalized }
}

export function buildEmployeePerformance(data, locations, range) {
  const locationMap = new Map(locations.map(l => [l.id, l]))
  const days = new Map(), employees = new Map(), attributionNotes = []
  const seenIds = new Map(), ambiguousIds = new Set()
  const ensure = (locationId, rawName) => {
    const name = rawName?.trim()
    if (!name) return null
    const key = `${locationId}::${name.toLowerCase()}`
    if (!employees.has(key)) employees.set(key, { key, name, locationId, site: locationMap.get(locationId).name,
      formula: locationMap.get(locationId).opportunities_formula ?? 'detailed',
      total_washes: 0, member_washes: 0, google_reviews: 0, basic: 0, good: 0, better: 0, best: 0,
      uncertain: new Set(), issues: [] })
    return employees.get(key)
  }
  for (const row of data) {
    if (!locationMap.has(row.location_id) || row.log_date < range.start || row.log_date > range.end) continue
    if (row.id && seenIds.has(row.id)) {
      // Repeated identical read rows are not additional activity.
      const prior = seenIds.get(row.id)
      if (['location_id', 'log_date', 'time_slot', 'split_index', 'employee_name', ...COUNTS].every(k => prior[k] === row[k])) continue
      // Keep conflicting copies so both affected days are withheld below.
      ambiguousIds.add(row.id)
    } else if (row.id) seenIds.set(row.id, row)
    const key = `${row.location_id}:${row.log_date}`
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(row)
    ensure(row.location_id, row.employee_name)
  }
  for (const day of days.values()) {
    const locationId = day[0].location_id, date = day[0].log_date
    const check = inspectEmployeeDay(day)
    const checkpoints = new Set()
    if (day.some(row => row.id && ambiguousIds.has(row.id)) || day.some(row => {
      const key = `${row.time_slot}:${row.split_index ?? 0}`
      if (checkpoints.has(key)) return true
      checkpoints.add(key)
      return false
    })) {
      check.issues.push('Duplicate checkpoint or conflicting record identity; employee attribution is ambiguous')
      for (const row of day) if (row.employee_name?.trim()) check.uncertain.set(row.employee_name.trim().toLowerCase(), new Set(COUNTS))
    }
    if (check.issues.length) attributionNotes.push({ locationId, site: locationMap.get(locationId).name, date, issues: check.issues })
    for (const [name, delta] of Object.entries(employeeDeltasByDay(check.rows))) {
      const employee = ensure(locationId, name)
      for (const key of [...COUNTS, 'google_reviews']) employee[key] += delta[key]
    }
    for (const [name, fields] of check.uncertain) {
      const employee = ensure(locationId, name)
      fields.forEach(key => employee.uncertain.add(key))
      employee.issues.push(`${date}: Missing, correction, or invalid count leaves ${[...fields].join(', ')} attribution unresolved`)
    }
  }
  const rows = [...employees.values()].map(e => {
    // Withhold only unresolved metrics, rather than displaying clipped,
    // inflated totals or guessing which prior employee owns a correction.
    const values = Object.fromEntries(COUNTS.map(key => [key, e.uncertain.has(key) ? null : e[key]]))
    const ms = ['basic', 'good', 'better', 'best'].some(key => values[key] == null) ? null : sales(values)
    const validFormula = ['simple', 'detailed'].includes(e.formula)
    const opp = !validFormula || values.total_washes == null || values.member_washes == null || (e.formula === 'detailed' && ms == null)
      ? null : Math.max(0, values.total_washes - values.member_washes + (e.formula === 'detailed' ? ms : 0))
    const issues = [...e.issues]
    if (!validFormula) issues.push('Unknown opportunity formula')
    const rate = ms == null || opp == null ? null : opp > 0 ? ms / opp : ms === 0 ? 0 : null
    if (ms > 0 && opp === 0) issues.push('Positive sales with zero opportunities; conversion is undefined')
    const mix = ms == null ? null : ms > 0 ? (e.better + e.best) / ms : 0
    return { ...e, ...values, ms, opp, gr: e.google_reviews,
      pmixN: mix == null ? null : round(mix * 100), convN: rate == null ? null : round(rate * 100),
      p_mix: mix == null ? '—' : `${round(mix * 100).toFixed(1)}%`, conversion: rate == null ? '—' : `${round(rate * 100).toFixed(1)}%`,
      rate, mix, partial: e.uncertain.size > 0, issues, eligible: issues.length === 0,
      score: null, rank: null, contributions: null }
  })
  const qualificationSize = Math.ceil(rows.length / 2)
  const cutoff = key => {
    const known = rows.map(r => r[key]).filter(v => v != null).sort((a, b) => b - a)
    return known.length ? known[Math.min(qualificationSize, known.length) - 1] : null
  }
  const cutoffs = { sales: cutoff('ms'), opportunities: cutoff('opp') }
  for (const row of rows) {
    row.qualified = (row.ms != null && cutoffs.sales != null && row.ms >= cutoffs.sales) ||
      (row.opp != null && cutoffs.opportunities != null && row.opp >= cutoffs.opportunities)
    row.contributions = { sales: row.ms, conversion: row.convN, pmix: row.pmixN }
    row.score = Object.values(row.contributions).every(v => v != null)
      ? round(row.ms + row.convN + row.pmixN) : null
  }
  let previousScore = null, rank = 0
  rows.filter(r => r.qualified && r.score != null).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).forEach((r, i) => {
    if (r.score !== previousScore) rank = i + 1
    r.rank = rank; previousScore = r.score
  })
  return { rows, attributionNotes, cutoffs, population: rows.length, qualificationSize }
}

export function sortEmployeeRows(rows, sort) {
  const direction = sort.dir === 'asc' ? 1 : -1
  const key = sort.col === 'conversion' ? 'rate' : sort.col === 'p_mix' ? 'mix' : sort.col
  return [...rows].sort((a, b) => {
    if (['name', 'site'].includes(key)) return direction * (a[key] || '').localeCompare(b[key] || '') || a.key.localeCompare(b.key)
    if (a[key] == null || b[key] == null) return a[key] == null ? b[key] == null ? a.key.localeCompare(b.key) : 1 : -1
    return direction * (a[key] - b[key]) || a.key.localeCompare(b.key)
  })
}
export const employeeRankLabel = row => !row.qualified ? 'Not Qualified' : row.rank == null ? 'Qualified · Incomplete data' : String(row.rank)

// Team Sales needs a complete read before qualification and ranks are meaningful.
// Advance by actual page size (PostgREST can cap below the requested range).
export async function fetchEmployeeLogs(client, locationIds, range) {
  if (!locationIds.length) return []
  const rows = [], seen = new Set()
  let expected = null
  for (let offset = 0;;) {
    const { data, error, count } = await client.from('daily_logs').select('*', { count: 'exact' })
      .in('location_id', locationIds).gte('log_date', range.start).lte('log_date', range.end)
      .order('id').range(offset, offset + 499)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw new Error('Team Sales read completeness could not be verified.')
    if (expected !== null && count !== expected) throw new Error('Team Sales records changed while loading. Reload before scoring.')
    expected = count
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error('Team Sales returned missing or duplicate record identities.')
      seen.add(row.id)
    }
    rows.push(...data); offset += data.length
    if (offset === expected) return rows
    if (!data.length || offset > expected) throw new Error('Team Sales returned an incomplete record set.')
  }
}
