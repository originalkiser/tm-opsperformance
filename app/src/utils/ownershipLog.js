// Ownership Log completion status — replaces the workbook's plain Yes/No
// "Complete?" flag with a time-based warning on a fixed morning schedule
// (see morningStatus.js): orange from 6:00 AM, red from 10:00 AM, until
// the day's post is submitted.

import { morningEntryStatus, STATUS_LABEL } from './morningStatus'

export { STATUS_LABEL }

// entry: the ownership_log_entries row for today (or null if none yet)
// timeZone: the location's IANA time zone (location.timezone)
// now: Date (injectable for testing)
export function ownershipLogStatus(entry, timeZone, now = new Date()) {
  return morningEntryStatus(!!entry?.submitted_at, timeZone, now)
}
