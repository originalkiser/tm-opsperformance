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
export function historicalUsage(logs, locationId) {
  const aliases = new Map()
  const tokenRows = logs.map(row => {
    const raw = row.employee_name
    if (typeof raw !== 'string' || !raw.trim()) return row
    if (!aliases.has(raw)) aliases.set(raw, { original_name: raw, appearances: 0, last_date: null, token: `alias${aliases.size}` })
    const entry = aliases.get(raw)
    entry.appearances++
    entry.last_date = !entry.last_date || row.log_date > entry.last_date ? row.log_date : entry.last_date
    return { ...row, employee_name: entry.token }
  })
  const calculated = buildEmployeePerformance(tokenRows, [{ id: locationId, name: 'Location', opportunities_formula: 'detailed' }], allHistory)
  const totals = new Map(calculated.rows.map(row => [row.name, row.ms]))
  return { aliases: [...aliases.values()].map(({ token, ...row }) => ({ ...row, memberships: totals.get(token) ?? null })).sort((a, b) => a.original_name.localeCompare(b.original_name)) }
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
