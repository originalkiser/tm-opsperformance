import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { localChecklistDate } from '../utils/checklistRules'
import { complianceTemplates, complianceStatusLabels, complianceRange, fetchChecklistCompliance, buildComplianceRows, summarizeCompliance, downloadComplianceCsv } from '../utils/checklistCompliance'

const control = 'block min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-surface'
const statusClass = { submitted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', draft: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', discarding: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', missing: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200', future: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }

export default function ChecklistCompliance() {
  const { user, profile, locations } = useAuth()
  const authorized = !!user && profile?.is_active === true && !profile.deleted_at && ['admin', 'area_manager', 'store'].includes(profile.role)
  let initialDate = ''
  try { initialDate = localChecklistDate(locations[0]?.timezone) } catch { /* A chosen report date is required if location metadata is unavailable. */ }
  const [cadence, setCadence] = useState('daily')
  const [start, setStart] = useState(initialDate), [end, setEnd] = useState(initialDate), [week, setWeek] = useState(initialDate)
  const [market, setMarket] = useState(''), [site, setSite] = useState(''), [status, setStatus] = useState('all')
  const [refresh, setRefresh] = useState(0), [result, setResult] = useState(null), [failure, setFailure] = useState(null)
  const request = useRef(0)
  let range, validation = ''
  try { range = complianceRange(cadence, cadence === 'weekly' ? week : start, end) } catch (error) { validation = error.message }
  const accountScope = `${user?.id}:${profile?.role}:${profile?.location_id}:${locations.map(location => location.id).sort().join(',')}`
  const scope = `${authorized}:${accountScope}:${cadence}:${range?.start}:${range?.end}:${refresh}`
  const data = authorized && result?.scope === scope ? result.data : null
  const error = failure?.scope === scope ? failure.message : ''
  const loading = authorized && !!range && !data && !error

  useEffect(() => { setMarket(''); setSite(''); setStatus('all') }, [accountScope])
  useEffect(() => {
    if (!data) return
    if (market && !data.locations.some(location => location.market === market)) { setMarket(''); setSite('') }
    else if (site && !data.locations.some(location => location.id === site && (!market || location.market === market))) setSite('')
  }, [data, market, site])

  useEffect(() => {
    const current = ++request.current
    setResult(null); setFailure(null)
    if (!authorized || !range) return
    fetchChecklistCompliance(supabase, range).then(data => {
      if (request.current === current) setResult({ scope, data })
    }).catch(error => {
      if (request.current === current) setFailure({ scope, message: error.message })
    })
    return () => { request.current++ }
  }, [scope])

  const markets = [...new Set((data?.locations || []).map(location => location.market).filter(Boolean))].sort()
  const sites = (data?.locations || []).filter(location => !market || location.market === market)
  const locationRows = data ? buildComplianceRows(data, cadence, range).filter(row => (!market || row.site.market === market) && (!site || row.site.id === site)) : []
  const rows = locationRows.filter(row => status === 'all' || (status === 'complete' && row.score === 100) || (status === 'incomplete' && row.score === 0) || (status === 'missing' && row.missing.length > 0) || (status === 'progress' && row.inProgress.length > 0))
  const summary = summarizeCompliance(locationRows)
  const units = cadence === 'daily' ? 'site-days' : 'site-weeks'
  if (!authorized) return <div><NavBar /><p role="alert" className="p-4">An active checklist account is required to view completion reporting.</p></div>
  return <div className="min-h-screen bg-tm-cream text-slate-900 dark:bg-tm-dark-bg dark:text-tm-dark-text">
    <NavBar />
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-tm-blue dark:text-tm-teal">Operations reporting</p><h1 className="mt-1 text-2xl font-bold">Checklist Compliance</h1><p className="mt-1 text-sm text-slate-600 dark:text-tm-dark-muted">{profile.role === 'admin' ? 'All reporting locations' : 'Your assigned reporting locations'} · Completion status only</p></div>
        <Link to="/checklists" className="rounded-md border border-tm-blue px-4 py-3 text-sm font-semibold dark:border-tm-teal">Back to Manager Checklists</Link>
      </header>
      <p className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">MonitorQA remains official. These checklists remain optional. Missing means no submission is recorded for the selected period, not a retroactive policy violation. This report does not create assignments, deadlines or reminders.</p>
      <section aria-label="Report filters" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-tm-dark-border dark:bg-tm-dark-card">
        <div className="flex gap-2" role="group" aria-label="Reporting period">
          {['daily', 'weekly'].map(value => <button key={value} aria-pressed={cadence === value} onClick={() => setCadence(value)} className={`min-h-11 rounded-md px-5 font-semibold ${cadence === value ? 'bg-tm-navy text-white dark:bg-tm-teal dark:text-tm-navy' : 'border border-slate-300 dark:border-tm-dark-border'}`}>{value === 'daily' ? 'Daily' : 'Weekly'}</button>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cadence === 'daily' ? <>
            <label className="text-sm font-medium">Start date<input className={control} aria-label="Start date" type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
            <label className="text-sm font-medium">End date<input className={control} aria-label="End date" type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
          </> : <label className="text-sm font-medium">Week containing<input className={control} aria-label="Week containing" type="date" value={week} onChange={event => setWeek(event.target.value)} /></label>}
          <label className="text-sm font-medium">Market<select className={control} aria-label="Market" value={market} onChange={event => { setMarket(event.target.value); setSite('') }}><option value="">All markets</option>{markets.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium">Location<select className={control} aria-label="Location" value={site} onChange={event => setSite(event.target.value)}><option value="">All locations</option>{sites.map(location => <option key={location.id} value={location.id}>{location.site_code} · {location.name}</option>)}</select></label>
          <label className="text-sm font-medium">Show<select className={control} aria-label="Completion status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="complete">100% complete</option><option value="incomplete">0% complete</option><option value="missing">Missing checklists</option><option value="progress">In progress</option></select></label>
        </div>
        <p className="text-sm text-slate-600 dark:text-tm-dark-muted">{cadence === 'daily' ? 'Each site-day is 100% only when Opening, Mid-Day and Closing are submitted; otherwise 0%.' : 'Each site-week is 100% only when Manager Administrative and Preventive Maintenance are submitted; otherwise 0%.'} {cadence === 'weekly' && range ? `Week: ${range.start} through ${range.end}. ` : ''}Dates follow each site’s time zone. Weeks run Monday through Sunday. Current periods show completion so far, not overdue status.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="min-h-11 rounded-md bg-tm-blue px-4 font-semibold text-white disabled:opacity-50" disabled={loading || !range} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold disabled:opacity-50 dark:border-tm-dark-border" disabled={!data || !rows.length} onClick={() => downloadComplianceCsv(rows, cadence, range, data.generated_at)}>Export visible rows (CSV)</button>
          {data && <span className="text-xs text-slate-500 dark:text-tm-dark-muted">Snapshot: {new Date(data.generated_at).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>}
        </div>
      </section>
      {validation && <p role="alert">{validation}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {loading && <p role="status">Loading checklist completion…</p>}
      {data && <>
        <section aria-label="Completion summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[['Fully complete', summary.percent === null ? 'N/A' : `${summary.percent}%`, `${summary.complete} of ${summary.total} ${units}`], ['Incomplete', summary.incomplete, '0% complete periods'], ['Missing checklists', summary.missing, 'No saved occurrence'], ['In progress', summary.inProgress, 'Drafts, including discarding']].map(([label, value, detail]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-tm-dark-border dark:bg-tm-dark-card"><p className="text-sm text-slate-600 dark:text-tm-dark-muted">{label}</p><p className="my-1 text-3xl font-bold">{value}</p><p className="text-xs text-slate-500 dark:text-tm-dark-muted">{detail}</p></div>)}
        </section>
        <p className="text-xs text-slate-500 dark:text-tm-dark-muted">Summary covers the selected locations and period, regardless of the status filter. {summary.future > 0 ? `${summary.future} future ${units} are excluded from scoring. ` : ''}Locations excluded from reporting are omitted. Historical records are evaluated for today’s reporting locations; historical openings and closures are not inferred.</p>
        {!rows.length ? <p role="status" className="rounded-lg bg-white p-6 dark:bg-tm-dark-card">No checklist periods match these filters.</p> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-tm-dark-border dark:bg-tm-dark-card" tabIndex={0} role="region" aria-label="Checklist completion table">
          <table className="w-full text-left text-sm"><caption className="sr-only">Checklist completion by site and {cadence === 'daily' ? 'day' : 'week'}</caption><thead className="bg-tm-navy text-white"><tr>{['Location', cadence === 'daily' ? 'Site-local date' : 'Week beginning', ...complianceTemplates[cadence].map(template => template.label), 'Completion', 'Needs attention'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={`${row.site.id}:${row.period}`} className="border-t border-slate-200 align-top dark:border-tm-dark-border"><th scope="row" className="px-4 py-4"><span className="block whitespace-nowrap">{row.site.site_code}</span><span className="block text-xs font-normal text-slate-500 dark:text-tm-dark-muted">{row.site.name}</span><span className="block text-xs font-normal text-slate-500 dark:text-tm-dark-muted">{row.site.timezone}</span></th><td className="whitespace-nowrap px-4 py-4">{row.period}{row.current && <span className="block text-xs text-slate-500 dark:text-tm-dark-muted">Current period · so far</span>}{row.isPilot && <span className="block text-xs text-slate-500 dark:text-tm-dark-muted">Historical pilot</span>}</td>{row.cells.map(cell => <td key={cell.key} className="px-4 py-4"><span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[cell.status]}`}>{complianceStatusLabels[cell.status]}</span>{cell.isPilot && <span className="block text-xs text-slate-500 dark:text-tm-dark-muted">Pilot record</span>}</td>)}<td className="px-4 py-4 text-lg font-bold">{row.score === null ? 'N/A' : `${row.score}%`}</td><td className="min-w-44 px-4 py-4 text-xs">{row.missing.length > 0 && <p>Missing: {row.missing.join(', ')}</p>}{row.inProgress.length > 0 && <p>In progress: {row.inProgress.join(', ')}</p>}{row.score === 100 && 'All submitted'}{row.score === null && 'Future period'}</td></tr>)}</tbody>
          </table>
        </div>}
      </>}
    </main>
  </div>
}
