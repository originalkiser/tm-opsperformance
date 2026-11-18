import { mondayOf } from './checklistRules.js'
export const weeklyPhases = { submitted_on_time: 'Submitted on time', completed_late: 'Completed Late', overdue: 'Overdue', in_progress: 'In progress', not_started: 'Not started' }
export function validateWeeklyTiming(value) {
  if (value == null) return null
  if (!value || !weeklyPhases[value.phase] || !Number.isFinite(Date.parse(value.due_at)) || mondayOf(value.due_date) !== value.due_date) throw Error('Weekly deadline could not be confirmed. Refresh before continuing.')
  return { due_at: value.due_at, due_date: value.due_date, phase: value.phase }
}
export function validateWeeklyPeriods(data) {
  if (!Array.isArray(data) || !data.length) throw Error('Weekly reporting periods could not be confirmed. Refresh before continuing.')
  const seen = new Set()
  return data.map(item => {
    if (!item?.period_date || mondayOf(item.period_date) !== item.period_date || seen.has(item.period_date)) throw Error('Invalid weekly reporting period.')
    seen.add(item.period_date)
    const checklists = Object.fromEntries(Object.entries(item.checklists || {}).filter(([key]) => ['weekly','weekly_pm'].includes(key)).map(([key,value]) => [key,validateWeeklyTiming(value)]))
    return { ...item, weekly_timing: validateWeeklyTiming(item.weekly_timing), checklists }
  })
}
export function weeklyDueText(timing, timezone) {
  if (!timing) return ''
  return `Due Monday, ${timing.due_date} at 11:59 p.m. (${timezone})`
}
