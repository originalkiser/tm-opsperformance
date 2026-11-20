import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fetchEmployeeLogs } from '../utils/employeePerformance.js'
import { readMappings } from '../utils/historicalEmployeeMappings.js'
import { readLocationEmployees } from '../utils/employeeIdentity.js'
import { drbDate, parseDrbReconciliationFile, reconciliationComparison, employeeReconciliation, saleActivities, saleDecisions, saleBucket, shortenedIdentifier, reconciliationError } from '../utils/drbReconciliation.js'

const input = 'rounded border border-gray-300 bg-white p-2 text-sm dark:bg-tm-dark-surface dark:border-tm-dark-border dark:text-tm-dark-text'
const button = 'rounded bg-tm-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-tm-teal dark:text-tm-navy'
const today = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
async function rpc(action, payload = {}) {
  const { data, error } = await supabase.rpc('drb_reconciliation', { action, payload })
  // Do not echo database detail/payloads that might contain customer information.
  if (error) throw new Error(reconciliationError(error))
  return data
}
function Comparison({ rows, employee = false, sites }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold py-2">{employee ? 'Employee comparison' : 'Location comparison'}</caption>
    <thead><tr>{['Location', ...(employee ? ['Employee'] : []), 'Manager-reported sales', 'Gross Membership Sales', 'Verified Commission-Eligible Sales', 'Excluded Sales', 'Unresolved Sales', 'Unresolved Employee Attribution'].map(h => <th className="p-2 border-b" key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.key || r.locationId}><td className="p-2 border-b">{sites.find(s => s.id === r.locationId)?.name || r.name}</td>{employee && <td className="p-2 border-b">{r.name}{!r.employeeId && <span className="block text-xs">No approved UUID link to POS</span>}</td>}{['reported','gross','eligible','excluded','unresolved','unresolvedAttribution'].map(k => <td key={k} className="p-2 border-b tabular-nums">{r[k] ?? '—'}</td>)}</tr>)}</tbody>
  </table></div>
}
function ReviewSale({ sale, busy, onReview, onMatches }) {
  const [decision, setDecision] = useState(sale.decision), [activity, setActivity] = useState(sale.activity), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(sale.identity_confirmed)
  return <form onSubmit={e => { e.preventDefault();onReview({ id:sale.id,revision:sale.revision,decision,activity,identity_confirmed:confirmed,reason }) }} className="space-y-3 p-3">
    <p>{sale.log_date} · {sale.item} · {sale.employee_name || 'Awaiting employee match'} · {saleBucket(sale)}</p>
    <p role="status">{sale.identifier_classification} · employee key {sale.employee_key || 'unresolved'} · {sale.review_complete ? 'Weekly review completion verified' : 'Pending Sara’s weekly review completion'}</p>
    <div className="overflow-x-auto"><table className="text-sm"><thead><tr>{['Source','Employee identifier','Customer','Customer phone','Source commission','Source annotation'].map(s=><th className="p-2 text-left" key={s}>{s}</th>)}</tr></thead><tbody>{sale.observations.map(o=><tr key={o.id}><td className="p-2">{o.kind}</td><td className="p-2">{o.employee_identifier || 'Missing'}{shortenedIdentifier(o.employee_identifier) && <span className="block">Sara-excluded commission</span>}</td><td className="p-2">{o.customer_name}</td><td className="p-2">{o.customer_phone}</td><td className="p-2">{o.commission}</td><td className="p-2 whitespace-pre-wrap">{o.source_note}</td></tr>)}</tbody></table></div>
    <button className={button} type="button" disabled={busy} onClick={()=>onMatches(sale.id)}>Review possible repeat customers</button>
    <p className="text-xs">Name or phone matches are review leads. They never automatically exclude a sale. Enter the exclusion reason explicitly; a shortened identifier does not identify the reason.</p>
    <div className="flex flex-wrap gap-3">
      <label>Activity <select aria-label="Activity" className={input} value={activity} onChange={e=>setActivity(e.target.value)}>{saleActivities.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Decision <select aria-label="Decision" className={input} value={decision} onChange={e=>setDecision(e.target.value)}>{saleDecisions.map(s=><option key={s} disabled={s==='eligible' && (!sale.review_complete || sale.identifier_classification!=='retained' || !sale.employee_id)}>{s}</option>)}</select></label>
    </div>
    <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> I verified this transaction's identity and source evidence.</label>
    <label className="block">Review reason (required)<textarea className={`${input} block w-full`} maxLength={1000} required value={reason} onChange={e=>setReason(e.target.value)} /></label>
    <p className="text-xs">Previous reason: {sale.reason || 'Not reviewed'}</p>
    <button disabled={busy} className={button}>Save review</button>
  </form>
}
export default function SalesReconciliation() {
  const { profile, managerPreview } = useAuth()
  const [access, setAccess] = useState('loading'), [range, setRange] = useState({start:today(),end:today()}), [loadedRange,setLoadedRange]=useState(null)
  const [file,setFile]=useState(null),[preview,setPreview]=useState(null)
  const [state,setState]=useState(null),[sites,setSites]=useState([]),[employees,setEmployees]=useState([]),[logs,setLogs]=useState([]),[aliases,setAliases]=useState([])
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[matches,setMatches]=useState(null),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(30)
  const [map,setMap]=useState({location_id:'',identifier:'',adp_badge:'',adp_reference:'',employee_id:'',reason:''})
  const epoch = useRef(0)
  useEffect(()=>{ let active=true;setState(null);setPreview(null);setAccess('loading');epoch.current++
    if(profile?.role!=='admin'||managerPreview){setAccess('denied');return}
    rpc('status').then(()=>{if(active)setAccess('allowed')}).catch(()=>{if(active)setAccess('denied')})
    return()=>{active=false;epoch.current++}
  },[profile?.id,profile?.role,managerPreview])
  async function load() {
    const version=epoch.current
    const start=drbDate(range.start),end=drbDate(range.end)
    const data=await rpc('read',{start,end})
    const locationResult=await supabase.from('locations').select('id,name,site_code,opportunities_formula').order('id')
    if(locationResult.error || !locationResult.data)throw new Error('Locations could not be loaded.')
    const locations=locationResult.data
    const [roster,daily,mappings]=await Promise.all([
      Promise.all(locations.map(l=>readLocationEmployees(supabase,l.id))),fetchEmployeeLogs(supabase,locations.map(l=>l.id),{start,end}),readMappings(supabase,locations.map(l=>l.id),true)
    ])
    // Access must still be current before retaining customer information.
    await rpc('status')
    if(version!==epoch.current)return
    setSites(locations);setEmployees(roster.flat());setLogs(daily);setAliases(mappings);setState(data);setLoadedRange({start,end});setLimit(30);setMatches(null)
  }
  async function run(task) {
    if(busy)return
    const version=epoch.current;setBusy(true);setMessage('')
    try{await task()}catch(error){if(version===epoch.current){setMessage(error.message);setState(null);setMatches(null)}}finally{if(version===epoch.current)setBusy(false)}
  }
  async function write(action,payload){await rpc(action,payload);await load();setMessage('Saved. Leaderboard and Daily Logs are unchanged.')}
  let siteRows=[],employeeRows=[],calculationError=''
  if(state && loadedRange)try{siteRows=reconciliationComparison(state.sales,logs,sites,loadedRange,aliases);employeeRows=employeeReconciliation(state.sales,logs,sites,loadedRange,aliases)}catch{calculationError='Comparison unavailable: historical mappings or Daily Log attribution could not be verified.'}
  const filtered=state?.sales.filter(s=>filter==='all'||saleBucket(s)===filter)||[]
  return <div className="min-h-screen bg-tm-cream text-tm-navy dark:bg-tm-dark-bg dark:text-tm-dark-text"><NavBar/><main className="mx-auto max-w-7xl p-4 space-y-5">
    <Link to="/reports" className="underline">Reports</Link><h1 className="text-2xl font-bold">DRB Sales Reconciliation</h1>
    {access==='loading'?<p role="status">Checking reviewer access…</p>:access!=='allowed'?<p role="alert">This report requires separately authorized sales reviewer access.</p>:<fieldset disabled={busy} className="space-y-5 min-w-0">
      <p>Compare manager entries with imported membership transactions and reviewed commission evidence. Imported sales do not affect rankings.</p>
      <div className="flex flex-wrap items-end gap-3"><label>Start <input aria-label="Start" type="date" className={input} value={range.start} onChange={e=>{setRange(r=>({...r,start:e.target.value}));setPreview(null);setState(null);setMatches(null)}}/></label><label>End <input aria-label="End" type="date" className={input} value={range.end} onChange={e=>{setRange(r=>({...r,end:e.target.value}));setPreview(null);setState(null);setMatches(null)}}/></label><button disabled={busy} className={button} onClick={()=>run(load)}>Load comparison</button></div>
      <section className="rounded border p-4 space-y-3 dark:border-tm-dark-border"><h2 className="font-bold">Import DRB transactions</h2>
        <p className="text-sm">Choose the export's exact coverage above. Use Wash Commissions transactions with Site and Sale ID. General Sales summaries and census files cannot create verified sales.</p>
        <p>Source: single weekly DRB commission export. Preserve Alternate Phone exactly; classify before matching its last four digits.</p>
        <input aria-label="DRB export" type="file" accept=".xlsx" disabled={busy} className="block" onChange={e=>{setFile(e.target.files[0]);setPreview(null)}}/>
        <button disabled={busy||!file} className={button} onClick={()=>run(async()=>{await rpc('status');setPreview(await parseDrbReconciliationFile(file,'weekly',range.start,range.end))})}>Validate and preview</button>
        {preview&&<div className="space-y-2"><p>{preview.rows.length} transactions · {new Set(preview.rows.map(r=>r.site_code)).size} locations · {preview.kind} · {preview.start_date} through {preview.end_date}</p><p className="text-sm">Retained nine- and ten-digit IDs remain pending Sara’s review completion. Four-digit IDs are excluded; employee matching is separate. Repeat imports preserve observations without counting a sale twice.</p><button disabled={busy} className={button} onClick={()=>run(async()=>{const result=await rpc('import',preview);setPreview(null);await load();setMessage(result.repeat?'Already imported; no changes made.':'Import saved. Retained sales await review completion; employee attribution uses approved ADP badge matches.')})}>Save import</button></div>}
      </section>
      {message&&<p role="status">{message}</p>}{busy&&<p role="status">Working…</p>}
      {state&&<>
        <p className="text-sm">Gross counts each weekly export transaction before commission exclusions. Eligible, excluded and pending sales partition gross totals. Unresolved employee attribution is separate and can include excluded sales. Nine-digit retained IDs are not excluded. Totals reflect imported coverage, not certified completeness. Manager totals leave unnamed activity unattributed; a dash means no verified comparison.</p>
        {calculationError?<p role="alert">{calculationError}</p>:<><Comparison rows={siteRows} sites={sites}/><Comparison rows={employeeRows} employee sites={sites}/></>}
        <section className="border rounded p-4 space-y-3 dark:border-tm-dark-border"><h2 className="font-bold">Employee identifier approval</h2><p className="text-sm">Choose an existing roster UUID. Verify the last four digits against the authoritative ADP badge roster, including inactive and historical employees. Names never establish identity. A key must identify exactly one approved employee for the sale date; conflicting matches remain unresolved. Propose a mapping, then explicitly approve it.</p>
          <form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();run(()=>write('propose_mapping',{...map,identifier:map.adp_badge.slice(-4),start_date:range.start,end_date:range.end}))}}>
            <label>Location <select required aria-label="Mapping location" className={input} value={map.location_id} onChange={e=>setMap(m=>({...m,location_id:e.target.value,employee_id:''}))}><option value="">Choose location</option>{sites.map(s=><option value={s.id} key={s.id}>{s.site_code} {s.name}</option>)}</select></label>
            <label>ADP Badge Number (exact) <input required pattern="[0-9]{4,20}" className={input} value={map.adp_badge} onChange={e=>setMap(m=>({...m,adp_badge:e.target.value}))}/></label>
            <label>ADP roster evidence/reference <input required maxLength={500} className={input} value={map.adp_reference} onChange={e=>setMap(m=>({...m,adp_reference:e.target.value}))}/></label>
            <label>Roster employee <select required aria-label="Roster employee" className={input} value={map.employee_id} onChange={e=>setMap(m=>({...m,employee_id:e.target.value}))}><option value="">Choose employee</option>{employees.filter(e=>e.location_id===map.location_id).map(e=><option value={e.id} key={e.id}>{e.name} · {e.id}{e.is_active===false?' · inactive':''}</option>)}</select></label>
            <label>Verification reason <input required maxLength={1000} className={input} value={map.reason} onChange={e=>setMap(m=>({...m,reason:e.target.value}))}/></label><button className={button} disabled={busy}>Propose for selected dates</button>
          </form>
          {state.mappings.map(m=><MappingReview key={`${m.id}:${m.revision}`} mapping={m} employee={employees.find(e=>e.id===m.employee_id)} busy={busy} onSave={p=>run(()=>write('decide_mapping',p))}/>)}
        </section>
        <section className="space-y-2"><h2 className="font-bold">Transaction review</h2><label>Show <select className={input} value={filter} onChange={e=>{setFilter(e.target.value);setLimit(30)}}>{['all','unresolved','eligible','excluded'].map(s=><option key={s}>{s}</option>)}</select></label>
          {filtered.slice(0,limit).map(s=><details className="border rounded dark:border-tm-dark-border" key={`${s.id}:${s.revision}`}><summary className="cursor-pointer p-3">{sites.find(l=>l.id===s.location_id)?.site_code} · {s.log_date} · Sale {s.sale_id} · {saleBucket(s)} · {s.employee_name || 'Employee unresolved'}</summary><ReviewSale sale={s} busy={busy} onReview={p=>run(()=>write('review_sale',p))} onMatches={id=>run(async()=>setMatches(await rpc('customer_matches',{id})))}/></details>)}
          {filtered.length>limit&&<button className={button} onClick={()=>setLimit(n=>n+30)}>Show 30 more ({filtered.length-limit} remaining)</button>}
        </section>
        {matches&&<section aria-label="Possible repeat customers" className="border rounded p-4"><h2 className="font-bold">Possible repeat customers</h2><p>These matches require review and do not decide eligibility.</p>{!matches.matches.length&&<p>No matches in imported history. This does not prove the customer has no prior membership.</p>}{matches.matches.map(s=><p key={s.id}>{s.log_date} · Sale {s.sale_id} · {s.phone_match?'Phone match':''} {s.name_match?'Name match':''} · {s.activity} · {s.decision}</p>)}{matches.truncated&&<p>More than 100 matches. Narrow the review using the original reports.</p>}</section>}
        <details><summary>Verification audit (latest 100 events)</summary>{state.audit.map(a=><details className="p-2 border-b" key={a.id}><summary>{a.happened_at} · {a.action} · record {a.subject_id} · reviewer {a.actor}</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({previous:a.previous,next:a.next},null,2)}</pre></details>)}</details>
      </>}
    </fieldset>}
  </main></div>
}
function MappingReview({mapping:m,employee,busy,onSave}) {
  const [reason,setReason]=useState('')
  return <form className="flex flex-wrap items-center gap-2 border-t py-2" onSubmit={e=>e.preventDefault()}><span>{m.identifier} (ADP badge {m.adp_badge}; {m.adp_reference}) → {employee?.name || m.employee_id} · {m.start_date}–{m.end_date} · {m.status}</span><input aria-label={`Mapping ${m.id} decision reason`} className={input} maxLength={1000} placeholder="Decision reason" value={reason} onChange={e=>setReason(e.target.value)}/>{['approved','rejected'].filter(s=>s!==m.status).map(status=><button className={button} type="button" key={status} disabled={busy||!reason.trim()} onClick={()=>onSave({id:m.id,revision:m.revision,status,reason})}>{status==='approved'?'Approve':'Reject'}</button>)}</form>
}
