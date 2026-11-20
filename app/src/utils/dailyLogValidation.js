import { chronoCompare } from './logMath.js'

export const cumulativeFields = {
  total_washes: 'Total Washes', member_washes: 'Member Washes', google_reviews: 'Google Reviews',
  basic: 'Basic', good: 'Good', better: 'Better', best: 'Best',
}
const blank = value => value == null || String(value).trim() === ''
// Match the existing editor's blank-as-zero save semantics, without changing a
// single input. Distinguish blanks explicitly in the warning instead of hiding them.
const count = value => blank(value) ? 0 : Number(value)
const shown = value => blank(value) ? 'blank (saved as 0)' : String(value)
export function checkpointLabel(row) {
  const hour = Number(row.time_slot.slice(0, 2)), minutes = row.time_slot.slice(3, 5)
  return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}${Number(row.split_index) > 0 ? ` (split ${row.split_index})` : ''}`
}
export function cumulativeLogWarnings(rows, { locationId, date, isCheckpoint = row => Object.keys(cumulativeFields).some(key => !blank(row[key])) } = {}) {
  const ordered = rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => (!row.location_id || !locationId || row.location_id === locationId) && (!row.log_date || !date || row.log_date === date) && isCheckpoint(row))
    .sort((a, b) => chronoCompare(a.row, b.row))
  const warnings = []
  // Group even when callers supply more than one site/day. Never carry a
  // cumulative baseline into another business date or location.
  const previous = new Map()
  for (const { row, index } of ordered) {
    const scope = `${row.location_id || locationId || ''}:${row.log_date || date || ''}`
    const prior = previous.get(scope)
    const add = (fields, message) => warnings.push({ index, fields, previousIndex: prior?.index ?? null, checkpoint: checkpointLabel(row), message })
    for (const [field, label] of Object.entries(cumulativeFields)) {
      const current = count(row[field]), before = prior ? count(prior.row[field]) : 0
      if (!Number.isSafeInteger(current) || current < 0) add([field], `${label}: current ${shown(row[field])} is not a valid nonnegative whole count.`)
      else if (prior && Number.isSafeInteger(before) && current < before) add([field], `${label} decreased: previous ${shown(prior.row[field])} at ${checkpointLabel(prior.row)} → current ${shown(row[field])}. Cumulative values must not decrease; review either checkpoint.`)
    }
    const tw = count(row.total_washes), mw = count(row.member_washes)
    const ptw = prior ? count(prior.row.total_washes) : 0, pmw = prior ? count(prior.row.member_washes) : 0
    if ([tw, mw, ptw, pmw].every(v => Number.isSafeInteger(v) && v >= 0) && mw - pmw > tw - ptw) {
      add(['total_washes', 'member_washes'], `Member Washes ${mw - pmw >= 0 && tw - ptw >= 0 ? 'increased' : 'changed'} by ${mw - pmw}, exceeding Total Washes ${tw - ptw >= 0 ? 'increase' : 'change'} of ${tw - ptw}. Previous ${prior ? checkpointLabel(prior.row) : 'start of day'}: Total ${prior ? shown(prior.row.total_washes) : '0'}, Member ${prior ? shown(prior.row.member_washes) : '0'}; current: Total ${shown(row.total_washes)}, Member ${shown(row.member_washes)}. Nonmember opportunities decreased from ${ptw - pmw} to ${tw - mw}. Review either checkpoint.`)
    }
    previous.set(scope, { row, index })
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
