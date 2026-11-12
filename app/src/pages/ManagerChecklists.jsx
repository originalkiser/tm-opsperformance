import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import ChecklistAccessForm from '../components/ChecklistAccessForm'
import ChecklistQrAdmin from '../components/ChecklistQrAdmin'
import ChecklistOpenWork from '../components/ChecklistOpenWork'
import ChecklistAdmin from '../components/ChecklistAdmin'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { checklistPeriod, completionStatus, localChecklistDate, checklistTimestamp } from '../utils/checklistRules'
import '../styles/boldPages.css'

const displayOrder = ['opening', 'midday', 'closing', 'weekly', 'weekly_pm']

export default function ManagerChecklists() {
  const { user, profile, locations } = useAuth()
  const authorized = !!user && profile?.is_active === true && !profile.deleted_at && ['admin', 'store', 'area_manager'].includes(profile.role)
  const admin = authorized && profile.role === 'admin'
  const [templates, setTemplates] = useState([]), [rows, setRows] = useState([])
  const [site, setSite] = useState(locations[0]?.id || ''), [date, setDate] = useState(''), [form, setForm] = useState(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [showAdmin, setShowAdmin] = useState(false)
  const request = useRef(0)
  const selected = locations.find(location => location.id === site)
  let today = ''
  try { today = localChecklistDate(selected?.timezone) } catch { /* Invalid zones block starting a checklist. */ }
  const scope = locations
  useEffect(() => { setDate(today) }, [site, today])
  async function load() {
    if (!authorized) { setTemplates([]); setRows([]); setForm(null); return }
    const current = ++request.current
    setError(''); setBusy(true)
    try {
      const start = date ? checklistPeriod({ cadence: 'weekly' }, date) : '9999-01-01'
      const results = await Promise.all([
        supabase.from('checklist_templates').select('*'),
        supabase.from('checklist_submissions').select('*').gte('period_date', start).lte('period_date', date || start).order('created_at'),
      ])
      if (current !== request.current) return
      const failed = results.find(result => result.error)
      if (failed) throw failed.error
      setTemplates([...(results[0].data || [])].sort((a, b) =>
        (displayOrder.indexOf(a.key) < 0 ? displayOrder.length : displayOrder.indexOf(a.key)) -
        (displayOrder.indexOf(b.key) < 0 ? displayOrder.length : displayOrder.indexOf(b.key))))
      setRows(results[1].data || [])

    } catch (error) { if (current === request.current) setError(error.message) } finally { if (current === request.current) setBusy(false) }
  }
  useEffect(() => { load(); return () => { request.current++ } }, [date, user?.id, authorized])
  useEffect(() => { if (!admin && scope.length && !scope.some(location => location.id === site)) setSite(scope[0].id) }, [locations, site])
  async function open(template, record) {
    setBusy(true); setError('')
    try {
      if (!record) {
        const result = await supabase.rpc('save_checklist', { p_template: template.key, p_location: site, p_date: checklistPeriod(template, date) })
        if (result.error) throw result.error
        record = result.data
      }
      setForm(record)
    } catch (error) { setError(`${error.message} No automatic retry. Another manager may already have started this occurrence; ask Admin to review.`) } finally { setBusy(false) }
  }
  if (!authorized) return <div><NavBar /><p role="alert">Active checklist account required.</p></div>
  return <div className="tm-bold-page tm-checklists-page min-h-screen bg-tm-cream dark:bg-tm-dark-bg text-slate-900 dark:text-tm-dark-text">
    <NavBar />
    <main className="max-w-5xl mx-auto p-4 space-y-5">
      <header className="tm-checklists-title"><h1 className="text-2xl font-bold">Manager Checklists</h1></header>
      <p className="tm-checklists-notice rounded p-3">MonitorQA remains the official checklist system. Checklists are available, not mandatory. No automatic assignments or reminders. Online connection required.</p>
      {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
      {form ? <ChecklistAccessForm key={form.id} initial={form} user={user} admin={admin} locationLabel={locations.find(location => location.id === form.location_id)?.site_code} onSaved={saved => setRows(previous => [...previous.filter(row => row.id !== saved.id), saved])} onClose={() => { setForm(null); load() }} /> : <>
        <div className="tm-checklists-filters flex flex-wrap gap-4">
          <label>Location<select aria-label="Checklist location" disabled={busy} value={site} onChange={e => setSite(e.target.value)} className="block p-3 border rounded bg-white dark:bg-tm-dark-surface">
            {!scope.length && <option value="">No assigned locations</option>}{scope.map(location => <option key={location.id} value={location.id}>{location.site_code}</option>)}</select></label>
          <label>Site-local checklist date<input aria-label="Checklist date" type="date" disabled={busy} value={date} max={today} onChange={e => setDate(e.target.value)} className="block p-3 border rounded bg-transparent" /></label>
          <button disabled={busy} className="min-h-12 px-4 border rounded" onClick={load}>Refresh</button>
        </div>
        {!today && <p role="alert">A valid site time zone is required before starting a checklist.</p>}
        {scope.length === 0 && !admin && <p>No assigned checklist locations are available.</p>}
        {today && date && ['daily', 'weekly'].map(cadence => <div role="group" key={cadence} className="tm-checklist-group" data-cadence={cadence} aria-label={cadence === 'daily' ? 'Daily checklists' : 'Weekly checklists'}>
          <div className="tm-checklist-group-heading font-brand font-bold">{cadence === 'daily' ? 'Daily checklists' : 'Weekly checklists'}</div>
          <div className="tm-checklist-group-body">{templates.filter(template => template.cadence === cadence).map(template => {
          const period = checklistPeriod(template, date)
          const records = rows.filter(row => row.location_id === site)
          const record = records.find(row => row.template_key === template.key && row.period_date === period)
          return scope.some(location => location.id === site) && <section key={template.key} className="tm-checklist-card p-4 flex flex-wrap gap-4 justify-between items-center" data-status={record?.status || 'available'}>
            <div className="tm-checklist-card-copy"><h2 className="font-bold">{template.name}</h2><p className="tm-checklist-card-meta"><span className="tm-checklist-status">{completionStatus(template, date, records)}</span> · {period}{record?.is_pilot ? ' · Historical pilot' : ''}</p></div>
            <button disabled={busy || date > today} className="tm-checklist-action min-h-12 px-5 rounded border" onClick={() => open(template, record)}>{record?.status === 'submitted' ? 'View submission' : record?.status === 'discarding' ? 'Finish discarding draft' : record ? 'Resume draft' : 'Start checklist'}</button>
          </section>
        })}</div></div>)}
        {site && <ChecklistOpenWork key={site} locationId={site} onOpen={record => open(null, record)} disabled={busy} />}
        {admin && <>
          <h2 className="tm-checklist-review-heading font-bold text-lg">Checklist submission review</h2>
          <p>Existing records from Monday through the selected site-local date. No missing or overdue obligations are generated.</p>
          <ul>{rows.map(record => <li key={record.id} className="border-b py-3">
            {locations.find(location => location.id === record.location_id)?.site_code} · {record.template_snapshot.name} · {record.period_date} · {record.status}{record.is_pilot ? ' · Historical pilot' : ''}
            <button disabled={busy} className="min-h-12 px-4 underline" onClick={() => open(null, record)}>Review {record.status} · {record.manager_name || 'Unnamed draft'} · {checklistTimestamp(record.submitted_at || record.updated_at, record.template_snapshot.timezone)}</button>
          </li>)}</ul>
          <button className="min-h-12 px-4 border rounded" onClick={() => setShowAdmin(previous => !previous)}>{showAdmin ? 'Hide' : 'Manage'} checklist templates</button>
          {showAdmin && <><ChecklistQrAdmin location={selected} /><ChecklistAdmin templates={templates} reload={load} /></>}
        </>}
      </>}
    </main>
  </div>
}
