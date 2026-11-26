import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { membershipRpc } from '../utils/posMembership'

const field='rounded border p-2 dark:border-tm-dark-border dark:bg-tm-dark-card'
export default function PosEmployeeAliases({locationId,isAdmin,employees}){
 const [open,setOpen]=useState(false),[aliases,setAliases]=useState([]),[kind,setKind]=useState('username')
 const [employee,setEmployee]=useState(''),[identifier,setIdentifier]=useState(''),[legalName,setLegal]=useState('')
 const [starts,setStarts]=useState(''),[ends,setEnds]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('')
 const [closing,setClosing]=useState(null),[busy,setBusy]=useState(false)
 const call=(action,payload={})=>membershipRpc(supabase,'aliases',{p_location:locationId,p_action:action,p_payload:payload})
 useEffect(()=>{if(!open)return;let active=true;call('read').then(rows=>{if(active)setAliases(rows)})
  .catch(error=>{if(active)setError(error.message)});return()=>{active=false}},[open,locationId])
 async function save(e){
  e.preventDefault();setError('');setBusy(true)
  try{
   await call(closing?'close':'add',closing?{id:closing.id,ends,reason}:{employee,kind,identifier,legalName,starts,ends:ends||null,reason})
   setAliases(await call('read'));setIdentifier('');setLegal('');setReason('');setEnds('');setClosing(null)
  }catch(error){setError(error.message)}finally{setBusy(false)}
 }
 return <details onToggle={e=>setOpen(e.currentTarget.open)} className="rounded border p-3 space-y-3 dark:border-tm-dark-border">
  <summary className="cursor-pointer font-semibold">POS employee identities</summary>
  <p className="text-sm">Use effective dates for location assignments. Existing credited sales retain their original attribution.</p>
  {error&&<p role="alert">{error}</p>}
  <ul className="space-y-2">{aliases.map(a=><li key={a.id}>
   {employees.find(e=>e.id===a.employee_id)?.name??'Former roster employee'} · {a.kind==='adp'?'ADP mapping':a.identifier} · {a.starts} to {a.ends??'open'}
   {!a.ends&&<button type="button" className={field} onClick={()=>{setClosing(a);setEnds('')}}>End mapping</button>}
  </li>)}</ul>
  <form className="grid gap-2 sm:grid-cols-2" onSubmit={save}>
   {!closing&&<>
    <label>Employee <select className={field} value={employee} onChange={e=>setEmployee(e.target.value)} required><option value="">Select employee</option>
     {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    {isAdmin&&<label>Identity type <select className={field} value={kind} onChange={e=>setKind(e.target.value)}><option value="username">Micrologic username</option><option value="adp">DRB ADP identifier</option></select></label>}
    <label>{kind==='adp'?'Verified ADP identifier':'POS username'} <input className={field} value={identifier} onChange={e=>setIdentifier(e.target.value)} required/></label>
    {kind==='adp'&&<label>Verified Legal Name <input className={field} value={legalName} onChange={e=>setLegal(e.target.value)} required/></label>}
    <label>Effective from <input type="date" className={field} value={starts} onChange={e=>setStarts(e.target.value)} required/></label>
   </>}
   <label>Effective through <input type="date" className={field} value={ends} onChange={e=>setEnds(e.target.value)} required={!!closing}/></label>
   <label>Reason <input className={field} value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500}/></label>
   <button type="submit" className={field} disabled={busy}>{closing?'Confirm mapping end':'Save verified mapping'}</button>
   {closing&&<button type="button" className={field} onClick={()=>setClosing(null)}>Cancel</button>}
  </form>
 </details>
}
