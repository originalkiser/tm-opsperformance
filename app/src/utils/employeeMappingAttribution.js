// Mapping is an explicit report-only interpretation. Never change source rows.
export const isApprovedMapping = row => ['approved', 'locked'].includes(row.status)
export const mappingCovers = (mapping, row) => mapping.location_id === row.location_id
  && mapping.original_name === row.employee_name
  && (!mapping.start_date || row.log_date >= mapping.start_date)
  && (!mapping.end_date || row.log_date <= mapping.end_date)

export function mappedEmployeeLogs(data, mappings = []) {
  const approved = mappings.filter(isApprovedMapping)
  if (!approved.length) return { data, labels: new Map() }
  const labels = new Map()
  const rows = data.map(row => {
    if (!row.employee_name?.trim()) return row
    const matches = approved.filter(mapping => mappingCovers(mapping, row))
    if (matches.length > 1) throw new Error('Overlapping approved employee mappings. Ask Admin to correct them before reporting.')
    const mapping = matches[0]
    // Encode every named row so an actual recorded name cannot collide with a
    // mapping identity, and an unmapped same-name person stays separate.
    const identity = mapping ? `mapped:${mapping.employee_id}` : `recorded:${row.employee_name.trim().toLowerCase()}`
    const token = `identity:${encodeURIComponent(identity).toLowerCase()}`
    const key = `${row.location_id}::${token}`
    if (!labels.has(key)) labels.set(key, mapping ? mapping.employee_name : row.employee_name.trim())
    if (mapping && !mapping.employee_name) throw new Error('Mapped roster employee is unavailable. Reload before reporting.')
    return { ...row, employee_name: token, _mappingOriginalName: row.employee_name }
  })
  return { data: rows, labels }
}
