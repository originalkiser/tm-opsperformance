// Local presentation preferences only. KPI calculations and ranking stay upstream.
export const KPI_COLUMNS = [
  { key: 'name', label: 'Location', type: 'text', align: 'left' },
  { key: 'tw', label: 'Total Washes', type: 'number', align: 'left' },
  { key: 'mw', label: 'Member Washes', type: 'number' },
  { key: 'ms', label: 'Memberships Sold', type: 'number' },
  { key: 'opp', label: 'Opportunities', type: 'number' },
  { key: 'gr', label: 'Google Reviews', type: 'number' },
  { key: 'p_mix', label: 'P-Mix', type: 'percent' },
  { key: 'conversion', label: 'Conversion', type: 'percent' },
  { key: 'nm', label: 'Net Members', type: 'number' },
  { key: 'rank', label: 'Rank', type: 'number', budget: true },
  { key: 'revenue', label: 'MTD Revenue', type: 'number', filterDecimals: 2, budget: true },
  { key: 'members', label: 'Total Members', type: 'number', budget: true },
  { key: 'revenuePct', label: 'Revenue %', type: 'percent', ratio: true, budget: true },
  { key: 'planPct', label: 'MTD Goal %', type: 'percent', ratio: true, budget: true },
  { key: 'growth', label: 'Membership Growth', type: 'number', budget: true },
  { key: 'expectedGrowth', label: 'Expected Growth', type: 'number', budget: true },
  { key: 'rating', label: 'Rating', type: 'number', budget: true },
  { key: 'score', label: 'Score', type: 'number', filterDecimals: 1, budget: true },
]
export const TEXT_OPERATORS = [['contains', 'Contains'], ['equals', 'Equals'], ['starts', 'Starts with'], ['notContains', 'Does not contain']]
export const NUMBER_OPERATORS = [['gte', '≥'], ['gt', '>'], ['lte', '≤'], ['lt', '<'], ['eq', '='], ['ne', '≠']]
export const PRESENCE_OPERATORS = [['missing', 'Is missing'], ['present', 'Has a value']]

export function preferenceKey(tableId, userId) {
  return `tm_kpi_columns_v1:${encodeURIComponent(userId || 'anonymous')}:${encodeURIComponent(tableId)}`
}
export function normalizePreferences(saved, columns = KPI_COLUMNS, defaultSort = 'tw') {
  const keys = columns.map(c => c.key), valid = new Set(keys)
  const order = ['name', ...new Set((Array.isArray(saved?.order) ? saved.order : keys).filter(k => valid.has(k) && k !== 'name'))]
  for (const key of keys) if (!order.includes(key)) order.push(key)
  const hidden = [...new Set((Array.isArray(saved?.hidden) ? saved.hidden : []).filter(k => valid.has(k) && k !== 'name'))]
  const filters = {}
  for (const column of columns) {
    const filter = saved?.filters?.[column.key]
    const ops = [...(column.type === 'text' ? TEXT_OPERATORS : NUMBER_OPERATORS), ...PRESENCE_OPERATORS]
    if (!hidden.includes(column.key) && filter && ops.some(([op]) => op === filter.op)) {
      filters[column.key] = { op: filter.op, value: typeof filter.value === 'string' ? filter.value.slice(0, 200) : '' }
    }
  }
  const sort = valid.has(saved?.sort?.col) && ['asc', 'desc'].includes(saved.sort.dir)
    ? { col: saved.sort.col, dir: saved.sort.dir } : { col: defaultSort, dir: 'desc' }
  return { order, hidden, filters, sort }
}
export function readPreferences(storage, key, defaultSort) {
  try { return normalizePreferences(JSON.parse(storage?.getItem(key) || 'null'), KPI_COLUMNS, defaultSort) }
  catch { return normalizePreferences(null, KPI_COLUMNS, defaultSort) }
}
export function savePreferences(storage, key, config) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(config)); return true }
  catch { return false }
}
export function moveColumn(order, key, before) {
  if (key === 'name' || before === 'name' || key === before || !order.includes(key) || !order.includes(before)) return order
  const next = order.filter(k => k !== key)
  next.splice(next.indexOf(before), 0, key)
  return next
}
export function visibleColumns(columns, config) {
  return config.order.map(key => columns.find(c => c.key === key)).filter(c => c && !config.hidden.includes(c.key))
}
const baseMetrics = new Set(['tw', 'mw', 'ms', 'opp', 'gr', 'p_mix', 'conversion'])
const numeric = value => {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null
  const parsed = Number(String(value).trim().replace(/%$/, '').replaceAll(',', ''))
  return Number.isFinite(parsed) ? parsed : null
}
export function columnValue(row, column) {
  if (column.key === 'name') return row.name ?? ''
  if (row.missing && baseMetrics.has(column.key)) return null
  const value = numeric(row[column.key])
  return value === null ? null : column.ratio ? value * 100 : value
}
export function activeFilter(filter, column) {
  if (!filter) return false
  if (['missing', 'present'].includes(filter.op)) return true
  if (!String(filter.value ?? '').trim()) return false
  return column.type === 'text' || numeric(filter.value) !== null
}
export function matchesColumn(row, column, filter) {
  if (!activeFilter(filter, column)) return true
  const raw = columnValue(row, column)
  const decimals = column.type === 'percent' ? 1 : column.filterDecimals
  const value = raw !== null && decimals !== undefined ? Number(raw.toFixed(decimals)) : raw
  const missing = value == null || value === ''
  if (filter.op === 'missing') return missing
  if (filter.op === 'present') return !missing
  if (missing) return false // Including ≠: an unknown value is never numeric zero.
  if (column.type === 'text') {
    const text = String(value).toLocaleLowerCase(), search = filter.value.trim().toLocaleLowerCase()
    return filter.op === 'equals' ? text === search : filter.op === 'starts' ? text.startsWith(search)
      : filter.op === 'notContains' ? !text.includes(search) : text.includes(search)
  }
  const target = numeric(filter.value)
  return ({ gte: () => value >= target, gt: () => value > target, lte: () => value <= target,
    lt: () => value < target, eq: () => value === target, ne: () => value !== target })[filter.op]?.() ?? true
}
export const filterRows = (rows, columns, filters) => rows.filter(row => columns.every(c => matchesColumn(row, c, filters[c.key])))
export function compareRows(a, b, column, direction) {
  const av = columnValue(a, column), bv = columnValue(b, column)
  if (av == null || bv == null) return av == null ? bv == null ? a.name.localeCompare(b.name) : 1 : -1
  const diff = column.type === 'text' ? String(av).localeCompare(String(bv)) : av - bv
  return (direction === 'asc' ? 1 : -1) * diff || a.name.localeCompare(b.name)
}
