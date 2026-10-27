// Local-only synthetic development fixture. Never bundled by app/index.html.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { supabase } from '../../src/lib/supabase.js'
import { AuthProvider } from '../../src/contexts/AuthContext.jsx'
import DailyLogTable from '../../src/components/DailyLogTable.jsx'
import { loadDailyLogEmployees, dailyLogPersistence } from '../../src/utils/dailyLogEmployees.js'
const A='16000000-0000-4000-8000-000000000001',B='16000000-0000-4000-8000-000000000002',date='2025-01-15'
const identity=await supabase.auth.getUser(),user=identity.data.user
if(location.hostname!=='127.0.0.1'||supabase.supabaseUrl!=='https://bmfvcnsuduttebxbjvwx.supabase.co'||!['pr16-admin@example.test','pr16-gm@example.test'].includes(user?.email))throw Error('Approved local dev session required')
const {data:profile,error}=await supabase.from('user_profiles').select('*').eq('id',user.id).single()
if(error||!profile.is_active||profile.deleted_at||profile.role!==(user.email==='pr16-admin@example.test'?'admin':'store'))throw Error('Approved active role required')
const created={employees:[],logs:[]},checks=[]
let tag='PR40 '+profile.role+' '+Date.now()
let selectedEmployee,legacy,locationId=A
function record(name,pass){checks.push({name,pass});if(!pass)throw Error(name)}
async function prepare(){
 const r=await supabase.from('daily_logs').select('id').eq('location_id',A).eq('log_date',date)
 if(r.error||r.data.length)throw Error('Synthetic test date is not empty; stop and clean only previous owned fixtures.')
 for(const [name,is_active] of [[tag+' Active',true],[tag+' Inactive',false]]){
  const e=await supabase.from('employees').insert({location_id:A,name,is_active}).select('*').single();if(e.error)throw e.error
  created.employees.push(e.data);if(is_active)selectedEmployee=e.data
 }
 const log=await supabase.from('daily_logs').insert({location_id:A,log_date:date,time_slot:'08:00:00',split_index:0,employee_name:tag+' Historical nickname',total_washes:10,basic:1,memberships_sold:1,opportunities:10}).select('*').single();if(log.error)throw log.error
 legacy=log.data;created.logs.push(legacy)
 record('real Auth and isolated fixtures',true)
}
async function resume(){
 const r=await supabase.from('employees').select('*').eq('location_id',A).like('name','PR40 '+profile.role+' % Active')
 if(r.error||r.data.length!==1)throw Error('Exactly one owned synthetic active fixture required')
 selectedEmployee=r.data[0];tag=selectedEmployee.name.slice(0,-7)
 const logs=await supabase.from('daily_logs').select('*').eq('location_id',A).eq('log_date',date).like('employee_name',tag+'%')
 if(logs.error)throw logs.error
 legacy=logs.data.find(r=>r.time_slot==='08:00:00');if(!legacy)throw Error('Owned historical fixture required')
 created.logs.push(...logs.data);created.employees.push(selectedEmployee)
}
async function apiChecks(){
 const options=await loadDailyLogEmployees(supabase,A)
 record('active location-specific roster through Auth',options.some(e=>e.id===selectedEmployee.id)&&options.every(e=>e.location_id===A&&e.is_active))
 const track=(_key,row)=>{if(row&&!created.logs.some(r=>r.id===row.id))created.logs.push(row)}
 const make=(client=supabase,site=A)=>dailyLogPersistence(client,site,date,track)
 const base={location_id:A,log_date:date,time_slot:'10:00:00',split_index:1,total_washes:20,basic:2,memberships_sold:2,opportunities:20}
 const stage=(w,p,name=null)=>w.stage({...p,employee_name:name},p)
 const read=async(p=base)=>{const r=await supabase.from('daily_logs').select('*').eq('location_id',p.location_id).eq('log_date',date).eq('time_slot',p.time_slot).eq('split_index',p.split_index).maybeSingle();if(r.error)throw r.error;return r.data}
 const w=make();stage(w,base);await w.flush();const blank=await read()
 record('new blank numeric checkpoint saved through PostgREST',blank.employee_name===null)
 stage(w,base,selectedEmployee.name);await w.flush();record('roster selection saved', (await read()).employee_name===selectedEmployee.name)
 stage(w,base,'');await w.flush();record('Undo restores original NULL after numeric save',(await read()).employee_name===null)
 w.stage(base,null);await w.flush();record('checkpoint deletion completes',(await read())===null)
 stage(w,base,'');await w.flush();const restored=await read()
 record('Undo restores complete deleted checkpoint',JSON.stringify(restored)===JSON.stringify(blank))
 w.stage(base,null);await w.flush()
 let started,release;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r)
 const held={from(table){const q=supabase.from(table),insert=q.insert.bind(q);q.insert=(body)=>{const request=insert(body),single=request.maybeSingle.bind(request);request.maybeSingle=async()=>{const result=await single();started();await gate;return result};return request};return q}}
 const pending=make(held),split={...base,split_index:2};stage(pending,split,selectedEmployee.name);const saving=pending.flush();await began;pending.stage(split,null);release();await saving
 record('Undo pending split reconciles committed INSERT without orphan',(await read(split))===null)
 const historical=make();historical.load([legacy]);const historicalPayload={...base,time_slot:legacy.time_slot,split_index:0,total_washes:12,basic:1,memberships_sold:1,opportunities:12}
 stage(historical,historicalPayload,legacy.employee_name);await historical.flush();record('backdated unrelated edit preserves nickname',(await read(historicalPayload)).employee_name===legacy.employee_name)
 const concurrent=await supabase.from('daily_logs').update({employee_name:tag+' Concurrent nickname'}).eq('id',legacy.id);if(concurrent.error)throw concurrent.error
 stage(historical,{...historicalPayload,total_washes:13,opportunities:13},legacy.employee_name);await historical.flush();record('unrelated edit preserves concurrent name',(await read(historicalPayload)).employee_name===tag+' Concurrent nickname')
 const stale=make();stale.load([legacy]);stage(stale,historicalPayload,selectedEmployee.name);let conflict=false;try{await stale.flush()}catch{conflict=true}record('explicit stale name change reports conflict',conflict)
 const deactivate=await supabase.from('employees').update({is_active:false}).eq('id',selectedEmployee.id);if(deactivate.error)throw deactivate.error
 const inactive=make();stage(inactive,{...base,time_slot:'11:00:00'},selectedEmployee.name);let denied=false;try{await inactive.flush()}catch{denied=true}record('deactivated roster selection rejected',denied)
 const activate=await supabase.from('employees').update({is_active:true}).eq('id',selectedEmployee.id);if(activate.error)throw activate.error
 const other=await loadDailyLogEmployees(supabase,B);record('other location excludes A roster',other.every(e=>e.location_id===B&&!options.some(a=>a.id===e.id)))
 const second=make(supabase,B);stage(second,{...base,location_id:B,time_slot:'12:00:00'});let allowed=true;try{await second.flush()}catch{allowed=false}
 record(profile.role==='admin'?'Admin authorized other-location write':'Store cross-location write denied by RLS',allowed===(profile.role==='admin'))
}
function Fixture(){
 const [ready,setReady]=useState(false),[output,setOutput]=useState(''),[revision,setRevision]=useState(0),[dark,setDark]=useState(false)
 const run=async(action)=>{try{await action();setOutput(JSON.stringify({checks,created},null,2))}catch(e){setOutput(JSON.stringify({checks,created,error:e.message},null,2))}}
 return <AuthProvider><main className="min-h-screen bg-white dark:bg-tm-dark-bg text-gray-800 dark:text-tm-dark-text p-4"><h1>PR40 synthetic development validation — {profile.role}</h1>
 <p>Project: tm-ops-dev · {date} · Fictional PR16 A · real signed-in Auth/PostgREST</p>
 <button disabled={ready} onClick={()=>run(async()=>{await prepare();setReady(true)})}>Prepare isolated records</button>{' '}
 <button disabled={ready} onClick={()=>run(async()=>{await resume();setReady(true)})}>Resume owned fixtures</button>{' '}
 <button disabled={!ready} onClick={()=>run(async()=>{await apiChecks();setRevision(r=>r+1)})}>Run API regression checks</button>{' '}
 <button onClick={()=>{document.documentElement.classList.toggle('dark');setDark(!dark)}}>{dark?'Light mode':'Dark mode'}</button>{' '}
 <button onClick={()=>setRevision(r=>r+1)}>Reload Daily Log</button>
 <p role="status">{checks.length} checks completed. {checks.some(c=>!c.pass)?'FAILED':''}</p><details><summary>Test details</summary><pre className="text-xs whitespace-pre-wrap">{output}</pre></details>
 {ready&&<DailyLogTable key={revision} locationId={locationId} locationName="Fictional PR16 A" selectedDate={date} canEdit opportunitiesFormula="simple" profile={profile}/>}
 </main></AuthProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
