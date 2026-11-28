import { chronoCompare, hasCount, positiveCount, validCount } from './dailyLogCounts.js'

export const cumulativeFields = {
  total_washes: 'Total Washes', member_washes: 'Member Washes', google_reviews: 'Google Reviews',
  basic: 'Basic', good: 'Good', better: 'Better', best: 'Best', reactivations: 'Reactivations',
}
export function checkpointLabel(row) {
  const hour = Number(row.time_slot.slice(0, 2)), minutes = row.time_slot.slice(3, 5)
  return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}${Number(row.split_index) > 0 ? ` (split ${row.split_index})` : ''}`
}
export function cumulativeLogWarnings(rows, { locationId, date, isCheckpoint = row => Object.keys(cumulativeFields).some(key => hasCount(row[key])) } = {}) {
  const ordered = rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => (!row.location_id || !locationId || row.location_id === locationId) && (!row.log_date || !date || row.log_date === date) && isCheckpoint(row))
    .sort((a, b) => chronoCompare(a.row, b.row))
  const warnings = []
  // Group even when callers supply more than one site/day. Never carry a
  // cumulative baseline into another business date or location.
  const previous = new Map()
  for (const { row, index } of ordered) {
    const scope = `${row.location_id || locationId || ''}:${row.log_date || date || ''}`
    if (!previous.has(scope)) previous.set(scope, { fields: new Map() })
    const history = previous.get(scope)
    const add = (fields, message, prior) => warnings.push({ index, fields, previousIndex: prior?.index ?? null, checkpoint: checkpointLabel(row), message })
    for (const [field, label] of Object.entries(cumulativeFields)) {
      const prior = history.fields.get(field)
      if (hasCount(row[field]) && !validCount(row[field])) {
        add([field], `${label}: current ${row[field]} is not a valid nonnegative whole count.`, prior)
      } else if (positiveCount(row[field])) {
        const current = Number(row[field])
        if (prior && current < Number(prior.row[field])) add([field], `${label} decreased: previous ${prior.row[field]} at ${checkpointLabel(prior.row)} → current ${current}. Cumulative values must not decrease; review either checkpoint.`, prior)
        history.fields.set(field, { row, index })
      }
    }
    if (!positiveCount(row.total_washes) || !positiveCount(row.member_washes)) continue
    const prior = history.washes
    const tw = Number(row.total_washes), mw = Number(row.member_washes)
    const ptw = Number(prior?.row.total_washes ?? 0), pmw = Number(prior?.row.member_washes ?? 0)
    if (mw - pmw > tw - ptw) {
      add(['total_washes', 'member_washes'], `Member Washes ${mw - pmw >= 0 && tw - ptw >= 0 ? 'increased' : 'changed'} by ${mw - pmw}, exceeding Total Washes ${tw - ptw >= 0 ? 'increase' : 'change'} of ${tw - ptw}. Previous ${prior ? checkpointLabel(prior.row) : 'start of day'}: Total ${prior ? prior.row.total_washes : '0'}, Member ${prior ? prior.row.member_washes : '0'}; current: Total ${row.total_washes}, Member ${row.member_washes}. Nonmember opportunities decreased from ${ptw - pmw} to ${tw - mw}. Review either checkpoint.`, prior)
    }
    history.washes = { row, index }
  }
  return warnings
}

// A cancelable local event lets the existing Site Entry selectors warn before
// changing React state, without touching the save queue or discarding local edits.
export function canLeaveDailyLog(target = window) {
  return target.dispatchEvent(new Event('daily-log-before-leave', { cancelable: true }))
}
export function confirmCumulativeLeave(warnings, confirm) {
  return !warnings.length || confirm(`Daily Log has ${warnings.length} cumulative data warning${warnings.length === 1 ? '' : 's'}. ${warnings[0].checkpoint}: ${warnings[0].message}\n\nCancel to review and correct this or an earlier checkpoint. Leave anyway? Existing autosave behavior is unchanged.`)
}
