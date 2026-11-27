import { buildEmployeePerformance, fetchEmployeeLogs } from './employeePerformance.js'
export const allHistory = { start: '0001-01-01', end: '9999-12-31' }

export async function readMappings(client, locationIds, approvedOnly = false) {
  if (!locationIds.length) return []
  if (approvedOnly) {
    const { data, error } = await client.rpc('approved_employee_name_mappings', { location_ids: locationIds })
    if (error) throw error
    if (!Array.isArray(data) || data.some(row => !row.id || !['approved', 'locked'].includes(row.status) || !locationIds.includes(row.location_id))
      || new Set(data.map(row => row.id)).size !== data.length) throw new Error('Approved mappings could not be verified. Reload.')
    return data
  }
  const result = [], seen = new Set()
  let expected = null
  for (let offset = 0;;) {
    let query = client.from('employee_name_mappings').select('*, employees!employee_name_mappings_employee_id_fkey(name)', { count: 'exact' })
      .in('location_id', locationIds)
    const { data, error, count } = await query.order('id').range(offset, offset + 499)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || (expected !== null && count !== expected)) throw new Error('Mappings changed or could not be fully loaded. Reload.')
    expected = count
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error('Duplicate or missing mapping identity. Reload.')
      seen.add(row.id)
      result.push({ ...row, employee_name: row.employees?.name })
    }
    offset += data.length
    if (offset === count) return result
    if (!data.length || offset > count) throw new Error('Incomplete mapping read. Reload.')
  }
}

// Each exact recorded spelling has its own inventory row. Membership sales use
// the unchanged Team Sales cumulative-delta/correction rules, never raw sums.
export function historicalUsage(logs, locationId, range = allHistory) {
  const aliases = new Map()
  const tokenRows = logs.map(row => {
    const raw = row.employee_name
    if (typeof raw !== 'string' || !raw.trim()) return row
    if (!aliases.has(raw)) aliases.set(raw, { original_name: raw, appearances: 0, last_date: null, token: `alias${aliases.size}` })
    const entry = aliases.get(raw)
    if (row.log_date < range.start || row.log_date > range.end) return { ...row, employee_name: entry.token }
    entry.appearances++
    entry.first_date = !entry.first_date || row.log_date < entry.first_date ? row.log_date : entry.first_date
    entry.last_date = !entry.last_date || row.log_date > entry.last_date ? row.log_date : entry.last_date
    return { ...row, employee_name: entry.token }
  })
  const calculated = buildEmployeePerformance(tokenRows, [{ id: locationId, name: 'Location', opportunities_formula: 'detailed' }], range)
  const totals = new Map(calculated.rows.map(row => [row.name, row.ms]))
  return { aliases: [...aliases.values()].filter(row => row.appearances).map(({ token, ...row }) => ({ ...row, memberships: totals.get(token) ?? null })).sort((a, b) => a.original_name.localeCompare(b.original_name)) }
}

export function rosterHistoricalUsage(logs, employee) {
  const exact = logs.filter(row => row.employee_id === employee.id)
  const shared = logs.filter(row => !row.employee_id && row.employee_name?.trim().toLowerCase() === employee.name.trim().toLowerCase())
  const tokens = logs.map(row => ({ ...row, employee_name: row.employee_id === employee.id ? 'selected-id'
    : !row.employee_id && row.employee_name?.trim().toLowerCase() === employee.name.trim().toLowerCase() ? 'shared-name'
      : row.employee_name?.trim() ? 'other-record' : row.employee_name }))
  const totals = buildEmployeePerformance(tokens, [{ id: employee.location_id, name: 'Location' }], allHistory).rows
  const linkedSales = totals.find(row => row.name === 'selected-id')?.ms
  const sharedSales = totals.find(row => row.name === 'shared-name')?.ms
  return { appearances: exact.length, memberships: exact.length ? linkedSales ?? null : 0,
    last_date: exact.map(row => row.log_date).sort().at(-1) || null, shared_name_appearances: shared.length,
    shared_name_memberships: shared.length ? sharedSales ?? null : 0 }
}

export async function loadMappingHistory(client, locationId) {
  const { data, error } = await client.rpc('can_propose_employee_mapping', { loc_id: locationId })
  if (error) throw error
  if (data !== true) throw new Error('Your active Admin or Store account is not assigned to this location.')
  const [logs, mappings] = await Promise.all([
    fetchEmployeeLogs(client, [locationId], allHistory), readMappings(client, [locationId]),
  ])
  return { logs, mappings }
}

export async function changeMapping(client, { action, locationId, mapping, originalName, employeeId, startDate, endDate, note, confirmed }) {
  if (!note?.trim()) throw new Error('Enter a reason or evidence for this mapping decision.')
  if (['propose', 'approve', 'correct', 'lock'].includes(action) && confirmed !== true) throw new Error('Confirm that all activity within these dates belongs to the selected employee.')
  if (startDate && endDate && startDate > endDate) throw new Error('The start date must not follow the end date.')
  const { data, error } = await client.rpc('change_employee_name_mapping', {
    operation: action, loc_id: locationId, mapping_id: mapping?.id || null,
    expected_version: mapping?.version ?? null, recorded_name: originalName ?? mapping?.original_name ?? null,
    target_id: employeeId || mapping?.employee_id || null, from_date: startDate || null,
    through_date: endDate || null, reason: note.trim(), identity_confirmed: confirmed === true,
  })
  if (error) throw error
  return data
}

export async function readMappingAudit(client, mappingId) {
  const { data, error } = await client.from('employee_name_mapping_audit').select('*')
    .eq('mapping_id', mappingId).order('id', { ascending: false }).limit(100)
  if (error) throw error
  return data
}

export function consolidationPreview(logs, locationId, selected, start, end) {
  const aliases = historicalUsage(logs, locationId, { start: start || allHistory.start, end: end || allHistory.end })
    .aliases.filter(alias => selected.includes(alias.original_name))
  return {
    aliases,
    appearances: aliases.reduce((count, alias) => count + alias.appearances, 0),
    sales: aliases.some(alias => alias.memberships == null) || !aliases.length
      ? null : aliases.reduce((count, alias) => count + alias.memberships, 0),
  }
}

export async function employeeConsolidation(client, locationId, action, payload = {}) {
  const { data, error } = await client.rpc('employee_identity_consolidation', { loc_id: locationId, action, payload })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data
}

export function consolidationSuggestions(logs, roster) {
  const ids = new Set(roster.map(row => row.id))
  const names = new Set(roster.map(row => row.name?.trim().toLowerCase()).filter(Boolean))
  const result = new Map()
  for (const row of logs) {
    const name = row.employee_name
    if (!name?.trim()) continue
    const linked = row.employee_id && ids.has(row.employee_id)
    const nameOnly = !row.employee_id && names.has(name.trim().toLowerCase())
    if (!linked && !nameOnly) continue
    const match = result.get(name) ?? { linked: 0, nameOnly: 0 }
    if (linked) match.linked++
    else match.nameOnly++
    result.set(name, match)
  }
  return result
}

const checkpointFields = ['id','log_date','time_slot','split_index','employee_id','employee_name',
  'total_washes','member_washes','basic','good','better','best','google_reviews']

// Every checkpoint on a selected day affects cumulative attribution, even
// when it belongs to another name. Use the same string-array encoding as SQL.
export async function consolidationCheckpointDigest(logs, aliases) {
  const days = new Set(logs.filter(row => aliases.some(alias => row.employee_name === alias.name &&
    row.log_date >= alias.start && row.log_date <= alias.end)).map(row => row.log_date))
  const rows = logs.filter(row => days.has(row.log_date)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const encoded = '[' + rows.map(row => '[' + checkpointFields.map(key =>
    JSON.stringify(row[key] == null ? null : String(row[key]))).join(', ') + ']').join(', ') + ']'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('')
}
