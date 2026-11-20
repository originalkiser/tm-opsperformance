import test from 'node:test'
import assert from 'node:assert/strict'
import { cumulativeFields, cumulativeLogWarnings, confirmCumulativeLeave, canLeaveDailyLog } from '../src/utils/dailyLogValidation.js'
import { employeeDeltasByDay, chronoCompare, shopTotals } from '../src/utils/logMath.js'
const row=(time_slot,total_washes,member_washes,extra={})=>({location_id:'a',log_date:'2026-11-20',time_slot,split_index:0,employee_name:'Employee',total_washes,member_washes,google_reviews:0,basic:0,good:0,better:0,best:0,...extra})

test('reported 11 AM/12 PM example flags both wash fields with exact previous/current values and opportunities',()=>{
 const data=[row('11:00:00',45,14),row('12:00:00',57,34)],before=JSON.stringify(data)
 const warnings=cumulativeLogWarnings(data)
 assert.equal(warnings.length,1);assert.deepEqual(warnings[0].fields,['total_washes','member_washes'])
 for(const text of ['20','12','Total 45, Member 14','Total 57, Member 34','31 to 23','11:00 AM'])assert.ok(warnings[0].message.includes(text),text)
 assert.equal(warnings[0].index,1);assert.equal(warnings[0].previousIndex,0)
 assert.equal(JSON.stringify(data),before)
})
test('all seven cumulative fields flag a decrease and unchanged or increasing counts stay valid',()=>{
 for(const key of Object.keys(cumulativeFields)) {
  const data=[row('11:00:00',45,14,{[key]:10}),row('12:00:00',57,14,{[key]:9})]
  assert.ok(cumulativeLogWarnings(data).some(w=>w.fields.includes(key)&&w.message.includes('decreased')))
 }
 const valid=[row('11:00:00',45,14,{google_reviews:2,basic:1,good:2,better:3,best:4}),row('12:00:00',57,26,{google_reviews:2,basic:1,good:3,better:4,best:5})]
 assert.deepEqual(cumulativeLogWarnings(valid),[])
})
test('split employees use immediate chronological predecessor, not array position or employee name',()=>{
 const data=[row('12:00:00',70,30),row('11:00:00',45,14),row('11:00:00',57,34,{split_index:1,employee_name:''})]
 const warnings=cumulativeLogWarnings(data)
 assert.equal(warnings[0].index,2);assert.equal(warnings[0].previousIndex,1)
 assert.equal(warnings[0].checkpoint,'11:00 AM (split 1)')
 assert.ok(warnings.some(w=>w.index===0&&w.message.includes('Member Washes decreased')))
 assert.deepEqual([...data].sort(chronoCompare).map(r=>[r.time_slot,r.split_index]),[['11:00:00',0],['11:00:00',1],['12:00:00',0]])
})
test('site and business date boundaries reset baselines and explicit scope excludes other records',()=>{
 const data=[row('11:00:00',100,40),row('12:00:00',10,4,{location_id:'b'}),row('12:00:00',10,4,{log_date:'2026-11-21'})]
 assert.deepEqual(cumulativeLogWarnings(data),[])
 assert.deepEqual(cumulativeLogWarnings(data,{locationId:'a',date:'2026-11-20'}),[])
})
test('unused blank hours are ignored; saved blank-as-zero semantics are explicit, never patched',()=>{
 const blank={time_slot:'10:00:00',total_washes:'',member_washes:''}
 assert.deepEqual(cumulativeLogWarnings([blank,row('11:00:00',45,14)]),[])
 const data=[row('11:00:00',45,14,{basic:3}),row('12:00:00',57,20,{basic:''})],before=JSON.stringify(data)
 assert.match(cumulativeLogWarnings(data)[0].message,/previous 3.*blank \(saved as 0\)/)
 assert.equal(JSON.stringify(data),before)
})
test('earlier corrections revalidate later checkpoints, including gaps, reversals and explicit zero',()=>{
 const data=[row('09:00:00',10,4),row('12:00:00',30,24),row('15:00:00',40,25)]
 assert.deepEqual(cumulativeLogWarnings(data),[])
 const changed=data.map((r,i)=>i===0?{...r,member_washes:2}:r)
 assert.equal(cumulativeLogWarnings(changed)[0].index,1)
 const fixed=changed.map((r,i)=>i===1?{...r,member_washes:20}:r)
 assert.deepEqual(cumulativeLogWarnings(fixed),[])
 assert.ok(cumulativeLogWarnings([row('11:00:00',10,4),row('12:00:00',0,0)]).some(w=>w.message.includes('current 0')))
})
test('no invented resets: decreases are warnings and existing totals/deltas/formulas remain identical',()=>{
 const data=[row('11:00:00',45,14,{basic:2}),row('12:00:00',57,34,{basic:1})]
 const before=JSON.stringify([shopTotals(data),employeeDeltasByDay(data)])
 cumulativeLogWarnings(data)
 assert.equal(JSON.stringify([shopTotals(data),employeeDeltasByDay(data)]),before)
})
test('navigation confirmation preserves cancellation and does not prompt valid data',()=>{
 let calls=0
 assert.equal(confirmCumulativeLeave([],()=>{calls++;return false}),true);assert.equal(calls,0)
 const warnings=cumulativeLogWarnings([row('11:00:00',45,14),row('12:00:00',57,34)])
 assert.equal(confirmCumulativeLeave(warnings,message=>{assert.match(message,/Cancel to review/);return false}),false)
 assert.equal(confirmCumulativeLeave(warnings,()=>true),true)
 const target=new EventTarget();target.addEventListener('daily-log-before-leave',e=>e.preventDefault())
 assert.equal(canLeaveDailyLog(target),false)
 assert.equal(canLeaveDailyLog(new EventTarget()),true)
})
