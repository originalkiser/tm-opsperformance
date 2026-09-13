// Ownership Log completion status — replaces the workbook's plain Yes/No
// "Complete?" flag with a time-based warning: a post isn't "late" until the
// site's configured cutoff time has passed for that day.

export const DEFAULT_OWNERSHIP_CUTOFF = '18:00'

// entry: the ownership_log_entries row for today (or null if none yet)
// cutoffTime: 'HH:MM' (location.ownership_log_cutoff_time, or the default)
// now: Date (injectable for testing)
export function ownershipLogStatus(entry, cutoffTime, now = new Date()) {
  if (entry?.submitted_at) return 'complete'

  const cutoff = cutoffTime || DEFAULT_OWNERSHIP_CUTOFF
  const [h, m] = cutoff.split(':').map(Number)
  const cutoffToday = new Date(now)
  cutoffToday.setHours(h, m || 0, 0, 0)

  return now >= cutoffToday ? 'overdue' : 'pending'
}

export const STATUS_LABEL = {
  complete: 'Complete',
  pending:  'Pending',
  overdue:  'Overdue',
}
