// "Set targets" reminder logic for Budget Tracking.
//
// Two independent conditions flag a location as needing attention:
//   1. The CURRENT month has no budget_targets row yet — should already have
//      been set (the workbook's own rule: "by the 3rd of the month").
//   2. We're within 7 days of the current month's end and NEXT month's
//      target hasn't been set yet — a proactive heads-up so it's not missed.
// A flagged location stays flagged (banner/bell keep showing it) until a
// budget_targets row exists for that month — there is no separate "dismiss
// forever" state, only the temporary snooze the banner itself offers.

import { toDateStr, firstOfMonth, daysInMonth } from './budgetMath'

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  const next = new Date(d.getFullYear(), d.getMonth() + n, 1)
  return firstOfMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`)
}

// True once we're inside the last 7 days of the current month.
export function inProactiveWindow(today = new Date()) {
  const dateStr = toDateStr(today)
  const dim = daysInMonth(dateStr)
  return today.getDate() >= dim - 6 // last 7 calendar days, inclusive
}

// locations: the set to check (already scoped to the viewer's role)
// targets: all budget_targets rows for those locations (any month)
// Returns [{ location, month, reason }] — reason: 'current' | 'upcoming'
export function findMissingTargets(locations, targets, today = new Date()) {
  const todayStr      = toDateStr(today)
  const currentMonth  = firstOfMonth(todayStr)
  const nextMonth     = addMonths(todayStr, 1)
  const proactive     = inProactiveWindow(today)

  const hasTarget = (locId, month) =>
    targets.some(t => t.location_id === locId && t.target_month?.slice(0, 10) === month)

  const missing = []
  locations.forEach(loc => {
    if (!hasTarget(loc.id, currentMonth)) {
      missing.push({ location: loc, month: currentMonth, reason: 'current' })
    } else if (proactive && !hasTarget(loc.id, nextMonth)) {
      missing.push({ location: loc, month: nextMonth, reason: 'upcoming' })
    }
  })
  return missing
}
