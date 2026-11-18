import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useDisplayAuth as useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { localChecklistDate } from '../utils/checklistRules'
import { complianceTemplates, complianceStatusLabels, complianceRange, fetchChecklistCompliance, selectedComplianceRows, summarizeCompliance, downloadComplianceCsv, complianceShortcutRequest, complianceShortcutRange, compliancePeriodLabel, groupComplianceLocations } from '../utils/checklistCompliance'

const control = 'block min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-surface'
const statusClass = { submitted_on_time: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', completed_late: 'bg-violet-100 text-violet-950 dark:bg-violet-950 dark:text-violet-200', overdue: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200', submitted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', draft: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', discarding: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', missing: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200', future: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }

export default function ChecklistCompliance() {
  const { user, profile, locations, managerPreview, previewSiteId } = useAuth()
  const authorized = !!user && profile?.is_active === true && !profile.deleted_at && ['admin', 'store'].includes(profile.role)
  let initialDate = ''
  try { initialDate = localChecklistDate(locations[0]?.timezone) } catch { /* A chosen report date is required if location metadata is unavailable. */ }
  const [cadence, setCadence] = useState('daily')
  const [shortcut, setShortcut] = useState('wtd'), [serverNow, setServerNow] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [start, setStart] = useState(initialDate), [end, setEnd] = useState(initialDate), [week, setWeek] = useState(initialDate)
  const [market, setMarket] = useState(''), [site, setSite] = useState(''), [status, setStatus] = useState('all')
  const [refresh, setRefresh] = useState(0), [result, setResult] = useState(null), [failure, setFailure] = useState(null)
  const request = useRef(0)
  let range, validation = ''
  try { range = shortcut ? complianceShortcutRequest(shortcut, locations.filter(l => l.exclude_from_reporting !== true), serverNow ? new Date(serverNow) : new Date()) : complianceRange(cadence, cadence === 'weekly' ? week : start, end) } catch (error) { validation = error.message }
  const accountScope = `${user?.id}:${profile?.role}:${profile?.location_id}:${managerPreview}:${previewSiteId}:${locations.map(location => location.id).sort().join(',')}`
  const scope = `${authorized}:${accountScope}:${cadence}:${shortcut}:${range?.start}:${range?.end}:${refresh}`
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
      if (request.current === current) {
        setServerNow(data.generated_at)
        setResult({ scope, data: managerPreview ? { ...data, locations: data.locations.filter(l => l.id === previewSiteId), submissions: data.submissions.filter(r => r.location_id === previewSiteId), weekly_periods: data.weekly_periods?.filter(r => r.location_id === previewSiteId) } : data })
      }
    }).catch(error => {
      if (request.current === current) setFailure({ scope, message: error.message })
    })
    return () => { request.current++ }
  }, [scope])

  useEffect(() => { setStatus('all') }, [cadence])
  useEffect(() => { setExpanded({}) }, [scope, market, site, status])

  const markets = [...new Set((data?.locations || []).map(location => location.market).filter(Boolean))].sort()
  const sites = (data?.locations || []).filter(location => !market || location.market === market)
  const locationRows = data ? selectedComplianceRows(data, cadence, range, shortcut).filter(row => (!market || row.site.market === market) && (!site || row.site.id === site)) : []
  const rows = locationRows.filter(row => status === 'all' || (status === 'complete' && row.score === 100) || (status === 'incomplete' && row.score === 0) || (status === 'missing' && row.missing.length > 0) || (status === 'progress' && row.inProgress.length > 0) || (status === 'overdue' && row.overdue?.length > 0) || (status === 'late' && row.late?.length > 0) || (status === 'pending' && compliancePeriodLabel(row) === 'Pending'))
  const summary = summarizeCompliance(locationRows)
  const groups = groupComplianceLocations(locationRows, rows)
  const pending = locationRows.filter(row => compliancePeriodLabel(row) === 'Pending').length
  const units = cadence === 'daily' ? 'site-days' : 'site-weeks'
  if (!authorized) return <div><NavBar /><p role="alert" className="p-4">An active checklist account is required to view completion reporting.</p></div>
  return <div className="min-h-screen bg-tm-cream text-slate-900 dark:bg-tm-dark-bg dark:text-tm-dark-text">
    <NavBar />
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-tm-blue dark:text-tm-teal">Operations reporting</p><h1 className="mt-1 text-2xl font-bold">Checklist Compliance</h1><p className="mt-1 text-sm text-slate-600 dark:text-tm-dark-muted">{profile.role === 'admin' ? 'All reporting locations' : 'Your assigned reporting locations'} · Daily and weekly compliance</p></div>
        <Link to="/checklists" className="rounded-md border border-tm-blue px-4 py-3 text-sm font-semibold dark:border-tm-teal">Back to Manager Checklists</Link>
      </header>
      <p className="text-xs text-slate-600 dark:text-tm-dark-muted">MonitorQA remains official; these checklists remain optional. Earlier periods retain their original rules.</p>
      <section aria-label="Report filters" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-tm-dark-border dark:bg-tm-dark-card">
        <div className="flex flex-wrap justify-between gap-3">
          <div className="flex gap-2" role="group" aria-label="Reporting period">
            {['daily', 'weekly'].map(value => <button key={value} aria-pressed={cadence === value} onClick={() => setCadence(value)} className={`min-h-11 rounded-md px-5 font-semibold ${cadence === value ? 'bg-tm-navy text-white dark:bg-tm-teal dark:text-tm-navy' : 'border border-slate-300 dark:border-tm-dark-border'}`}>{value === 'daily' ? 'Daily' : 'Weekly'}</button>)}
          </div>
          <div className="flex gap-2" role="group" aria-label="Date shortcuts">
            {[['lw', 'LW', 'Last week'], ['wtd', 'WTD', 'Week to date'], ['mtd', 'MTD', 'Month to date']].map(([value, label, title]) => <button key={value} title={title} aria-label={`${label} · ${title}`} aria-pressed={shortcut === value} onClick={() => setShortcut(value)} className={`min-h-11 rounded-md border px-5 font-bold ${shortcut === value ? 'border-tm-blue bg-tm-blue text-white dark:border-tm-teal dark:bg-tm-teal dark:text-tm-navy' : 'border-slate-300 dark:border-tm-dark-border'}`}>{label}</button>)}
          </div>
        </div>
        <p className="text-sm font-medium">{shortcut ? { lw: 'Last complete week', wtd: 'Week to date', mtd: 'Month to date' }[shortcut] : 'Manual dates'} · {range ? `${range.start} – ${range.end}` : 'Choose dates'}<span className="block text-xs font-normal text-slate-500 dark:text-tm-dark-muted">Site-local dates{cadence === 'weekly' ? ' · Whole intersecting Monday–Sunday weeks' : ''}</span></p>
        <details className="rounded-md border border-slate-200 p-3 dark:border-tm-dark-border">
          <summary className="cursor-pointer text-sm font-semibold">Dates, filters and reporting rules</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cadence === 'daily' ? <>
            <label className="text-sm font-medium">Start date<input className={control} aria-label="Start date" type="date" value={shortcut ? range?.start || start : start} onChange={event => { setEnd(range?.end || end); setShortcut(null); setStart(event.target.value) }} /></label>
            <label className="text-sm font-medium">End date<input className={control} aria-label="End date" type="date" value={shortcut ? range?.end || end : end} onChange={event => { setStart(range?.start || start); setShortcut(null); setEnd(event.target.value) }} /></label>
          </> : <label className="text-sm font-medium">Week containing (manual)<input className={control} aria-label="Week containing" type="date" value={week} onChange={event => { setShortcut(null); setWeek(event.target.value) }} /></label>}
          <label className="text-sm font-medium">Market<select className={control} aria-label="Market" value={market} onChange={event => { setMarket(event.target.value); setSite('') }}><option value="">All markets</option>{markets.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium">Location<select className={control} aria-label="Location" value={site} onChange={event => setSite(event.target.value)}><option value="">All locations</option>{sites.map(location => <option key={location.id} value={location.id}>{location.site_code} · {location.name}</option>)}</select></label>
          <label className="text-sm font-medium">Show<select className={control} aria-label="Completion status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="complete">100% complete</option><option value="incomplete">0% complete</option><option value="pending">Pending periods</option><option value="missing">Missing checklists</option><option value="progress">In progress</option>{cadence === 'weekly' && <><option value="overdue">Overdue</option><option value="late">Completed Late</option></>}</select></label>
        </div>
        <p className="text-sm text-slate-600 dark:text-tm-dark-muted">{cadence === 'daily' ? 'Each site-day is 100% only when Opening, Mid-Day and Closing are submitted; otherwise 0%.' : 'New-policy weeks are 100% only when both weekly checklists were submitted on time; missing or Completed Late is 0%. Earlier weeks retain completion-only scoring.'} {range ? `Selected dates: ${range.start} through ${range.end}. ` : ''}{cadence === 'weekly' ? 'Whole Monday–Sunday reporting weeks intersecting those dates are included. ' : ''}{shortcut ? 'Shortcuts use each site’s local date; exact site ranges appear below. ' : ''}Dates follow each site’s time zone. Weeks run Monday through Sunday. Incomplete work is overdue only after its applicable deadline; in-progress and Completed Late remain separately visible.</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-tm-dark-muted">Site percentages cover all selected eligible periods, regardless of the status filter. The filter applies to expanded details and CSV. Future periods are excluded. Reporting uses today’s eligible locations; historical openings and closures are not inferred.</p>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <button className="min-h-11 rounded-md bg-tm-blue px-4 font-semibold text-white disabled:opacity-50" disabled={loading || !range} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold disabled:opacity-50 dark:border-tm-dark-border" disabled={!data || !rows.length} onClick={() => downloadComplianceCsv(rows, cadence, range, data.generated_at)}>Export detailed rows (CSV)</button>
          {data && <span className="text-xs text-slate-500 dark:text-tm-dark-muted">Snapshot: {new Date(data.generated_at).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>}
        </div>
      </section>
      {validation && <p role="alert">{validation}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {loading && <p role="status">Loading checklist completion…</p>}
      {data && <>
        <section aria-label="Completion summary" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-tm-dark-border dark:bg-tm-dark-card">
          <p><strong className="text-xl">{summary.percent === null ? 'N/A' : `${summary.percent}%`}</strong> <span className="text-sm">overall · {summary.complete} / {summary.total} compliant {units}</span></p>
          <p className="text-sm text-slate-600 dark:text-tm-dark-muted">{groups.length} locations · {pending} pending periods{summary.completedLate ? ` · ${summary.completedLate} checklists Completed Late` : ''}</p>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-3xl text-xs text-slate-500 dark:text-tm-dark-muted">Pending periods count as 0% so far; future periods are excluded. Expand a site for details.</p>
          <div className="flex gap-2">
            <button disabled={!groups.length} onClick={() => setExpanded(Object.fromEntries(groups.map(group => [group.site.id, true])))} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50 dark:border-tm-dark-border">Expand All</button>
            <button disabled={!Object.values(expanded).some(Boolean)} onClick={() => setExpanded({})} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50 dark:border-tm-dark-border">Collapse All</button>
          </div>
        </div>
        {!groups.length ? <p role="status" className="rounded-lg bg-white p-6 dark:bg-tm-dark-card">No checklist periods match these filters.</p> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-tm-dark-border dark:bg-tm-dark-card">
          <table className="w-full table-fixed text-left text-sm" aria-label="Compliance by location"><caption className="sr-only">Location summaries; expand to reveal individual reporting periods</caption>
            <thead className="bg-tm-navy text-white"><tr><th scope="col" className="w-1/2 px-3 py-3 sm:px-4">Location</th><th scope="col" className="w-1/4 px-2 py-3 text-right">Compliance</th><th scope="col" className="w-1/4 px-3 py-3 text-right sm:px-4">Compliant / eligible</th></tr></thead>
            <tbody>{groups.map(group => <Fragment key={group.site.id}>
              <tr className="border-t border-slate-200 dark:border-tm-dark-border" data-location-summary={group.site.id}>
                <th scope="row" className="px-3 py-2 sm:px-4">
                  <button aria-expanded={!!expanded[group.site.id]} aria-controls={`periods-${group.site.id}`} onClick={() => setExpanded(value => ({ ...value, [group.site.id]: !value[group.site.id] }))} className="flex min-h-11 w-full items-start gap-2 py-1 text-left">
                    <span aria-hidden="true" className="mt-0.5">{expanded[group.site.id] ? '▾' : '▸'}</span>
                    <span className="min-w-0 break-words"><span className="block font-bold">{group.site.site_code} · {group.site.name}</span>{shortcut && (() => { const r = complianceShortcutRange(shortcut, group.site.local_today); return r.start !== range.start || r.end !== range.end ? <span className="block text-xs font-normal text-slate-500 dark:text-tm-dark-muted">{r.start} – {r.end}</span> : null })()}{(group.pending > 0 || group.late > 0) && <span className="block text-xs font-normal">{[group.pending ? `${group.pending} Pending` : '', group.late ? `${group.late} Completed Late` : ''].filter(Boolean).join(' · ')}</span>}</span>
                  </button>
                </th>
                <td className="px-2 py-2 text-right text-lg font-bold sm:text-xl">{group.summary.percent === null ? 'N/A' : `${group.summary.percent}%`}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums sm:px-4">{group.summary.complete} / {group.summary.total}</td>
              </tr>
              {expanded[group.site.id] && <tr id={`periods-${group.site.id}`}><td colSpan={3} className="bg-slate-50 p-3 dark:bg-tm-dark-surface sm:p-4">
                <section aria-label={`${group.site.site_code} reporting periods`} className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-tm-dark-muted">{group.site.timezone} · {group.rows.length} matching {cadence === 'daily' ? 'days' : 'weeks'}{status !== 'all' ? ' · status filter applies to details' : ''}</p>
                  {group.rows.map(row => <article key={row.period} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-tm-dark-border dark:bg-tm-dark-card">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{row.period}{cadence === 'weekly' ? ` – ${row.end}` : ''}</h3><p className="text-sm font-semibold">{compliancePeriodLabel(row)} · {row.score === null ? 'N/A' : `${row.score}%`}{row.current && row.score !== 100 ? ' so far' : ''}</p></div>
                    {row.weeklyTiming && <p className="mt-1 text-xs text-slate-600 dark:text-tm-dark-muted">Due Monday {row.weeklyTiming.due_date}, 11:59 p.m. site-local</p>}
                    {row.isPilot && <p className="text-xs text-slate-500 dark:text-tm-dark-muted">Historical pilot</p>}
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Required checklist statuses">{row.cells.map(cell => <li key={cell.key} className={`rounded-md px-2.5 py-1.5 text-xs ${statusClass[cell.displayStatus || cell.status]}`}><span className="font-semibold">{cell.label}:</span> {complianceStatusLabels[cell.displayStatus || cell.status]}{cell.displayStatus === 'overdue' ? ` (${complianceStatusLabels[cell.status]})` : ''}{cell.isPilot ? ' · Pilot' : ''}</li>)}</ul>
                  </article>)}
                </section>
              </td></tr>}
            </Fragment>)}</tbody>
          </table>
        </div>}
      </>}
    </main>
  </div>
}
