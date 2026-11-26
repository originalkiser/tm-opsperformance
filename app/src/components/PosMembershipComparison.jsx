import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { membershipCoverage, membershipRpc } from '../utils/posMembership'
import { mappingCovers, isApprovedMapping } from '../utils/employeeMappingAttribution'
import { buildEmployeePerformance } from '../utils/employeePerformance'

export function usePosMembershipReport(locations,start,end){
 const key=JSON.stringify([...new Set(locations.map(l=>l.id))].sort())
 const scope=key+'/'+start+'/'+end
 const [state,setState]=useState(null)
 useEffect(()=>{
  if(!start||!end||end<start||key==='[]')return
  let active=true
  membershipRpc(supabase,'report',{p_sites:JSON.parse(key),p_start:start,p_end:end}).then(result=>{
   if(active)setState({scope,result})
  }).catch(()=>{if(active)setState({scope,error:'Imported membership comparison is unavailable.'})})
  return()=>{active=false}
 },[key,start,end,scope])
 return state?.scope===scope?state:null
}
export default function PosMembershipComparison({data,locations,dateRange,mappings,dataComplete}){
 const [open,setOpen]=useState(false)
 const state=usePosMembershipReport(open?locations:[],dateRange.start,dateRange.end)
 let managerRows=[]
 const managerNames=new Map()
 if(dataComplete){
  const identified=data.map(row=>{
   const approved=mappings.filter(m=>isApprovedMapping(m)&&mappingCovers(m,row))
   const employee=approved.length===1&&!row.employee_id?approved[0].employee_id:row.employee_id
   if(employee&&row.employee_name)managerNames.set(employee,row.employee_id?row.employee_name:approved[0]?.employee_name??row.employee_name)
   return {...row,employee_name:employee||null}
  })
  managerRows=buildEmployeePerformance(identified,locations,dateRange).rows
 }
 const people=[...(state?.result?.people??[])]
 for(const row of managerRows){
  if(!people.some(person=>person.location_id===row.locationId&&person.employee_id===row.name)){
   people.push({location_id:row.locationId,employee_id:row.name,name:managerNames.get(row.name)??'Employee',
     credited:null,tiered:0,unknown:0,premium:0})
  }
 }
 return <details className="rounded border p-3 my-3 dark:border-tm-dark-border" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary className="cursor-pointer font-semibold">POS membership comparison</summary>
  <p className="text-sm my-2">Verified employee credit counts attributed new memberships. Manager comparisons require a verified employee identity. Employee conversion requires employee-level opportunities.</p>
  {open&&!state&&<p role="status">Loading POS membership comparison…</p>}
  {state?.error&&<p role="status">{state.error}</p>}
  {state?.result&&<div className="overflow-x-auto">
   <table className="w-full text-left text-sm"><thead><tr>{['Employee','Site','Manager new sales','POS-attributed new sales','Difference','Verified employee P-Mix','Coverage and attribution'].map(x=><th scope="col" className="p-2 border-b" key={x}>{x}</th>)}</tr></thead>
   <tbody>{people.map(person=>{
    const manager=managerRows.find(r=>r.locationId===person.location_id&&r.name===person.employee_id)?.ms
    const source=membershipCoverage(state.result.coverage.filter(d=>d.loc===person.location_id))
    const credited=person.credited??(source.provisional?null:0)
    return <tr key={person.location_id+person.employee_id} className="border-b">
     <th scope="row" className="p-2">{person.name}</th><td className="p-2">{locations.find(l=>l.id===person.location_id)?.name}</td>
     <td className="p-2">{manager??'Unavailable'}</td><td className="p-2">{credited??'Unavailable'}</td>
     <td className="p-2">{manager==null||credited==null?'Unavailable':credited-manager}</td>
     <td className="p-2">{person.tiered>0?(person.premium/person.tiered*100).toFixed(1)+'%':'Unavailable'}{person.unknown>0&&' · Incomplete tiers ('+person.unknown+' unknown)'}</td>
     <td className="p-2">{source.verified}/{source.expected} GSR-matched days · {source.unresolved} unresolved · {source.provisional?'Provisional':'Covered'}</td>
    </tr>
   })}</tbody></table>
   {!people.length&&<p>No verified, attributed POS new sales in this selection.</p>}
  </div>}
 </details>
}
