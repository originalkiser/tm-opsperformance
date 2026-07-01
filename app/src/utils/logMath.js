const toInt = (v) => Math.max(0, parseInt(v) || 0)

export const FIELDS = [
  'total_washes', 'member_washes', 'google_reviews',
  'basic', 'good', 'better', 'best', 'net_members',
]

/**
 * Returns the latest time-slot row that has any data entered for a shop day.
 * Cumulative values grow through the day, so the latest filled-in time slot
 * always holds the highest (most complete) totals — this is the day total.
 */
export function shopTotals(rows) {
  if (!rows || !rows.length) return null
  const withData = rows.filter(r =>
    r.employee_name?.trim() || FIELDS.some(f => toInt(r[f]) > 0)
  )
  if (!withData.length) return null
  return withData.sort((a, b) => b.time_slot.localeCompare(a.time_slot))[0]
}

/**
 * Takes ALL rows for a shop-day (any employee mix).
 * Sorts chronologically, then diffs each row against the PREVIOUS row
 * (regardless of who entered it), attributing each delta to that row's employee.
 *
 * Employee names are matched case-insensitively — "Chris", "chris", and "CHRIS"
 * all accumulate into a single entry keyed by the first-seen capitalization.
 */
export function employeeDeltasByDay(allDayRows) {
  const sorted = [...allDayRows].sort((a, b) => a.time_slot.localeCompare(b.time_slot))
  const result    = {}   // lowercase key → accumulated deltas
  const canonical = {}   // lowercase key → first-seen display name

  sorted.forEach((row, idx) => {
    const raw = row.employee_name?.trim()
    if (!raw) return
    const key = raw.toLowerCase()
    if (!canonical[key]) canonical[key] = raw

    const prev = sorted[idx - 1]
    if (!result[key]) {
      result[key] = FIELDS.reduce((a, f) => ({ ...a, [f]: 0 }), {})
    }
    FIELDS.forEach(f => {
      const curr  = toInt(row[f])
      const prior = prev ? toInt(prev[f]) : 0
      result[key][f] += Math.max(0, curr - prior)
    })
  })

  // Re-key by canonical (first-seen) display name
  return Object.fromEntries(
    Object.entries(result).map(([key, data]) => [canonical[key], data])
  )
}
