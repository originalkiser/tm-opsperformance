import { localChecklistDate, mondayOf } from './checklistRules.js'

export const complianceTemplates = {
  daily: [{ key: 'opening', label: 'Opening' }, { key: 'midday', label: 'Mid-Day' }, { key: 'closing', label: 'Closing' }],
  weekly: [{ key: 'weekly', label: 'Manager Administrative' }, { key: 'weekly_pm', label: 'Preventive Maintenance' }],
}
export const complianceStatusLabels = { submitted: 'Submitted', draft: 'In progress', discarding: 'Discarding draft', missing: 'Missing', future: 'Not started yet' }

export function addChecklistDays(date, days) {
  mondayOf(date) // Strict calendar-date validation; never parse a business date in the browser's zone.
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function complianceRange(cadence, start, end) {
  if (!['daily', 'weekly'].includes(cadence)) throw new Error('Choose daily or weekly reporting.')
  mondayOf(start)
  if (cadence === 'weekly') return { start: mondayOf(start), end: addChecklistDays(mondayOf(start), 6) }
  mondayOf(end)
  if (end < start) throw new Error('End date must be on or after start date.')
  if ((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000 >= 92) throw new Error('Choose a range of 92 days or fewer.')
  return { start, end }
}

// Scalar JSON avoids silently treating a PostgREST row limit as missing submissions.
// Do not fall back to checklist_submissions: its owner-only RLS is intentionally narrower.
export async function fetchChecklistCompliance(client, range) {
  complianceRange('daily', range.start, range.end)
  const { data, error } = await client.rpc('get_checklist_compliance', { p_start: range.start, p_end: range.end })
  if (error?.code === '22023' && error.message === 'Valid site time zone required for every reporting location') throw new Error('A reporting location has a missing or invalid time zone. Ask an Admin to correct it, then refresh. No completion scores are shown.')
  if (error) throw new Error('Checklist reporting could not be loaded. Check your connection and access, then refresh. An Admin may need to install the reporting database update.')
  if (!data || data.range_start !== range.start || data.range_end !== range.end || !Array.isArray(data.locations) || !Array.isArray(data.submissions) || !data.generated_at || !Number.isFinite(Date.parse(data.generated_at))) throw new Error('The checklist report response was incomplete. No completion scores are shown.')
  const ids = new Set(), occurrences = new Set()
  for (const site of data.locations) {
    if (!site.id || ids.has(site.id) || typeof site.site_code !== 'string' || !site.timezone || !site.local_today) throw new Error('The checklist location list was incomplete. No completion scores are shown.')
    mondayOf(site.local_today)
    // The server is authoritative for each site's current business date.
    if (localChecklistDate(site.timezone, new Date(data.generated_at)) !== site.local_today) throw new Error('The checklist site dates were inconsistent. Refresh the report.')
    ids.add(site.id)
  }
  const keys = Object.values(complianceTemplates).flat().map(template => template.key)
  for (const row of data.submissions) {
    const key = `${row.location_id}:${row.template_key}:${row.period_date}`
    if (!ids.has(row.location_id) || !keys.includes(row.template_key) || !['draft', 'discarding', 'submitted'].includes(row.status) || typeof row.is_pilot !== 'boolean' || occurrences.has(key)) throw new Error('The checklist statuses were incomplete. No completion scores are shown.')
    mondayOf(row.period_date)
    const weekly = row.template_key.startsWith('weekly')
    if (row.period_date < (weekly ? mondayOf(range.start) : range.start) || row.period_date > range.end || (weekly && mondayOf(row.period_date) !== row.period_date)) throw new Error('The checklist periods were inconsistent. No completion scores are shown.')
    occurrences.add(key)
  }
  // Retain only the documented reporting fields, including for export.
  return {
    generated_at: data.generated_at,
    locations: data.locations.map(({ id, site_code, name, market, timezone, local_today }) => ({ id, site_code, name, market, timezone, local_today })),
    submissions: data.submissions.map(({ location_id, template_key, period_date, status, is_pilot }) => ({ location_id, template_key, period_date, status, is_pilot })),
  }
}

export function buildComplianceRows(data, cadence, range) {
  const templates = complianceTemplates[cadence]
  const statuses = new Map(data.submissions.map(row => [`${row.location_id}:${row.template_key}:${row.period_date}`, row]))
  const periods = []
  for (let date = range.start; date <= range.end; date = addChecklistDays(date, cadence === 'daily' ? 1 : 7)) periods.push(date)
  return [...data.locations].sort((a, b) => a.site_code.localeCompare(b.site_code, undefined, { numeric: true })).flatMap(site => periods.map(period => {
    const end = cadence === 'weekly' ? addChecklistDays(period, 6) : period
    const future = period > site.local_today
    const cells = templates.map(template => {
      const record = statuses.get(`${site.id}:${template.key}:${period}`)
      return { ...template, status: future ? 'future' : record?.status || 'missing', isPilot: record?.is_pilot || false }
    })
    const complete = cells.every(cell => cell.status === 'submitted')
    return { site, period, end, cells, score: future ? null : complete ? 100 : 0, current: !future && end >= site.local_today,
      missing: cells.filter(cell => cell.status === 'missing').map(cell => cell.label),
      inProgress: cells.filter(cell => ['draft', 'discarding'].includes(cell.status)).map(cell => cell.label),
      isPilot: cells.some(cell => cell.isPilot),
    }
  }))
}

export function summarizeCompliance(rows) {
  const eligible = rows.filter(row => row.score !== null), complete = eligible.filter(row => row.score === 100).length
  return { total: eligible.length, complete, incomplete: eligible.length - complete,
    percent: eligible.length ? Math.round(100 * complete / eligible.length) : null,
    missing: eligible.reduce((total, row) => total + row.missing.length, 0),
    inProgress: eligible.reduce((total, row) => total + row.inProgress.length, 0),
    future: rows.length - eligible.length,
  }
}

function csvCell(value) {
  const text = String(value ?? '')
  // Protect spreadsheet users from formula injection through location names/codes.
  const safe = /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
export function complianceCsv(rows, cadence, generatedAt) {
  const columns = ['Site', 'Location', 'Market', 'Time zone', 'Site today', 'Period start', 'Period end', 'Completion %', ...complianceTemplates[cadence].map(template => template.label), 'Missing', 'In progress', 'Period still open', 'Historical pilot records', 'Report generated (UTC)', 'Interpretation']
  return '\uFEFF' + [columns, ...rows.map(row => [row.site.site_code, row.site.name, row.site.market, row.site.timezone, row.site.local_today, row.period, row.end, row.score, ...row.cells.map(cell => complianceStatusLabels[cell.status]), row.missing.join('; '), row.inProgress.join('; '), row.current ? 'Yes' : 'No', row.isPilot ? 'Yes' : 'No', generatedAt, 'Optional checklist completion; not a retroactive policy finding.'])].map(values => values.map(csvCell).join(',')).join('\r\n')
}

export function downloadComplianceCsv(rows, cadence, range, generatedAt) {
  const blob = new Blob([complianceCsv(rows, cadence, generatedAt)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = `checklist-${cadence}-${range.start}-${range.end}.csv`
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
