export const membershipTiers = ['basic', 'good', 'better', 'best']
export const dailyLogCounts = ['total_washes', 'member_washes', 'google_reviews', ...membershipTiers, 'reactivations']
export const chronoCompare = (a, b) => a.time_slot.localeCompare(b.time_slot)
  || (Number(a.split_index ?? 0) - Number(b.split_index ?? 0))

export const hasCount = value => value != null && String(value).trim() !== ''
export const validCount = value => hasCount(value) && typeof value !== 'boolean'
  && Number.isSafeInteger(Number(value)) && Number(value) >= 0
export const positiveCount = value => validCount(value) && Number(value) > 0
export const enteredCount = value => hasCount(value) && (!validCount(value) || Number(value) > 0)
export const hasDailyLogCheckpoint = row => dailyLogCounts.some(field => enteredCount(row[field]))

export function runningDailyCounts(rows, fields = dailyLogCounts) {
  const scopes = new Map()
  return new Map([...rows].sort(chronoCompare).map(row => {
    const scope = JSON.stringify([row.location_id, row.log_date])
    if (!scopes.has(scope)) scopes.set(scope, Object.fromEntries(fields.map(field => [field, 0])))
    const counts = scopes.get(scope)
    for (const field of fields) {
      if (positiveCount(row[field])) counts[field] = Number(row[field])
    }
    return [row, { ...counts }]
  }))
}
