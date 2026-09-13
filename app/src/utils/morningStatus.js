// Shared "did today's morning entry happen yet" status, used by both the
// Ownership Log post and the Budget Tracking daily entry. Fixed schedule
// (not admin-configurable — both are meant to be done first thing):
//   before 6:00 AM local  → 'none'    (not due yet, no indicator)
//   6:00 AM – 9:59 AM     → 'pending' (orange — due this morning)
//   10:00 AM or later     → 'overdue' (red — past the 10:00 AM target)
// 'complete' whenever the entry already exists, regardless of time.

import { localHourMinute } from './operatingHours'

export const PENDING_START_HOUR = 6
export const OVERDUE_START_HOUR = 10

export const STATUS_LABEL = {
  complete: 'Complete',
  none:     'Not due yet',
  pending:  'Pending',
  overdue:  'Overdue',
}

export function morningEntryStatus(done, timeZone, now = new Date()) {
  if (done) return 'complete'
  const { hour } = localHourMinute(timeZone, now)
  if (hour < PENDING_START_HOUR) return 'none'
  if (hour < OVERDUE_START_HOUR) return 'pending'
  return 'overdue'
}
