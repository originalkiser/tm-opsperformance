import { managementAuditScoreText } from '../utils/managementAudits.js'
import { useState } from 'react'
import { checklistTimestamp } from '../utils/checklistRules'

// Keep the source's location encounter order and per-location record order.
// Records have already been scoped by the existing queries and authorization.
export function groupSubmissionLocations(records, locations) {
  const metadata = new Map(locations.map(location => [location.id, location]))
  const groups = new Map()
  for (const record of records) {
    if (!groups.has(record.location_id)) groups.set(record.location_id, {
      location: metadata.get(record.location_id) || { id: record.location_id, site_code: 'Unknown site', name: 'Location unavailable' },
      records: [], submitted: 0,
    })
    const group = groups.get(record.location_id)
    group.records.push(record)
    if (record.status === 'submitted') group.submitted++
  }
  return [...groups.values()]
}

export default function ChecklistSubmissionReview({ label, records, locations, busy, onOpen, showAuditScores = false }) {
  const [expanded, setExpanded] = useState({})
  const groups = groupSubmissionLocations(records, locations)
  const control = 'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50 dark:border-tm-dark-border'
  return <section aria-label={label} className="space-y-2">
    <div className="flex flex-wrap justify-end gap-2">
      <button className={control} disabled={!groups.length} onClick={() => setExpanded(Object.fromEntries(groups.map(group => [group.location.id, true])))}>Expand All</button>
      <button className={control} disabled={!groups.some(group => expanded[group.location.id])} onClick={() => setExpanded({})}>Collapse All</button>
    </div>
    {!groups.length ? <p className="py-3 text-sm text-slate-600 dark:text-tm-dark-muted">No records for the selected period.</p> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-tm-dark-border dark:bg-tm-dark-card">
      {groups.map(group => <div key={group.location.id} className="border-b border-slate-200 last:border-b-0 dark:border-tm-dark-border">
        <button aria-expanded={!!expanded[group.location.id]} className="flex min-h-12 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-3 text-left sm:px-4" onClick={() => setExpanded(value => ({ ...value, [group.location.id]: !value[group.location.id] }))}>
          <span className="flex min-w-0 items-start gap-2"><span aria-hidden="true">{expanded[group.location.id] ? '▾' : '▸'}</span><span className="min-w-0 break-words font-bold">{group.location.site_code} · {group.location.name}</span></span>
          <span className="pl-5 text-sm tabular-nums sm:pl-0">{group.records.length} {group.records.length === 1 ? 'record' : 'records'} · {group.submitted} submitted</span>
        </button>
        {expanded[group.location.id] && <ul aria-label={`${group.location.site_code} records`} className="space-y-2 bg-slate-50 p-3 dark:bg-tm-dark-surface sm:p-4">
          {group.records.map(record => <li key={record.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-tm-dark-border dark:bg-tm-dark-card">
            <p className="break-words">{group.location.site_code} · {record.template_snapshot.name} · {record.period_date} · {record.status}{record.is_pilot ? ' · Historical pilot' : ''}</p>
            {showAuditScores && record.status === 'submitted' && <p className="mt-1 font-semibold">{managementAuditScoreText(record)}</p>}
            <button disabled={busy} className="min-h-12 max-w-full break-words px-2 py-2 text-left underline disabled:opacity-50" onClick={() => onOpen(record)}>Review {record.status} · {record.manager_name || 'Unnamed draft'} · {checklistTimestamp(record.submitted_at || record.updated_at, record.template_snapshot.timezone)}</button>
          </li>)}
        </ul>}
      </div>)}
    </div>}
  </section>
}
