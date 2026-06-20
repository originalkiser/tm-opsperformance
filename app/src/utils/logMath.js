const toInt = (v) => Math.max(0, parseInt(v) || 0)

const FIELDS = [
  'total_washes', 'member_washes', 'google_reviews',
  'basic', 'good', 'better', 'best', 'net_members',
]

/**
 * Returns the most recently updated row for a shop day.
 * That row's cumulative values ARE the shop's totals for the day.
 */
export function shopTotals(rows) {
  if (!rows || !rows.length) return null
  const withTs = rows.filter(r => r.updated_at)
  if (!withTs.length) return null
  return withTs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0]
}

/**
 * Given all rows for one employee on one day, compute per-hour deltas
 * (each hour minus the prior hour for that employee) and sum them.
 * Returns { hourly, dayTotal } where dayTotal is the correct daily amount.
 */
export function employeeDeltas(empRows) {
  if (!empRows || !empRows.length) return { hourly: [], dayTotal: FIELDS.reduce((a, f) => ({ ...a, [f]: 0 }), {}) }
  const sorted = [...empRows].sort((a, b) => a.time_slot.localeCompare(b.time_slot))

  const hourly = sorted.map((row, idx) => {
    const prev = sorted[idx - 1]
    return FIELDS.reduce((acc, f) => {
      const curr  = toInt(row[f])
      const prior = prev ? toInt(prev[f]) : 0
      acc[f] = Math.max(0, curr - prior)
      return acc
    }, { time_slot: row.time_slot, employee_name: row.employee_name })
  })

  const dayTotal = FIELDS.reduce((acc, f) => {
    acc[f] = hourly.reduce((s, h) => s + h[f], 0)
    return acc
  }, {})

  return { hourly, dayTotal }
}
