import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { consolidationPreview, employeeConsolidation, loadMappingHistory } from '../utils/historicalEmployeeMappings.js'

const control = 'rounded border px-3 py-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-card disabled:opacity-50'
const panel = 'm-auto w-full max-w-2xl max-h-[85dvh] overflow-auto rounded-xl p-5 text-gray-900 dark:bg-tm-dark-surface dark:text-tm-dark-text backdrop:bg-black/40'

function Dialog({ title, children, onClose, busy }) {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    node.showModal()
    return () => node.close()
  }, [])
  return <dialog ref={ref} className={panel} aria-label={title} onCancel={e => {
    e.preventDefault()
    if (!busy) onClose()
  }}>
    <h3 className="text-lg font-bold">{title}</h3>
    {children}
  </dialog>
}

export default function EmployeeConsolidation({ locationId, roster, initialNames = [], initialRecords = [], history, onClose, onSaved }) {
  const [logs, setLogs] = useState(history ?? null)
  const [names, setNames] = useState(initialNames)
  const [records, setRecords] = useState(initialRecords)
  const [retained, setRetained] = useState('')
  const [custom, setCustom] = useState(false)
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const saving = useRef(false)
  useEffect(() => {
    if (history) return
    let active = true
    loadMappingHistory(supabase, locationId).then(data => {
      if (!active) return
      setLogs(data.logs)
      setNames([...new Set(data.logs.filter(row => initialRecords.includes(row.employee_id) && row.employee_name?.trim()).map(row => row.employee_name))])
    }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [locationId, history])
  const preview = useMemo(() => consolidationPreview(logs ?? [], locationId, names, custom ? start : '', custom ? end : ''),
    [logs, locationId, names, custom, start, end])
  const availableNames = useMemo(() => [...new Set((logs ?? []).map(row => row.employee_name).filter(name => name?.trim()))].sort(), [logs])
  const chosen = roster.filter(row => records.includes(row.id))
  const canSave = logs && retained && confirmed && reason.trim() && (names.length || chosen.length>=2)
    && preview.aliases.length===names.length && (chosen.length===0 || chosen.length>=2 && records.includes(retained))
    && (!custom || !start || !end || start<=end)
  async function save(event) {
    event.preventDefault()
    if (!canSave || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await employeeConsolidation(supabase, locationId, 'apply', {
        retained, confirmed, reason: reason.trim(), from: custom && start || null, through: custom && end || null,
        aliases: preview.aliases.map(a => ({ name:a.original_name, appearances:a.appearances, start:a.first_date, end:a.last_date })),
        roster: chosen.map(({ id, name, is_active }) => ({ id, name, is_active })),
      })
      onSaved()
    } catch (error) { setError(error.message) }
    finally { saving.current = false; setBusy(false) }
  }
  function toggle(set, value, checked) {
    setConfirmed(false)
    set(list => checked ? [...list, value] : list.filter(item => item !== value))
  }
  return <Dialog title="These are the same person" onClose={onClose} busy={busy}>
    <form className="mt-3 space-y-3" onSubmit={save}>
      {!logs && !error && <p role="status">Loading historical activity…</p>}
      {error && <p role="alert">{error}</p>}
      <label className="block">Retained employee <select className={control} value={retained} required disabled={busy} onChange={e => { setRetained(e.target.value);setConfirmed(false) }}>
        <option value="">Choose existing record</option>
        {roster.map(row => <option key={row.id} value={row.id}>{row.name} · {row.is_active?'Active':'Inactive'} · {row.id.slice(0,8)}</option>)}
      </select></label>
      <details open={!initialNames.length}>
        <summary>{names.length} selected historical names</summary>
        <div className="max-h-32 overflow-y-auto">{availableNames.map(name => <label className="block p-1" key={name}>
          <input type="checkbox" checked={names.includes(name)} onChange={e => toggle(setNames,name,e.target.checked)} disabled={busy}/> {name}
        </label>)}</div>
      </details>
      <details open={!!initialRecords.length}>
        <summary>{records.length} roster records selected for status changes</summary>
        <p className="text-sm">Select the retained record and every duplicate you want deactivated. Inactive records remain available.</p>
        <div className="max-h-32 overflow-y-auto">{roster.map(row => <label className="block p-1" key={row.id}>
          <input type="checkbox" checked={records.includes(row.id)} onChange={e => toggle(setRecords,row.id,e.target.checked)} disabled={busy}/> {row.name} · {row.is_active?'Active':'Inactive'} · {row.id.slice(0,8)}
        </label>)}</div>
      </details>
      <label className="block"><input type="checkbox" checked={custom} disabled={busy} onChange={e=>{setCustom(e.target.checked);setConfirmed(false)}}/> Use a custom date range</label>
      {custom&&<div className="flex flex-wrap gap-2">
        <label>From <input className={control} type="date" value={start} disabled={busy} onChange={e=>{setStart(e.target.value);setConfirmed(false)}}/></label>
        <label>Through <input className={control} type="date" value={end} disabled={busy} onChange={e=>{setEnd(e.target.value);setConfirmed(false)}}/></label>
      </div>}
      <div aria-live="polite" className="rounded border p-2 text-sm">
        <p>{preview.appearances} log appearances · {preview.sales == null ? 'Membership sales unknown' : preview.sales + ' membership sales'}</p>
        {preview.aliases.map(a=><p key={a.original_name}>{a.original_name} · {a.first_date} through {a.last_date} · {a.memberships == null ? 'Sales unknown' : a.memberships + ' sales'}</p>)}
        {preview.aliases.length!==names.length&&<p>One or more selected names have no activity in this range.</p>}
      </div>
      <p className="text-sm">This updates historical report attribution and the roster statuses you selected. Review POS aliases separately. Employee IDs, original names, and Daily Logs are preserved.</p>
      <label className="block">Reason <input className={control} maxLength={1000} required value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> I verified that all selected records belong to the retained employee.</label>
      <div className="flex flex-wrap gap-2"><button className={control} disabled={!canSave || busy}>Confirm consolidation</button>
        <button type="button" className={control} disabled={busy} onClick={onClose}>Cancel</button></div>
    </form>
  </Dialog>
}

export function EmployeeConsolidationHistory({ locationId, onReversed }) {
  const [runs,setRuns]=useState(null),[selected,setSelected]=useState(null)
  const [error,setError]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false)
  async function load(){
    try {setRuns(await employeeConsolidation(supabase,locationId,'list'))}
    catch(error){setError(error.message)}
  }
  async function reverse(event){
    event.preventDefault()
    if(busy)return
    setBusy(true);setError('')
    try {
      await employeeConsolidation(supabase,locationId,'reverse',{id:selected.id,reason})
      setSelected(null);setReason('');await load();onReversed()
    } catch(error){setError(error.message)}
    finally{setBusy(false)}
  }
  return <details className="rounded border p-3" onToggle={e=>{if(e.currentTarget.open)load()}}>
    <summary className="cursor-pointer font-semibold">Consolidation history</summary>
    {error&&!selected&&<p role="alert">{error}</p>}
    {runs?.length===0&&<p>No consolidations recorded for this location.</p>}
    <ul className="space-y-2">{runs?.map(run=><li key={run.id} className="border-t py-2 text-sm">
      <p>{run.created_at} · Actor {run.actor} · Retained {run.retained_id}</p>
      <p>{run.selected_aliases.map(row=>row.name).join(', ')}{run.roster_before.length>0&&' · Roster: '+run.roster_before.map(row=>row.name).join(', ')}</p>
      <p>{run.reason}</p>
      {run.reversed_at?<p>Reversed {run.reversed_at} by {run.reversed_by} · {run.reversal_reason}</p>:
        <button type="button" className={control} onClick={()=>{setError('');setSelected(run)}}>Reverse consolidation</button>}
    </li>)}</ul>
    {selected&&<Dialog title="Reverse this consolidation?" onClose={()=>setSelected(null)} busy={busy}>
      <form className="mt-3 space-y-3" onSubmit={reverse}>
        <p>Restore the previous roster statuses and revoke mappings created by this action. Later changes can block reversal.</p>
        {error&&<p role="alert">{error}</p>}
        <label>Reversal reason <input className={control} required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></label>
        <button className={control} disabled={busy||!reason.trim()}>Confirm reversal</button>
        <button className={control} type="button" disabled={busy} onClick={()=>{setSelected(null);setReason('')}}>Cancel</button>
      </form>
    </Dialog>}
  </details>
}
