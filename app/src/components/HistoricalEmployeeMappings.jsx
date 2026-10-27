import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadRoster } from '../utils/employeeRoster.js'
import { changeMapping, historicalUsage, loadMappingHistory, readMappingAudit } from '../utils/historicalEmployeeMappings.js'

const control = 'rounded border border-gray-300 dark:border-tm-dark-border bg-white dark:bg-tm-dark-card p-2 text-sm disabled:opacity-50'
const total = value => value == null ? 'Unknown (attribution correction)' : String(value)
export default function HistoricalEmployeeMappings({ locationId, isAdmin }) {
  const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null), [employeeId, setEmployeeId] = useState('')
  const [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState(''), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [audit, setAudit] = useState(null)
  const alive = useRef(true), saving = useRef(false), request = useRef(0)
  async function reload() {
    const version = ++request.current
    setState(null); setError(''); setEdit(null); setAudit(null)
    try {
      const [history, roster] = await Promise.all([loadMappingHistory(supabase, locationId), loadRoster(supabase, locationId)])
      if (alive.current && version === request.current) setState({ ...history, roster, aliases: historicalUsage(history.logs, locationId).aliases })
    } catch (e) { if (alive.current && version === request.current) setError(e.message || 'Could not load historical names.') }
  }
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; request.current++ } }, [locationId])
  function open(originalName, mapping = null, action = 'propose', lastDate = '') {
    setEdit({ originalName, mapping, action }); setEmployeeId(mapping?.employee_id || '')
    setStartDate(mapping?.start_date || ''); setEndDate(mapping?.end_date || (mapping ? '' : lastDate))
    setNote(''); setConfirmed(false); setError(''); setAudit(null)
  }
  async function save(e) {
    e.preventDefault()
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      await changeMapping(supabase, { action: edit.action, locationId, mapping: edit.mapping,
        originalName: edit.originalName, employeeId, startDate, endDate, note, confirmed })
      if (alive.current) await reload()
    } catch (e) { if (alive.current) setError(e.message || 'Mapping decision failed. Reload before retrying.') }
    finally { saving.current = false; if (alive.current) setBusy(false) }
  }
  async function showAudit(mapping) {
    setAudit(null); setError('')
    const version = request.current
    try {
      const data = await readMappingAudit(supabase, mapping.id)
      if (alive.current && version === request.current) setAudit({ mapping, rows: data })
    } catch (e) { if (alive.current) setError(e.message) }
  }
  const selectedEmployee = state?.roster.find(row => row.id === employeeId)
  return <section aria-label="Historical employee name mapping" className="space-y-3 border-t pt-4">
    <h2 className="text-xl font-bold">Historical name mapping</h2>
    <p>Original Daily Logs are preserved. Propose only verified identities. Admin approval combines aliases in Team Member Sales; other dashboards and entry behavior do not change. Each spelling, including the official roster name if present in history, needs explicit approval; matching spelling alone never assigns identity.</p>
    <p className="text-sm">Sales below use the existing cumulative checkpoint differences, not a sum of running totals. Exact recorded spellings are separate. Blank names remain unresolved. Dates cannot distinguish two people using the same name on the same day: leave that activity unmapped.</p>
    <button className={control} onClick={reload} disabled={busy}>Reload history and mappings</button>
    {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    {!state && !error && <p role="status">Loading complete location history…</p>}
    {state && <>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Historical recorded names at this location</caption>
        <thead><tr>{['Original recorded name', 'Log appearances', 'Membership sales', 'Most recent date', 'Mapping status / dates', 'Action'].map(title => <th key={title} className="p-2">{title}</th>)}</tr></thead>
        <tbody>{state.aliases.map(alias => {
          const mappings = state.mappings.filter(row => row.original_name === alias.original_name)
          return <tr key={alias.original_name} className="border-t align-top">
            <td className="p-2 whitespace-pre-wrap">{JSON.stringify(alias.original_name)}</td><td className="p-2">{alias.appearances}</td><td className="p-2">{total(alias.memberships)}</td><td className="p-2">{alias.last_date}</td>
            <td className="p-2">{!mappings.length ? 'Unmapped' : mappings.map(mapping => <div key={mapping.id} className="mb-3">
              <strong>{mapping.status}</strong> → {mapping.employee_name || 'Unavailable roster record'}<br />
              {mapping.start_date || 'Beginning of history'} – {mapping.end_date || 'No end date'} · v{mapping.version}<br />
              <span className="text-xs">{mapping.note}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                <button className={control} disabled={busy} onClick={() => showAudit(mapping)}>Audit</button>
                {isAdmin && <>
                  {mapping.status === 'proposed' && <button className={control} disabled={busy} onClick={() => open(alias.original_name, mapping, 'approve')}>Approve</button>}
                  {mapping.status === 'approved' && <button className={control} disabled={busy} onClick={() => open(alias.original_name, mapping, 'lock')}>Lock</button>}
                  {['proposed', 'approved', 'locked'].includes(mapping.status) && <button className={control} disabled={busy} onClick={() => open(alias.original_name, mapping, 'reject')}>{mapping.status === 'locked' ? 'Revoke locked mapping' : 'Reject'}</button>}
                  <button className={control} disabled={busy} onClick={() => open(alias.original_name, mapping, 'correct')}>Correct{mapping.status === 'locked' ? ' locked mapping' : ''}</button>
                </>}
              </div>
            </div>)}</td>
            <td className="p-2"><button className={control} disabled={busy} onClick={() => open(alias.original_name, null, 'propose', alias.last_date)}>Propose date-scoped mapping</button></td>
          </tr>
        })}</tbody>
      </table></div>
      {!state.aliases.length && <p>No named historical activity at this location.</p>}
    </>}
    {edit && state && <form aria-label="Mapping decision" onSubmit={save} className="border-2 border-tm-teal rounded p-4 space-y-3">
      <h3 className="font-bold">{edit.action} mapping for {JSON.stringify(edit.originalName)}</h3>
      <label className="block">Official roster employee <select className={control} value={employeeId} required disabled={busy || !['propose', 'correct'].includes(edit.action)} onChange={e => setEmployeeId(e.target.value)}>
        <option value="">Choose explicitly; no automatic match</option>
        {state.roster.map(row => <option key={row.id} value={row.id}>{row.name} · {row.id} · {row.is_active ? 'Active' : 'Inactive'}</option>)}
      </select></label>
      <label className="block">From date (blank = beginning of history) <input type="date" className={control} value={startDate} disabled={busy || !['propose', 'correct'].includes(edit.action)} onChange={e => setStartDate(e.target.value)} /></label>
      <label className="block">Through date, inclusive (blank = no end date) <input type="date" className={control} value={endDate} disabled={busy || !['propose', 'correct'].includes(edit.action)} onChange={e => setEndDate(e.target.value)} /></label>
      <p>No end date also covers future activity with this exact recorded name. Overlapping approved date intervals are refused.</p>
      <label className="block">Identity evidence / decision reason <textarea className={control} required value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
      {edit.action !== 'reject' && <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> I verified that every occurrence of this exact name within these dates belongs to {selectedEmployee?.name || 'the selected employee'}. Ambiguous same-day activity must remain unmapped.</label>}
      <p>This decision never rewrites Daily Logs, names, employee IDs or sales. Approving, rejecting or correcting an approved/locked decision changes report attribution on refresh and is audited.</p>
      <button className={control} disabled={busy || !employeeId || !note.trim() || (edit.action !== 'reject' && !confirmed)}>Confirm {edit.action}</button>
      <button type="button" className={control} disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
    </form>}
    {audit && <section aria-label="Mapping audit" className="border rounded p-3"><h3 className="font-bold">Audit · latest 100 decisions</h3>
      {audit.rows.map(row => <details key={row.id} className="py-2"><summary>{row.occurred_at} · {row.operation} · Actor {row.actor_id}</summary><p>{row.reason}</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ before: row.before_state, after: row.after_state }, null, 2)}</pre></details>)}
    </section>}
  </section>
}
