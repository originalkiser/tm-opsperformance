const toInt = (v) => Math.max(0, parseInt(v) || 0)

export const FIELDS = [
  'total_washes', 'member_washes', 'google_reviews',
  'basic', 'good', 'better', 'best', 'net_members',
]

// Chronological order for daily_log rows: by time_slot, then by split_index
// (a "split hour" holds more than one row for the same time_slot — e.g. one
// employee 8:00-8:15, another 8:15-9:00 — split_index 0 first).
const chronoCompare = (a, b) =>
  a.time_slot.localeCompare(b.time_slot) || (toInt(a.split_index) - toInt(b.split_index))

/**
 * Returns the latest time-slot row that has any data entered for a shop day.
 * Cumulative values grow through the day, so the latest filled-in time slot
 * always holds the highest (most complete) totals — this is the day total.
 */
export function shopTotals(rows) {
  if (!rows || !rows.length) return null
  // A row is only considered complete if both total_washes and member_washes are
  // non-zero. This prevents a newly-opened time slot with zeros from shadowing
  // earlier rows that contain real wash counts.
  const withData = rows.filter(r => toInt(r.total_washes) > 0 && toInt(r.member_washes) > 0)
  if (!withData.length) return null
  return withData.sort((a, b) => chronoCompare(b, a))[0]
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
  const sorted = [...allDayRows].sort(chronoCompare)
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

/**
 * Takes ALL rows for a shop-day, sorted chronologically, and diffs each row
 * against the PREVIOUS row (regardless of employee) to get what actually
 * happened during that time slot's hour — rows are cumulative running totals,
 * so this is the only correct way to get an hourly figure.
 */
export function hourlyDeltasByDay(allDayRows) {
  const sorted = [...allDayRows].sort(chronoCompare)
  return sorted.map((row, idx) => {
    const prev = sorted[idx - 1]
    const delta = (f) => Math.max(0, toInt(row[f]) - (prev ? toInt(prev[f]) : 0))
    return {
      time_slot:     row.time_slot,
      total_washes:  delta('total_washes'),
      member_washes: delta('member_washes'),
      basic:         delta('basic'),
      good:          delta('good'),
      better:        delta('better'),
      best:          delta('best'),
    }
  })
}
