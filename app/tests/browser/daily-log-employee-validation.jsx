// Local-only synthetic development fixture. Never bundled by app/index.html.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { supabase } from '../../src/lib/supabase.js'
import { AuthProvider } from '../../src/contexts/AuthContext.jsx'
import DailyLogTable from '../../src/components/DailyLogTable.jsx'
import { loadDailyLogEmployees, saveDailyLogCheckpoint } from '../../src/utils/dailyLogEmployees.js'
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
 record('only active names from selected location',options.some(e=>e.id===selectedEmployee.id)&&options.every(e=>e.location_id===A&&e.is_active)&&!options.some(e=>e.name===tag+' Inactive'))
 const base={location_id:A,log_date:date,time_slot:'10:00:00',split_index:1,total_washes:20,basic:2,memberships_sold:2,opportunities:20}
 const saved=await saveDailyLogCheckpoint(supabase,{employee_name:selectedEmployee.name},base);created.logs.push(saved)
 record('actual PostgREST split-hour save',saved.employee_name===selectedEmployee.name)
 const blank=await saveDailyLogCheckpoint(supabase,{employee_name:''},{...base,split_index:2});created.logs.push(blank)
 const named=await saveDailyLogCheckpoint(supabase,{id:blank.id,employee_name:selectedEmployee.name,_savedEmployeeName:''},{...base,split_index:2})
 record('existing blank name replacement uses compatible PostgREST filter',named.employee_name===selectedEmployee.name)
 const historic=await saveDailyLogCheckpoint(supabase,{...legacy,_savedEmployeeName:legacy.employee_name},{...base,time_slot:legacy.time_slot,split_index:0,total_washes:12})
 record('unrelated edit retains historical nickname',historic.employee_name===legacy.employee_name)
 const concurrent=await supabase.from('daily_logs').update({employee_name:tag+' Concurrent nickname'}).eq('id',legacy.id);if(concurrent.error)throw concurrent.error
 const unrelated=await saveDailyLogCheckpoint(supabase,{...legacy,_savedEmployeeName:legacy.employee_name},{...base,time_slot:legacy.time_slot,split_index:0,total_washes:13})
 record('unrelated edit preserves concurrent employee name',unrelated.employee_name===tag+' Concurrent nickname')
 let conflict=false;try{await saveDailyLogCheckpoint(supabase,{...legacy,employee_name:selectedEmployee.name,_savedEmployeeName:legacy.employee_name},{...base,time_slot:legacy.time_slot,split_index:0})}catch{conflict=true}
 record('explicit replacement rejects concurrent name conflict',conflict)
 const deactivate=await supabase.from('employees').update({is_active:false}).eq('id',selectedEmployee.id);if(deactivate.error)throw deactivate.error
 let inactive=false;try{await saveDailyLogCheckpoint(supabase,{employee_name:selectedEmployee.name},{...base,time_slot:'11:00:00'})}catch{inactive=true}
 record('deactivated selection rejected before save',inactive)
 const activate=await supabase.from('employees').update({is_active:true}).eq('id',selectedEmployee.id);if(activate.error)throw activate.error
 const second=await loadDailyLogEmployees(supabase,B);record('another location contains no A selections',second.every(e=>e.location_id===B&&!options.some(a=>a.id===e.id)))
 if(profile.role==='store'){
  let denied=false;try{await saveDailyLogCheckpoint(supabase,{employee_name:''},{...base,location_id:B,time_slot:'12:00:00'})}catch{denied=true}
  record('crafted cross-location write rejected by RLS',denied)
 }else{
  const admin=await saveDailyLogCheckpoint(supabase,{employee_name:''},{...base,location_id:B,time_slot:'12:00:00'});created.logs.push({...admin,location_id:B});record('Admin authorized other-site write',!!admin.id)
 }
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
