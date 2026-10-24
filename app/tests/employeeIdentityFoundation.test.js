import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { buildEmployeePerformance } from '../src/utils/employeePerformance.js'
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('_employee_identity_foundation.sql'))
assert.equal(files.length,1)
const sql=readFileSync(new URL(`../supabase/migrations/${files[0]}`,import.meta.url),'utf8')
const strip=s=>s.replace(/--[^\n]*/g,'')
const executable=strip(sql)
const rollback=strip(readFileSync(new URL('../../docs/sql/employee-identity-foundation-ROLLBACK-REVIEW-ONLY.sql',import.meta.url),'utf8'))

test('foundation reuses existing ID column and replaces only the existing named employee FK',()=>{
  assert.doesNotMatch(executable,/add\s+column|create\s+table/i)
  assert.equal((executable.match(/add constraint daily_logs_employee_id_fkey/gi)||[]).length,1)
  assert.match(executable,/drop constraint daily_logs_employee_id_fkey restrict/i)
  assert.match(executable,/foreign key \(location_id, employee_id\) references public.employees\(location_id, id\)/i)
  assert.match(executable,/match simple on update restrict on delete restrict not valid/i)
  assert.match(executable,/validate constraint daily_logs_employee_id_fkey/i)
})

test('split-hour compatibility removes obsolete employee uniqueness and preserves current upsert key',()=>{
  assert.match(executable,/drop constraint daily_logs_location_id_log_date_time_slot_employee_id_key restrict/i)
  assert.doesNotMatch(executable,/drop constraint daily_logs_location_id_log_date_time_slot_split_index_key/i)
  assert.match(executable,/Current split-index upsert conflict target must remain present/)
  const app=readFileSync(new URL('../src/components/DailyLogTable.jsx',import.meta.url),'utf8')
  assert.equal((app.match(/onConflict: 'location_id,log_date,time_slot,split_index'/g)||[]).length,2)
})

test('assignment guard refuses insert, reassignment and clearing without an enablement switch or privileged bypass',()=>{
  const guard=executable.slice(executable.indexOf('create function public.guard_daily_employee_assignment_phase1'),executable.indexOf('comment on function public.guard_daily_employee_assignment_phase1'))
  assert.match(guard,/if new.employee_id is not null/)
  assert.match(guard,/new.employee_id is distinct from old.employee_id/)
  assert.doesNotMatch(guard,/auth\.|current_user|current_setting|security definer|session_replication_role/i)
  assert.match(guard,/security invoker set search_path = ''/i)
  assert.doesNotMatch(executable,/new\.employee_id\s*:=|old\.employee_id\s*:=/i)
})

test('permanent employee UUID/location guard does not introduce roster renames or status changes',()=>{
  assert.match(executable,/new.id is distinct from old.id or new.location_id is distinct from old.location_id/)
  assert.doesNotMatch(executable,/new\.name\s*:=|new\.is_active\s*:=|update\s+public\.employees\s+set|delete\s+from|insert\s+into/i)
})

test('draft preserves existing RLS, helper functions, views, Plans Lost and numeric scoring definitions',()=>{
  assert.doesNotMatch(executable,/create\s+policy|drop\s+policy|disable row level security|force row level security|grant\s+.*on\s+(table\s+)?public\.(employees|daily_logs)/i)
  assert.doesNotMatch(executable,/create( or replace)? (function public\.(get_user_role|user_can_edit_location|guard_daily_plans_lost)|view)/i)
  assert.match(executable,/tgname='guard_daily_plans_lost'/)
  assert.doesNotMatch(executable,/set\s+(memberships_sold|opportunities|employee_name|net_members)\s*=/i)
})

test('forward migration is atomic, short-lock bounded and refuses schema drift/reapplication',()=>{
  assert.match(executable,/^\s*begin;/i);assert.match(executable,/commit;\s*$/i)
  assert.match(executable,/set local lock_timeout = '2s'/)
  assert.match(executable,/set local statement_timeout = '15s'/)
  assert.match(executable,/lock table public.employees, public.daily_logs in access exclusive mode/i)
  assert.match(executable,/conkey=array\[d_employee\]/)
  assert.match(executable,/Foundation objects already exist/)
  assert.doesNotMatch(executable,/create or replace|create (?:unique )?index if not exists|\bcascade\b/i)
})

test('rollback refuses non-NULL IDs and cannot drop historical fields or current checkpoint identity',()=>{
  assert.match(rollback,/if exists\(select 1 from public.daily_logs where employee_id is not null\)/)
  assert.match(rollback,/foreign key \(employee_id\) references public.employees\(id\)/)
  assert.match(rollback,/unique \(location_id,log_date,time_slot,employee_id\)/)
  assert.doesNotMatch(rollback,/drop column|delete from|update public\.|\bcascade\b|drop constraint daily_logs_location_id_log_date_time_slot_split_index_key/i)
})

const sites=[{id:'s',name:'Simple',opportunities_formula:'simple'},{id:'d',name:'Detailed',opportunities_formula:'detailed'}]
const range={start:'2026-10-01',end:'2026-10-24'}
const row=(name,time,washes,best,extra={})=>({location_id:'s',log_date:'2026-10-20',time_slot:time,split_index:0,employee_name:name,total_washes:washes,member_washes:0,basic:0,good:0,better:0,best,google_reviews:0,...extra})
const report=logs=>buildEmployeePerformance(logs,sites,range)

test('supported historical name-based scores, qualifications and ranks are identical with absent/NULL/unresolved IDs',()=>{
  const logs=[row('Cam','08:00',100,10),row('Other','09:00',200,20),row(' cam ','08:00',50,5,{log_date:'2026-10-21'}),row('Cam','08:00',100,10,{location_id:'d'})]
  const expected=report(logs)
  assert.deepEqual(report(logs.map(r=>({...r,employee_id:null}))),expected)
  assert.deepEqual(report(logs.map((r,i)=>({...r,employee_id:`unverified-${i}`}))),expected)
  assert.equal(expected.rows.filter(r=>r.locationId==='s'&&r.name==='Cam').length,1)
  assert.equal(expected.rows.find(r=>r.locationId==='s'&&r.name==='Cam').ms,15)
  assert.ok(expected.rows.every(r=>r.score!=null))
})

test('same employee in multiple splits is attributed once per chronological delta, not per roster record or ID',()=>{
  const logs=[row('Cam','08:00',10,1),row('Other','08:00',30,3,{split_index:1}),row('CAM','08:00',40,4,{split_index:2})]
  const result=report(logs)
  assert.equal(result.rows.find(r=>r.name==='Cam').ms,2)
  assert.equal(result.rows.reduce((s,r)=>s+r.ms,0),4)
  assert.equal(result.rows.reduce((s,r)=>s+r.opp,0),40)
  assert.deepEqual(report(logs.map(r=>({...r,employee_id:'same-source-id'}))),result)
})

test('zero sales, missing numeric inputs and correction rules are unchanged by unknown historical identity',()=>{
  for(const logs of [[row('Cam','08:00',0,0)], [row('Cam','08:00',null,2)], [row('Cam','08:00',100,10),row('Corrector','09:00',90,9)]]){
    assert.deepEqual(report(logs.map(r=>({...r,employee_id:null}))),report(logs))
  }
  const zero=report([row('Cam','08:00',0,0)]).rows[0];assert.equal(zero.score,0);assert.equal(zero.rank,1)
})
