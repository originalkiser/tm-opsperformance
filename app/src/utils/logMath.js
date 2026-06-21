const toInt = (v) => Math.max(0, parseInt(v) || 0)

export const FIELDS = [
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
 * Takes ALL rows for a shop-day (any employee mix).
 * Sorts chronologically, then diffs each row against the PREVIOUS row
 * (regardless of who entered it), attributing each delta to that row's employee.
 *
 * This correctly handles mid-shift employee changes:
 *   - Cord's 11AM entry (TW=4) is diffed against Savannah's 10AM entry (TW=4) → delta=0
 *   - Cord's 1PM entry (TW=10) vs Cord's 12PM (TW=6) → delta=4
 *   - Cord total = 6, not 10
 *
 * Returns: { empName: { total_washes, member_washes, basic, good, better, best, ... }, ... }
 */
export function employeeDeltasByDay(allDayRows) {
  const sorted = [...allDayRows].sort((a, b) => a.time_slot.localeCompare(b.time_slot))
  const result = {}

  sorted.forEach((row, idx) => {
    const name = row.employee_name?.trim()
    if (!name) return

    const prev = sorted[idx - 1]  // previous time slot, any employee

    if (!result[name]) {
      result[name] = FIELDS.reduce((a, f) => ({ ...a, [f]: 0 }), {})
    }

    FIELDS.forEach(f => {
      const curr  = toInt(row[f])
      const prior = prev ? toInt(prev[f]) : 0
      result[name][f] += Math.max(0, curr - prior)
    })
  })

  return result
}
