import test from 'node:test'
import assert from 'node:assert/strict'
import { yesterdayMetrics, mtdMetrics } from '../src/utils/budgetMath.js'
import { budgetOpportunities, budgetWashOverrides, washOverridesError } from '../src/utils/budgetConversion.js'
import { YESTERDAY_FIELDS, MTD_FIELDS, budgetCountFields, emptyDailyForm, countMissing, isDayComplete } from '../src/utils/budgetDailyFields.js'
import { dailyPayload } from '../src/utils/budgetRevenue.js'
import { budgetPerformanceRow, selectPerformanceSources } from '../src/utils/budgetPerformanceSource.js'
import { agg } from '../src/utils/insightsHelpers.js'
import { buildBudgetReportRows } from '../src/utils/budgetReportRows.js'
import { scoreBudgetLocations, SCORE_WEIGHTS } from '../src/utils/budgetScoring.js'
import { loadDashboardMtd } from '../src/utils/dashboardMtdRead.js'
const detailed = { id:'a', name:'Fictional Detailed', opportunities_formula:'detailed', show_budget_tracking:true, timezone:'America/Chicago', metric_thresholds:{conv_yellow:50} }
const simple = { ...detailed, opportunities_formula:'simple' }
const entry = () => ({ ...Object.fromEntries(Object.keys(emptyDailyForm()).map(k=>[k,0])), location_id:'a', entry_date:'2026-11-12',
  yesterday_washes:100, yesterday_redemptions:60, yesterday_wash_overrides:10, yesterday_best:6,
  mtd_washes:1000, mtd_redemptions:600, mtd_wash_overrides:100, mtd_best:60,
  yesterday_total_revenue:100, yesterday_cc_revenue:80, yesterday_house_revenue:0, mtd_revenue_actual:1000, current_rating:5 })
for(const [prefix,metrics] of [['yesterday',yesterdayMetrics],['mtd',mtdMetrics]]) {
 test(`${prefix}: Detailed subtracts overrides, Simple and missing classification ignore them`,()=>{
  const row=entry(),before=structuredClone(row)
  assert.equal(metrics(row,detailed).conversion,.2);assert.equal(metrics(row,simple).conversion,.15);assert.equal(metrics(row).conversion,.15)
  assert.equal(metrics(row,detailed).pmix,metrics(row,simple).pmix);assert.deepEqual(row,before)
 })
 test(`${prefix}: historical null/absent/blank overrides equal zero without mutating rows`,()=>{
  for(const value of [undefined,null,'',0]) {const row=entry();row[`${prefix}_wash_overrides`]=value;const before=structuredClone(row);assert.equal(metrics(row,detailed).conversion,.15);assert.deepEqual(row,before)}
 })
 test(`${prefix}: zero and negative opportunities give unavailable conversion, preserve washes/sales`,()=>{
  for(const value of [prefix==='mtd'?400:40,prefix==='mtd'?500:50]) {const row=entry();row[`${prefix}_wash_overrides`]=value;const result=metrics(row,detailed);assert.equal(result.retail,0);assert.equal(result.conversion,null);const perf=budgetPerformanceRow(row,prefix,'2026-11-11',detailed);assert.equal(perf.opportunities,0);assert.equal(perf.total_washes,row[`${prefix}_washes`]);assert.equal(perf.memberships_sold,result.plansSold)}
 })
}
test('invalid override counts are rejected at payload boundary and cannot create conversion',()=>{
 for(const value of [-1,1.5,Infinity,NaN,true,' ',2147483648]) {const row=entry();row.yesterday_wash_overrides=value;assert(washOverridesError(row,detailed));assert.throws(()=>dailyPayload(row,'a','2026-11-12',detailed),/Wash Overrides/);assert.equal(yesterdayMetrics(row,detailed).conversion,null);assert.equal(budgetPerformanceRow(row,'yesterday','2026-11-11',detailed),null)}
 assert.equal(budgetWashOverrides('12',detailed),12);assert.equal(budgetOpportunities(100,60,10,detailed),30)
})
test('both entry layouts put overrides after Redemptions only for Detailed; historical completion is unchanged',()=>{
 for(const fields of [YESTERDAY_FIELDS,MTD_FIELDS]) {const result=budgetCountFields(fields,detailed);const i=result.findIndex(f=>f.key.endsWith('_redemptions'));assert(result[i+1].key.endsWith('_wash_overrides'));assert.equal(result[i+1].optional,true);assert.deepEqual(budgetCountFields(fields,simple),fields)}
 const row=entry();delete row.yesterday_wash_overrides;delete row.mtd_wash_overrides;assert.equal(countMissing(row),0);assert.equal(isDayComplete(row),true)
})
test('Detailed payload persists both counts and clearing to null; Simple payload is unchanged and ignores hidden values',()=>{
 const row=entry(),before=structuredClone(row);const payload=dailyPayload(row,'a',row.entry_date,detailed)
 assert.equal(payload.yesterday_wash_overrides,10);assert.equal(payload.mtd_wash_overrides,100);assert.deepEqual(row,before)
 assert.equal(dailyPayload({...row,yesterday_wash_overrides:''},'a',row.entry_date,detailed).yesterday_wash_overrides,null)
 const old={...row};delete old.yesterday_wash_overrides;delete old.mtd_wash_overrides
 const withoutTime=x=>{delete x.updated_at;return x}
 assert.deepEqual(withoutTime(dailyPayload(row,'a',row.entry_date,simple)),withoutTime(dailyPayload(old,'a',row.entry_date,simple)))
 row.yesterday_wash_overrides=-1;assert.doesNotThrow(()=>dailyPayload(row,'a',row.entry_date,simple))
})
test('MTD snapshot selection still replaces overlapping Daily Logs and uses weighted Budget opportunities',()=>{
 const row=entry();const log={location_id:'a',log_date:'2026-11-11',time_slot:'10:00',total_washes:9999,member_washes:1,memberships_sold:1,opportunities:9999}
 const other={...log,location_id:'b',total_washes:100,opportunities:50,memberships_sold:5};const before=structuredClone([log,other])
 const sites=[detailed,{id:'b',show_budget_tracking:false}];const range={start:'2026-11-01',end:'2026-11-12'}
 const source=selectPerformanceSources([log,other],[row],sites,range,'2026-11-12');assert.equal(agg(source.totals).opp,350);assert.equal(agg(source.totals).tw,1100);assert.equal(agg(source.totals).ms,65);assert.equal(source.daily.find(x=>x.budget_source).opportunities,30);assert.deepEqual([log,other],before)
 const oldRange={start:'2026-11-10',end:'2026-11-12'};assert.deepEqual(selectPerformanceSources([log],[row],[detailed],oldRange,'2026-11-12'),selectPerformanceSources([log],[],[simple],oldRange,'2026-11-12'))
})
test('Budget report metrics and conversion points agree; other score components and weights remain unchanged',()=>{
 const data=location=>({locations:[location],entries:[entry()],targets:[],balances:[]})
 const d=buildBudgetReportRows(data(detailed),'2026-11-12')[0],s=buildBudgetReportRows(data(simple),'2026-11-12')[0]
 assert.equal(d.yst.conversion,.2);assert.equal(d.mtd.conversion,.2);assert.equal(s.yst.conversion,.15);assert.equal(s.mtd.conversion,.15)
 assert.equal(d.scoringResult.components.conversion,8);assert.equal(s.scoringResult.components.conversion,6)
 for(const key of Object.keys(SCORE_WEIGHTS).filter(k=>k!=='conversion'))assert.equal(d.scoringResult.components[key],s.scoringResult.components[key])
 assert.deepEqual(SCORE_WEIGHTS,{conversion:20,revenue:20,pmix:10,washes:10,revenuePlan:15,growth:15,rating:10})
 const missing=data(detailed);missing.entries[0].mtd_wash_overrides=400;const r=scoreBudgetLocations(missing,'2026-11-12').rows[0];assert.equal(r.components.conversion,0);assert(Number.isFinite(r.score))
})
test('Dashboard narrow RPC result retains overrides for corrected MTD performance without leaking extra columns',async()=>{
 const row={...entry(),private_extra:'must not escape'};const client={async rpc(){return {data:[row],error:null}}}
 const [result]=await loadDashboardMtd(client,[detailed],{start:'2026-11-01'},'2026-11-11');assert.equal(result.mtd_wash_overrides,100);assert(!('private_extra' in result));assert.equal(budgetPerformanceRow(result,'mtd','2026-11-11',detailed).opportunities,300)
})
