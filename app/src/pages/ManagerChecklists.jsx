import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import ChecklistForm from '../components/ChecklistForm'
import ChecklistAdmin from '../components/ChecklistAdmin'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { checklistPeriod, completionStatus, localChecklistDate, checklistTimestamp } from '../utils/checklistRules'

const displayOrder = ['opening', 'midday', 'closing', 'weekly']

export default function ManagerChecklists() {
  const { user, profile, locations } = useAuth()
  const admin = profile?.role === 'admin'
  const [templates, setTemplates] = useState([]), [grants, setGrants] = useState([]), [rows, setRows] = useState([])
  const [site, setSite] = useState(locations[0]?.id || ''), [date, setDate] = useState(''), [form, setForm] = useState(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [showAdmin, setShowAdmin] = useState(false)
  const request = useRef(0)
  const selected = locations.find(location => location.id === site)
  let today = ''
  try { today = localChecklistDate(selected?.timezone) } catch { /* Invalid zones block starting a checklist. */ }
  const scope = locations.filter(location => admin || grants.some(grant => grant.location_id === location.id && grant.is_active))
  useEffect(() => { setDate(today) }, [site, today])
  async function load() {
    const current = ++request.current
    setError(''); setBusy(true)
    try {
      const start = date ? checklistPeriod({ cadence: 'weekly' }, date) : '9999-01-01'
      const results = await Promise.all([
        supabase.from('checklist_templates').select('*'),
        supabase.from('checklist_pilot_access').select('*'),
        supabase.from('checklist_submissions').select('*').gte('period_date', start).lte('period_date', date || start).order('created_at'),
      ])
      if (current !== request.current) return
      const failed = results.find(result => result.error)
      if (failed) throw failed.error
      setTemplates([...(results[0].data || [])].sort((a, b) =>
        (displayOrder.indexOf(a.key) < 0 ? displayOrder.length : displayOrder.indexOf(a.key)) -
        (displayOrder.indexOf(b.key) < 0 ? displayOrder.length : displayOrder.indexOf(b.key))))
      setGrants(results[1].data || []); setRows(results[2].data || [])
    } catch (error) { if (current === request.current) setError(error.message) } finally { if (current === request.current) setBusy(false) }
  }
  useEffect(() => { load(); return () => { request.current++ } }, [date, user.id])
  useEffect(() => { if (!admin && scope.length && !scope.some(location => location.id === site)) setSite(scope[0].id) }, [grants, site])
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
  return <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg text-slate-900 dark:text-tm-dark-text">
    <NavBar />
    <main className="max-w-5xl mx-auto p-4 space-y-5">
      <h1 className="text-2xl font-bold">Manager Checklists</h1>
      <p className="border border-amber-500 rounded p-3">Pilot only — MonitorQA remains the official checklist system. No automatic assignments or reminders. Online connection required.</p>
      {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
      {form ? <ChecklistForm key={form.id} initial={form} user={user} admin={admin} locationLabel={locations.find(location => location.id === form.location_id)?.site_code} onSaved={saved => setRows(previous => [...previous.filter(row => row.id !== saved.id), saved])} onClose={() => { setForm(null); load() }} /> : <>
        <div className="flex flex-wrap gap-4">
          <label>Location<select aria-label="Checklist location" disabled={busy} value={site} onChange={e => setSite(e.target.value)} className="block p-3 border rounded bg-white dark:bg-tm-dark-surface">
            {!scope.length && <option value="">No pilot locations</option>}{scope.map(location => <option key={location.id} value={location.id}>{location.site_code}</option>)}</select></label>
          <label>Site-local checklist date<input aria-label="Checklist date" type="date" disabled={busy} value={date} max={today} onChange={e => setDate(e.target.value)} className="block p-3 border rounded bg-transparent" /></label>
          <button disabled={busy} className="min-h-12 px-4 border rounded" onClick={load}>Refresh</button>
        </div>
        {!today && <p role="alert">A valid site time zone is required before starting a checklist.</p>}
        {scope.length === 0 && !admin && <p>Checklist pilot access is not enabled for your assigned location.</p>}
        {today && date && templates.map(template => {
          const period = checklistPeriod(template, date)
          const enabled = admin || grants.some(grant => grant.location_id === site && grant.is_active && grant.enabled_from <= period)
          const records = rows.filter(row => row.location_id === site)
          const record = records.find(row => row.template_key === template.key && row.period_date === period)
          return enabled && <section key={template.key} className="border rounded p-4 bg-white dark:bg-tm-dark-surface flex flex-wrap gap-4 justify-between items-center">
            <div><h2 className="font-bold">{template.name}</h2><p>{completionStatus(template, date, records, today)} · {period}{template.cadence === 'weekly' ? ' · Due Monday end of site-local calendar day' : ''}</p></div>
            <button disabled={busy || date > today} className="min-h-12 px-5 rounded border" onClick={() => open(template, record)}>{record?.status === 'submitted' ? 'View submission' : record?.status === 'discarding' ? 'Finish discarding draft' : record ? 'Resume draft' : 'Start checklist'}</button>
          </section>
        })}
        {admin && <>
          <h2 className="font-bold text-lg">Pilot completion review</h2>
          <p>Missing/incomplete records below cover enabled pilot grants only, on the selected site-local date or Monday week. Multiple user grants at one site share one checklist occurrence.</p>
          <ul>{locations.flatMap(location => templates.map(template => {
            const period = date && checklistPeriod(template, date)
            if (!period || !grants.some(grant => grant.location_id === location.id && grant.is_active && grant.enabled_from <= period)) return null
            const records = rows.filter(row => row.location_id === location.id), record = records.find(row => row.template_key === template.key && row.period_date === period)
            let localToday
            try { localToday = localChecklistDate(location.timezone) } catch { return <li key={`${location.id}-${template.key}`}>{location.site_code}: valid time zone required.</li> }
            return <li key={`${location.id}-${template.key}`} className="border-b py-3">{location.site_code} · {template.name} · {period} · {completionStatus(template, date, records, localToday)}
              {record && <button disabled={busy} className="min-h-12 px-4 underline" onClick={() => open(template, record)}>Review {record.status} · {record.manager_name || 'Unnamed draft'} · {checklistTimestamp(record.submitted_at || record.updated_at, record.template_snapshot.timezone)}</button>}
            </li>
          }))}</ul>
          <button className="min-h-12 px-4 border rounded" onClick={() => setShowAdmin(previous => !previous)}>{showAdmin ? 'Hide' : 'Manage'} pilot access and templates</button>
          {showAdmin && <ChecklistAdmin templates={templates} grants={grants} locations={locations} reload={load} />}
        </>}
      </>}
    </main>
  </div>
}
