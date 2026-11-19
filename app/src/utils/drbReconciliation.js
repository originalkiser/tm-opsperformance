import { readDrbWorkbook } from './drbWorkbook.js'
import { buildEmployeePerformance } from './employeePerformance.js'

export const saleActivities = ['unknown', 'new', 'renewal', 'reactivation', 'replacement', 'refund', 'void']
export const saleDecisions = ['pending', 'eligible', 'excluded']
const reviewErrors = new Set([
  'Previously imported file has different content or coverage',
  'Repeated Site + Sale ID requires a verified line identifier',
  'Transaction identity conflict; no import saved',
  'Conflicting source observation; no import saved',
  'Site must match exactly one location',
  'Mapping changed; reload', 'Transaction changed; reload',
  'Overlapping employee mapping; resolve before approval',
  'Confirm transaction identity before deciding',
  'Reviewed commission evidence and activity classification required',
  'Original full employee identifier required',
  'Reviewed identifier changed or shortened; exclusion evidence must not become eligible',
  'Exactly one approved employee mapping required',
  'This activity cannot be marked commission eligible',
  'Select at most 93 days', 'Narrow the reporting period to 5,000 transactions',
])
export function reconciliationError(error) {
  if (error?.code === '42501') return 'Sales reviewer access required.'
  // Allow only fixed server messages; database details may contain source data.
  return reviewErrors.has(error?.message) ? error.message : 'The operation could not be completed. Reload; check report structure, identity conflicts, approval requirements or changed revisions.'
}
const text = v => String(v ?? '').trim()
const fail = message => { throw new Error(message) }
export function drbDate(value) {
  const s = text(value), m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: .*|$)/)
  const date = m ? `${m[3]}-${m[1]}-${m[2]}` : s
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < '2000-01-01' || date > '2100-12-31') fail('Invalid report date.')
  return date
}
export function parseDrbTransactions(matrix, kind, start, end) {
  if (!['original', 'reviewed'].includes(kind)) fail('Choose original sales or reviewed commissions.')
  start = drbDate(start); end = drbDate(end)
  if (start > end) fail('Invalid reporting period.')
  const required = ['SITENUMBER', 'LOGDATE', 'SALEID', 'ITEM_NAME', 'CUST_ALTPHONE', 'COMMISSION']
  const header = matrix[0]?.map(text) || []
  if (required.some(h => header.filter(v => v === h).length !== 1) || new Set(header).size !== header.length) fail('Expected a transaction-level DRB Wash Commissions export, not a General Sales summary.')
  if (matrix.length > 20001) fail('Import at most 20,000 rows.')
  const rows = [], seen = new Set()
  for (const values of matrix.slice(1)) {
    const get = key => text(values[header.indexOf(key)])
    if (required.every(key => get(key) === key)) continue // repeated page header in original DRB export
    if (['SITENUMBER', 'LOGDATE', 'SALEID', 'ITEM_NAME', 'CUST_ALTPHONE'].every(k => !get(k))) continue // blank / commission total
    const site_code = get('SITENUMBER'), sale_id = get('SALEID'), log_date = drbDate(get('LOGDATE'))
    if (!/^\d{4}$/.test(site_code) || !/^\d{1,30}$/.test(sale_id) || !get('ITEM_NAME') || get('ITEM_NAME').length > 200) fail('A transaction is missing a valid site, sale ID or item.')
    if (log_date < start || log_date > end) fail('A transaction falls outside the confirmed reporting period.')
    const key = `${site_code}:${sale_id}`
    if (seen.has(key)) fail('Repeated Site + Sale ID: obtain a line identifier before importing this export.')
    seen.add(key)
    const employee_identifier = get('CUST_ALTPHONE'), commission = get('COMMISSION')
    if (employee_identifier && !/^\d{1,20}$/.test(employee_identifier)) fail('Employee identifiers must be exact digit strings; no padding or name matching is applied.')
    if (!/^-?\d{1,10}(?:\.\d{1,6})?$/.test(commission)) fail('Invalid commission amount.')
    // Preserve trailing source annotations privately without interpreting their meaning.
    // No filenames, Legal Name or raw workbook upload.
    rows.push({ site_code, sale_id, log_date, item: get('ITEM_NAME'), employee_identifier, commission,
      customer_name: get('CUST_NAME'), customer_phone: get('CUST_MAINPHONE'),
      source_note: values.slice(header.length).map(text).filter(Boolean).join('\n') })
  }
  if (rows.some(r => r.source_note.length > 2000)) fail('A source annotation exceeds 2,000 characters; review the export before import.')
  if (!rows.length) fail('No transactions found.')
  return { kind, start_date: start, end_date: end, rows }
}
export async function parseDrbReconciliationFile(file, kind, start, end) {
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 10_000_000) fail('Choose the original XLSX export, up to 10 MB.')
  const buffer = await file.arrayBuffer()
  const document = parseDrbTransactions(await readDrbWorkbook(buffer), kind, start, end)
  const file_hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('')
  return { ...document, file_hash }
}
export const shortenedIdentifier = value => /^\d{4}$/.test(text(value))
// Decisions and employee attribution are separate. A shortened reviewed ID is
// exclusion evidence, never a reconstructed employee ID or an exclusion reason.
export function saleBucket(sale) {
  if (sale.decision === 'excluded') return 'excluded'
  if (sale.decision === 'eligible' && sale.employee_id && sale.identity_confirmed && sale.has_original && sale.has_reviewed && sale.activity !== 'unknown') return 'eligible'
  return 'unresolved'
}
export function reconciliationComparison(sales, logs, locations, range, mappings = []) {
  const manager = buildEmployeePerformance(logs, locations, range, mappings).rows
  const bySite = new Map(locations.map(l => [l.id, { locationId: l.id, name: l.name, reported: null, gross: 0, eligible: 0, excluded: 0, unresolved: 0, reviewedOnly: 0 }]))
  for (const location of locations) {
    const rows = manager.filter(r => r.locationId === location.id)
    if (rows.length && rows.every(r => r.ms != null)) bySite.get(location.id).reported = rows.reduce((n, r) => n + r.ms, 0)
  }
  for (const sale of sales) {
    if (sale.log_date < range.start || sale.log_date > range.end) continue
    const row = bySite.get(sale.location_id)
    if (!row) continue
    // Gross = original membership-export records, before commission exclusions.
    // Refunds/voids remain individually visible; no signed netting is invented.
    if (!sale.has_original) { row.reviewedOnly++; continue }
    row.gross++; row[saleBucket(sale)]++
  }
  return [...bySite.values()]
}
export function employeeReconciliation(sales, logs, locations, range, mappings = []) {
  const manager = buildEmployeePerformance(logs, locations, range, mappings).rows
  // Only approved historical UUID mappings can bridge the name-based Daily Log
  // to a POS roster UUID. Equal display names never establish employee identity.
  const result = manager.map(row => ({ key: row.key, name: row.name, locationId: row.locationId, reported: row.ms,
    employeeId: row.key.includes('::identity:mapped%3a') ? decodeURIComponent(row.key.split('::identity:')[1]).slice(7) : null,
    gross: 0, eligible: 0, excluded: 0, unresolved: 0 }))
  for (const sale of sales) {
    if (!sale.has_original || sale.log_date < range.start || sale.log_date > range.end) continue
    let row = result.find(r => r.locationId === sale.location_id && r.employeeId && r.employeeId === sale.employee_id)
    if (!row) {
      const key = `${sale.location_id}:pos:${sale.employee_id || 'unmatched'}`
      row = result.find(r => r.key === key)
      if (!row) { row = { key, locationId: sale.location_id, employeeId: sale.employee_id, name: sale.employee_name || 'Awaiting employee match', reported: null, gross: 0, eligible: 0, excluded: 0, unresolved: 0 }; result.push(row) }
    }
    row.gross++; row[saleBucket(sale)]++
  }
  return result
}
