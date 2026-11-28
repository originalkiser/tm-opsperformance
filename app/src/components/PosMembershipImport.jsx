import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toDateStr } from '../utils/budgetMath'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { membershipEventKey, membershipRpc, membershipTotals, parseMembershipFile } from '../utils/posMembership'
import { readStoredPos } from '../utils/posImportStorage'

const control='rounded border px-3 py-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-card'
const activityLabels={new:'Verified new',regular:'Regular / DRB reactivations',grace:'Grace reactivations',cancel:'Cancellations',decline:'Declines',unresolved:'Unresolved qualification',candidates:'Employee candidates',kiosk:'Kiosk signups',blank:'Blank Greeter signups'}
const today=()=>toDateStr(new Date())
const unresolvedAttribution = new Set(['unmatched', 'ambiguous', 'name-conflict'])

function UnresolvedMappings({ rows, locations }) {
 return <ul className="space-y-1 text-sm">{rows.length?rows.map(r=>{
  const site=locations.find(l=>l.site_code?.split('-')[0]===r.site_code?.split('-')[0])
  return <li key={JSON.stringify([r.system,r.site_code,r.business_date,r.ticket,r.greeter])}>
   {r.site_code} · {r.business_date} · {r.greeter??r.system}
   {r.ticket ? ` · ticket ${r.ticket}` : ` · ${r.quantity} eligible signups`} · {r.attribution}
   {site&&<Link className="ml-2 underline" to={'/employees?site='+encodeURIComponent(site.id)}>Open roster</Link>}
  </li>
 }):<li>No unresolved mappings.</li>}</ul>
}

export default function PosMembershipImport(){
 const {locations}=useAuth()
 const [file,setFile]=useState(null),[start,setStart]=useState(today),[end,setEnd]=useState(today)
 const [preview,setPreview]=useState(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [external,setExternal]=useState(false)
 const [busy,setBusy]=useState(false),[queue,setQueue]=useState(null)
 async function run(task){
  setBusy(true);setError('');setNotice('')
  try{await task()}catch(error){setError(error.message)}finally{setBusy(false)}
 }
 const call=(action,payload={})=>membershipRpc(supabase,'import',{p_action:action,p_payload:payload})
 async function read(){
  setPreview(null)
  const parsed=await parseMembershipFile(file,start,end)
  if(parsed.commissions){
    const request={...parsed.commissions,sha:parsed.sha,start:parsed.start,end:parsed.end}
    const review=await membershipRpc(supabase,'commissions',{p_action:'preview',p_payload:request})
    setPreview({parsed,commissionRequest:request,commissionReview:review})
    return
  }
  if(parsed.comparison){setPreview({parsed});return}
  const {outside:_,overlaps:__,...source}=parsed
  const request={...source,externallyValidated:parsed.system==='DRB'&&external}
  const [review,gsr]=await Promise.all([call('preview',request),readStoredPos(supabase,start,end)])
  setPreview({parsed,request,review,gsr})
 }
 async function save(){
  const revisions=new Map(preview.review.rows.map(r=>[membershipEventKey(preview.request.system,r),r.expectedRevision]))
  const events=preview.request.events.map(r=>({...r,expectedRevision:revisions.get(membershipEventKey(preview.request.system,r))}))
  const snapshots=preview.request.snapshots.map((row,i)=>({...row,expectedBatch:preview.review.snapshots[i].expectedBatch}))
  const outcome=await call('commit',{...preview.request,events,snapshots,reason})
  setNotice(outcome.repeat?'Workbook already imported.':'Reviewed membership observations saved.')
  setPreview(null);setReason('')
 }
 async function saveCommissions(){
  const result=await membershipRpc(supabase,'commissions',{p_action:'commit',p_payload:{...preview.commissionRequest,expectedReport:preview.commissionReview.replaces}})
  setNotice(result.repeat?'Commission report already imported.':'Verified commission report scope saved.')
  setPreview(null)
 }
 const {parsed,review,gsr,commissionReview}=preview??{}
 const needsReason=review?.rows.some(r=>['correction','attribution'].includes(r.action))||review?.snapshots.some(r=>r.correction)
 const scopeSites = parsed?.commissions ? [parsed.commissions.site] :
  [...new Set([...(parsed?.events??[]),...(parsed?.snapshots??[])].map(row=>row.site))].sort()
 const previewQueue = review ? review.rows.filter(row=>unresolvedAttribution.has(row.attribution)).map(row=>({
  system:parsed.system,site_code:row.site,business_date:row.date,ticket:row.ticket,attribution:row.attribution,
 })) : commissionReview?.users.filter(user=>user.eligible>user.credited).map(user=>({
  system:parsed.system,site_code:parsed.commissions.site,business_date:`${parsed.start} through ${parsed.end}`,
  greeter:user.username,quantity:user.eligible-user.credited,attribution:'Identity unresolved for this period',
 }))
 const impact=new Map()
 if(gsr){
  for(const row of parsed.events){
   const key=row.site+'/'+row.date, x=impact.get(key)??{site:row.site,date:row.date,observed:0}
   if(row.activity==='new')x.observed++
   impact.set(key,x)
  }
  for(const row of gsr.filter(r=>r.system===parsed.system)){
   const site=locations.find(l=>l.id===row.location_id)?.site_code.split('-')[0]
   if(!site)continue
   const key=site+'/'+row.business_date,x=impact.get(key)??{site,date:row.business_date,observed:0}
   x.gsr=row.document.metrics.memberships
   impact.set(key,x)
  }
 }
 return <section className="rounded border p-4 space-y-4 dark:border-tm-dark-border">
  <h2 className="font-bold">Membership activity import</h2>
  <p className="text-sm">Use DRB validated transactions, Micrologic Unlimited Detailed Report for membership activity, or a single-site Micrologic Sales Commissions Summary w. Details for employee sales and P-Mix.</p>
  <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();run(read)}}>
   <label>Business date from <input className={control} type="date" disabled={busy} value={start} required onChange={e=>{setStart(e.target.value);setPreview(null)}}/></label>
   <label>Through <input className={control} type="date" disabled={busy} value={end} required onChange={e=>{setEnd(e.target.value);setPreview(null)}}/></label>
   <label>Membership workbook <input className={control} type="file" disabled={busy} accept=".xlsx" required onChange={e=>{setFile(e.target.files[0]);setPreview(null)}}/></label>
   <label className="text-sm"><input type="checkbox" disabled={busy} checked={external} onChange={e=>{setExternal(e.target.checked);setPreview(null)}} /> DRB file was externally validated</label>
   <button className={control} disabled={busy||!file}>Preview membership workbook</button>
  </form>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {parsed?.comparison&&<div className="space-y-1" role="status">
   <p><strong>Comparison only</strong> · {parsed.comparison.quantity} reported units · source commission {parsed.comparison.commission==null?'Unavailable':(parsed.comparison.commission/100).toLocaleString('en-US',{style:'currency',currency:'USD'})}</p>
   <p>{parsed.comparison.reason} To import employee sales, export <strong>Summary w. Details</strong> for one supported location and select the dates printed on the report.</p>
  </div>}
  {commissionReview&&<>
   <p>Commission coverage · Site {parsed.commissions.site} · {parsed.start} through {parsed.end}. Quantities apply to the full period.</p>
   {parsed.commissions.activeOnly&&<p role="status">Source includes active POS users only.</p>}
   <p>Employee aliases must cover the entire period. Counts with an unknown tier can earn sales credit and are excluded from P-Mix. Unverified products or identities remain uncredited.</p>
   <div className="overflow-x-auto"><table className="w-full text-sm text-left">
    <thead><tr>{['Username','Reported signups','Eligible products','Credited','Unknown tier','Unresolved product','Excluded'].map(label=><th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
    <tbody>{commissionReview.users.map(user=><tr key={user.username} className="border-t">
     {[user.username,user.reported,user.eligible,user.credited,user.unknown_tier,user.unknown_product,user.excluded].map((value,i)=><td key={i} className="p-2">{value}</td>)}
    </tr>)}</tbody>
   </table></div>
   {commissionReview.replaces&&<p role="status">Saving replaces the previous report for this start date. Prior imports remain in history.</p>}
   {commissionReview.repeat ? <p>Commission report already imported.</p> :
    <button className={control} type="button" disabled={busy} onClick={()=>{if(window.confirm(commissionReview.replaces ? 'Replace the previous commission report with this reviewed scope?' : 'Save the reviewed commission report scope?'))run(saveCommissions)}}>Save reviewed commission report</button>}
  </>}
  {review&&<>
   <p className="break-all">{parsed.system} · SHA-256 {parsed.sha} · {parsed.outside} out-of-scope rows</p>
   {!!parsed.overlaps?.length&&<details><summary>{parsed.overlaps.length} repeated source rows counted once</summary>
    <ul>{parsed.overlaps.map((row,i)=><li key={i}>{row.site} · {row.date} · ticket {row.ticket} · {activityLabels[row.activity]}</li>)}</ul>
   </details>}
   <ul className="grid gap-1 sm:grid-cols-2">{Object.entries(membershipTotals(parsed.events,parsed.snapshots)).map(([k,v])=><li key={k}>
    {activityLabels[k]??'New membership tiers'} · {typeof v==='number'?v:Object.entries(v).map(([tier,n])=>tier+' '+n).join(', ')}
   </li>)}</ul>
   <p>{parsed.events.length} transaction records · {review.rows.filter(r=>r.attribution==='matched').length} employee-attributed · {review.rows.filter(r=>r.action==='duplicate').length} duplicates · {previewQueue.length} unresolved mappings</p>
   <details><summary>Location and business-date coverage against GSR</summary>
    <ul className="text-sm">{[...impact.values()].sort((a,b)=>a.site.localeCompare(b.site)||a.date.localeCompare(b.date)).map(r=><li key={r.site+r.date}>
      {r.site} · {r.date} · {r.observed} verified new / {r.gsr??'unavailable'} GSR
      {r.gsr!==r.observed&&' · Coverage difference'}
      {r.site==='1512'&&r.gsr>r.observed&&' · Check source coverage for promotional memberships'}
    </li>)}</ul>
   </details>
   <p className="text-sm">Cancellation and decline counts are stored as source snapshots. Overlapping snapshots are not additive.</p>
   {review.snapshots.some(r=>r.expectedBatch)&&<details><summary>Previously observed snapshot groups</summary>
    <ul className="text-sm">{review.snapshots.filter(r=>r.expectedBatch).map(r=><li key={JSON.stringify([r.site,r.date,r.activity,r.product])}>
      {r.site} · {r.date} · {activityLabels[r.activity]} · {r.product} · {r.previousQuantity} → {r.quantity}{r.correction?' · Correction':''}
    </li>)}</ul>
   </details>}
   {review.rows.some(r=>r.previousActivity && r.activity!==r.previousActivity)&&<details>
    <summary>Activity classification corrections</summary>
    <ul>{review.rows.filter(r=>r.previousActivity && r.activity!==r.previousActivity).map(r=><li key={membershipEventKey(parsed.system,r)}>
      {r.site} · {r.date} · ticket {r.ticket} · {activityLabels[r.previousActivity]} → {activityLabels[r.activity]}
    </li>)}</ul>
   </details>}
   <label>Correction reason <input className={control} value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
   <button type="button" className={control} disabled={busy||needsReason&&!reason.trim()||parsed.events.length+parsed.snapshots.length===0}
     onClick={()=>{if(window.confirm('Save the reviewed membership workbook and any requested corrections?'))run(save)}}>Save reviewed membership workbook</button>
  </>}
  {previewQueue&&<section aria-label="Unresolved mappings for this workbook" className="space-y-2">
   <h3 className="font-semibold">Unresolved mappings for this workbook</h3>
   <p className="text-sm">{parsed.system} · {scopeSites.length ? scopeSites.join(', ') : 'No locations in range'} · {parsed.start} through {parsed.end}</p>
   <UnresolvedMappings rows={previewQueue} locations={locations} />
  </section>}
  <details className="space-y-2">
   <summary className="cursor-pointer font-semibold">All unresolved employee mappings</summary>
   <p className="text-sm">Recent saved unresolved mappings across all POS systems, locations, and dates.</p>
   <button type="button" className={control} disabled={busy} onClick={()=>run(async()=>setQueue(await call('queue')))}>Load all unresolved mappings</button>
   {queue&&<UnresolvedMappings rows={queue} locations={locations} />}
  </details>
  {(previewQueue?.length>0||queue?.length>0)&&<p className="text-sm">Maintain verified aliases in Employees. Preview the original workbook again and enter a correction reason for newly resolved transaction attributions.</p>}
 </section>
}
