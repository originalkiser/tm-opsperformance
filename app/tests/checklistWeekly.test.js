import test from 'node:test'
import assert from 'node:assert/strict'
import { validateWeeklyPeriods, validateWeeklyTiming, weeklyDueText } from '../src/utils/checklistWeekly.js'
import {fetchChecklistCompliance,buildComplianceRows,summarizeCompliance,complianceCsv} from '../src/utils/checklistCompliance.js'
const timing=phase=>({due_at:'2026-12-01T08:00:00Z',due_date:'2026-11-30',phase})
const range={start:'2026-11-23',end:'2026-11-29'}
function input(){return {generated_at:'2026-12-01T08:00:00Z',range_start:range.start,range_end:range.end,locations:[{id:'fictional',site_code:'1000',name:'Fictional',timezone:'America/Los_Angeles',local_today:'2026-12-01'}],submissions:[{location_id:'fictional',template_key:'weekly',period_date:range.start,status:'submitted',is_pilot:false,weekly_timing:timing('submitted_on_time')},{location_id:'fictional',template_key:'weekly_pm',period_date:range.start,status:'submitted',is_pilot:false,weekly_timing:timing('completed_late')}],weekly_periods:[{location_id:'fictional',period_date:range.start,weekly_timing:timing('overdue'),score:0}]}}
test('deadline labels use the server calendar date, not browser timezone; malformed timing fails closed',()=>{
 assert.equal(weeklyDueText(timing('overdue'),'America/Los_Angeles'),'Due Monday, 2026-11-30 at 11:59 p.m. (America/Los_Angeles)')
 assert.equal(validateWeeklyTiming(null),null)
 for(const change of [{phase:'submitted'},{due_at:'invalid'},{due_date:'2026-12-01'}]) assert.throws(()=>validateWeeklyTiming({...timing('in_progress'),...change}))
 assert.equal(validateWeeklyPeriods([{period_date:'2026-11-23',weekly_timing:null}]).length,1)
 assert.throws(()=>validateWeeklyPeriods([{period_date:'2026-11-24'}]))
})
test('both submitted but one Completed Late remains server-scored zero, distinctly visible and exported',async()=>{
 const data=await fetchChecklistCompliance({rpc:async()=>({data:input()})},range)
 const rows=buildComplianceRows(data,'weekly',range)
 assert.equal(rows[0].score,0);assert.equal(rows[0].cells[1].displayStatus,'completed_late');assert.deepEqual(rows[0].late,['Preventive Maintenance'])
 assert.equal(summarizeCompliance(rows).completedLate,1);assert.equal(summarizeCompliance(rows).overdue,0)
 const csv=complianceCsv(rows,'weekly',data.generated_at);assert.match(csv,/Completed Late/);assert.match(csv,/2026-11-30/)
})
test('overdue is separate from incomplete drafts and missing; Monday before deadline is not overdue',()=>{
 let data=input();data.submissions[1]={...data.submissions[1],status:'draft',weekly_timing:timing('overdue')}
 let row=buildComplianceRows(data,'weekly',range)[0];assert.deepEqual(row.inProgress,['Preventive Maintenance']);assert.deepEqual(row.overdue,['Preventive Maintenance']);assert.equal(row.cells[1].displayStatus,'overdue')
 data.locations[0].local_today='2026-11-30';data.weekly_periods[0].weekly_timing=timing('not_started');data.submissions[1].weekly_timing=timing('in_progress')
 row=buildComplianceRows(data,'weekly',range)[0];assert.deepEqual(row.overdue,[]);assert.equal(row.current,true);assert.equal(row.cells[1].status,'draft')
})
test('on-time 100 is authoritative and missing server timing fails closed; historical rows retain old scoring',async()=>{
 const data=input();data.submissions[1].weekly_timing=timing('submitted_on_time');data.weekly_periods[0].score=100
 assert.equal(buildComplianceRows(data,'weekly',range)[0].score,100)
 delete data.submissions[1].weekly_timing;await assert.rejects(fetchChecklistCompliance({rpc:async()=>({data})},range),/timing was missing/)
 delete data.weekly_periods;delete data.submissions[0].weekly_timing
 const historic=await fetchChecklistCompliance({rpc:async()=>({data})},range)
 assert.equal(buildComplianceRows(historic,'weekly',range)[0].score,100);assert.equal(summarizeCompliance(buildComplianceRows(historic,'weekly',range)).completedLate,undefined)
})
