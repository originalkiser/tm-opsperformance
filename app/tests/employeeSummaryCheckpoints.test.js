import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { employeeDeltasByDay } from '../src/utils/logMath.js'
import { buildEmployeePerformance } from '../src/utils/employeePerformance.js'
const row = (name, time, count, split_index=0) => ({ employee_name:name,time_slot:time,split_index,location_id:'s',log_date:'2026-11-01',total_washes:count*10,member_washes:count*2,basic:count,good:0,better:0,best:0,google_reviews:0,net_members:0 })
for (const [name,rows] of [
 ['unnamed middle checkpoint',[row('Alex','08:00',1),row(' ','09:00',2),row('Blair','10:00',3)]],
 ['unnamed opening checkpoint',[row(null,'08:00',1),row('Blair','09:00',2)]],
 ['split checkpoints',[row('Alex','08:00',1),row('', '08:00',2,1),row('Blair','08:00',3,2)]],
]) test(name, () => {
 let actual
 const harness=locationHelpHarness('components/EmployeeSummary', { employeeDeltasByDay: input => { actual=employeeDeltasByDay(input);return actual }, dailyNetMembers:()=>0,plansLost:()=>null,fmtNum:String,pmixCls:()=>'',convCls:()=>'',pmixTotalsCls:()=>'',convTotalsCls:()=>'' }, {rows})
 harness.render()
 assert.equal(actual.Blair.basic,1)
 const performance=buildEmployeePerformance(rows,[{id:'s',name:'Site'}],{start:'2026-11-01',end:'2026-11-01'})
 assert.equal(performance.rows.find(r=>r.name==='Blair').ms,actual.Blair.basic)
 assert.deepEqual(rows.map(r=>r.employee_name),name==='unnamed opening checkpoint'?[null,'Blair']:name==='split checkpoints'?['Alex','','Blair']:['Alex',' ','Blair'])
})
