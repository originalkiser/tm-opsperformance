import { toDateStr } from './budgetMath.js'

export const TARGETS_SAVED_EVENT = 'tm-budget-targets-saved'

export function notifyTargetsSaved() {
  window.dispatchEvent(new Event(TARGETS_SAVED_EVENT))
}

export function isTargetReminderLocation(location) {
  // Locations use their reporting exclusion flag for inactive, sold, and test sites.
  return !!location.show_budget_tracking && !location.exclude_from_reporting && String(location.site_code) !== '1509'
}

export function targetReminderMonths(today = new Date()) {
  const year = today.getFullYear()
  const month = today.getMonth()
  return [toDateStr(new Date(year, month, 1)), toDateStr(new Date(year, month + 1, 1))]
}

export function inProactiveWindow(today = new Date()) {
  const lastWeekday = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  if (lastWeekday.getDay() === 0) lastWeekday.setDate(lastWeekday.getDate() - 2)
  if (lastWeekday.getDay() === 6) lastWeekday.setDate(lastWeekday.getDate() - 1)
  return today.getDate() >= lastWeekday.getDate()
}

export function findMissingTargets(locations, targets, today = new Date()) {
  const [currentMonth, nextMonth] = targetReminderMonths(today)
  const proactive = inProactiveWindow(today)
  const existing = new Set(targets.map(t => t.location_id + ':' + t.target_month?.slice(0, 10)))
  const missing = []
  for (const location of locations.filter(isTargetReminderLocation)) {
    // A saved target row is the existing completion criterion.
    if (!existing.has(location.id + ':' + currentMonth)) {
      missing.push({ location, month: currentMonth, reason: 'current' })
    }
    if (proactive && !existing.has(location.id + ':' + nextMonth)) {
      missing.push({ location, month: nextMonth, reason: 'upcoming' })
    }
  }
  return missing
}
