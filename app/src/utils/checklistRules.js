// Pure checklist rules shared by the form, completion review and focused tests.
export function localChecklistDate(timezone, now = new Date()) {
  if (!timezone) throw new Error('A site time zone is required.')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = name => parts.find(p => p.type === name).value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function mondayOf(date) {
  const day = new Date(`${date}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(+day) || day.toISOString().slice(0, 10) !== date) throw new Error('Invalid checklist date.')
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day.toISOString().slice(0, 10)
}
export function checklistPeriod(template, date) { return template.cadence === 'weekly' ? mondayOf(date) : date }
export function validateChecklist(items, answers, evidence = [], name = '') {
  const errors = {}
  for (const item of items) {
    const answer = answers[item.id] || {}
    if (!(item.options.includes(answer.value) || (item.na_allowed && answer.value === 'N/A'))) errors[item.id] = 'Choose a response.'
    else if ((item.explanation_required || item.failure_values.includes(answer.value) || answer.value === 'N/A') && !answer.explanation?.trim()) errors[item.id] = 'A brief explanation is required.'
    if ((item.photo_required || (item.photo_on_failure && item.failure_values.includes(answer.value))) && !evidence.some(file => file.item_id === item.id && file.kind === 'photo')) errors[item.id] = `${errors[item.id] || ''} Required photo missing.`.trim()
  }
  if (!name.trim()) errors._name = 'Enter your full manager name.'
  if (!evidence.some(file => file.kind === 'signature')) errors._signature = 'Draw and save your signature.'
  return errors
}
export function completionStatus(template, date, submissions, today) {
  const period = checklistPeriod(template, date)
  const record = submissions.find(row => row.template_key === template.key && row.period_date === period)
  return record?.status === 'submitted' ? 'Submitted' : record ? 'Draft' : period < today ? 'Missing' : 'Not submitted'
}
export function validateEvidence(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG or WebP image.')
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Images must be between 1 byte and 10 MB.')
}

export function checklistTimestamp(value, timezone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value))
}
