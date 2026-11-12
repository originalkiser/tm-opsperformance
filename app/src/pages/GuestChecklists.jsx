import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ChecklistForm from '../components/ChecklistForm'
import { supabase, supabasePublicKey } from '../lib/supabase'
import { takeGuestAccess, clearGuestAccess, createChecklistTransport } from '../utils/checklistAccess'
import { checklistPeriod, localChecklistDate } from '../utils/checklistRules'
import '../styles/boldPages.css'

const order = ['opening', 'midday', 'closing', 'weekly', 'weekly_pm']
export default function GuestChecklists() {
  const route = useLocation()
  const [context, setContext] = useState(null), [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const transport = useRef(null), generation = useRef(0), alive = useRef(true), working = useRef(false)
  useEffect(() => {
    alive.current = true; generation.current++; working.current = false
    transport.current = null; setContext(null); setForm(null); setError(''); setBusy(false)
    try {
      const access = takeGuestAccess(window.location, window.history, sessionStorage)
      if (!access) setError('Scan your store’s checklist QR code to continue. No account login is needed.')
      else { transport.current = createChecklistTransport(supabase, supabasePublicKey, access); load() }
    } catch (error) { setError(error.message) }
    return () => { alive.current = false; generation.current++ }
  }, [route.search])
  async function load(more = false) {
    if (!transport.current || working.current) return
    working.current = true; setBusy(true); setError('')
    const current = ++generation.current
    try {
      const result = await transport.current.request('context', more ? { offset: context.next_offset } : {})
      if (!alive.current || current !== generation.current) return
      if (!result.location?.id || !Array.isArray(result.templates) || !Array.isArray(result.submissions)) throw new Error('Store checklist state was not confirmed. Scan the code again.')
      setContext(previous => ({ ...result, submissions: more ? [...new Map([...(previous?.submissions || []), ...result.submissions].map(row => [row.id, row])).values()] : result.submissions }))
    } catch (error) {
      if (alive.current && current === generation.current) { setError(error.message); if (error.status === 401 || error.status === 403) { clearGuestAccess(sessionStorage); setContext(null); setForm(null) } }
    } finally { if (current === generation.current) { working.current = false; if (alive.current) setBusy(false) } }
  }
  async function open(template, record) {
    if (working.current || !transport.current) return
    working.current = true; setBusy(true); setError('')
    const current = generation.current
    try {
      const result = record ? await transport.current.load(record.id) : await transport.current.start({ template_key: template.key })
      if (alive.current && current === generation.current) setForm(result)
    } catch (error) { if (alive.current && current === generation.current) setError(`${error.message} Nothing was retried automatically. Refresh to confirm the saved state.`) }
    finally { if (current === generation.current) { working.current = false; if (alive.current) setBusy(false) } }
  }
  let today = ''
  try { if (context) today = localChecklistDate(context.location.timezone, new Date(context.server_now)) } catch { /* Invalid server/site dates block starts. */ }
  const drafts = context?.submissions.filter(row => row.status === 'draft' || row.working_copy_id) || []
  return <div className="tm-bold-page tm-checklists-page min-h-screen bg-tm-cream dark:bg-tm-dark-bg text-slate-900 dark:text-tm-dark-text">
    <main className="max-w-5xl mx-auto p-4 space-y-5">
      <header className="tm-checklists-title"><h1 className="text-2xl font-bold">Store Checklists</h1><p>{context ? `${context.location.site_code} · ${context.location.name || ''}` : 'Secure store QR access'}</p></header>
      <p className="tm-checklists-notice rounded p-3">No login needed. Anyone with this store’s QR can continue its checklists. Names are self-reported. Internet connection required. MonitorQA remains official.</p>
      {error && <p role="alert" className="border border-red-500 rounded p-3 text-red-700 dark:text-red-300">{error}</p>}
      {busy && <p role="status">Loading checklist…</p>}
      {form ? <ChecklistForm key={`${form.row.id}:${form.row.working_copy_id || 'original'}`} initial={form.row} initialCapabilities={form.capabilities} initialEvidence={form.evidence} transport={transport.current} locationLabel={context?.location.site_code} onSaved={row => setContext(previous => ({ ...previous, submissions: [...previous.submissions.filter(item => item.id !== row.id), row] }))} onClose={() => { setForm(null); load() }} /> : context && <>
        <div className="flex flex-wrap gap-3 items-center"><p>Store-local date: {today || 'Unavailable'}</p><button disabled={busy} className="min-h-12 px-4 border rounded" onClick={() => load()}>Refresh</button></div>
        {['daily', 'weekly'].map(cadence => <section key={cadence} className="tm-checklist-group" data-cadence={cadence}>
          <h2 className="tm-checklist-group-heading font-bold">{cadence === 'daily' ? 'Daily checklists' : 'Weekly checklists'}</h2>
          <div className="tm-checklist-group-body">{[...context.templates].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).filter(template => template.cadence === cadence).map(template => {
            const period = today ? checklistPeriod(template, today) : ''
            const record = context.submissions.find(row => row.template_key === template.key && row.period_date === period)
            return <article key={template.key} className="tm-checklist-card p-4 flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-bold">{template.name}</h3><p>{period} · {record?.status || 'Available'}</p></div><button disabled={busy || !today || record?.status === 'discarding'} className="tm-checklist-action min-h-12 px-4 border rounded" onClick={() => open(template, record)}>{record?.working_copy_id ? 'Resume correction' : record?.status === 'submitted' ? 'View submission' : record?.status === 'draft' ? 'Resume draft' : record?.status === 'discarding' ? 'Admin cleanup pending' : 'Start checklist'}</button></article>
          })}</div>
        </section>)}
        <section className="space-y-3"><h2 className="font-bold text-xl">Unfinished checklists</h2><p>Saved drafts keep their original day or week and can continue on later days.</p>
          {drafts.length ? <ul className="space-y-2">{drafts.map(row => <li key={row.id} className="border rounded p-3 flex flex-wrap justify-between items-center gap-2"><span>{row.template_snapshot.name} · {row.period_date}{row.working_copy_id ? ' · Correction' : ''}</span><button disabled={busy} className="min-h-11 px-3 border rounded" onClick={() => open(null, row)}>Continue</button></li>)}</ul> : <p>No unfinished checklists.</p>}
          {context.has_more && <button disabled={busy} className="min-h-12 px-4 border rounded" onClick={() => load(true)}>Load more saved checklists</button>}
        </section>
      </>}
    </main>
  </div>
}
