import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreBudgetLocations, SCORE_WEIGHTS } from '../src/utils/budgetScoring.js'
import { buildBudgetReportRows } from '../src/utils/budgetReportRows.js'
import { shiftDate } from '../src/utils/budgetRevenue.js'

function fixture(ids = ['a','b','empty'], days = 10) {
  const locations = ids.map(id => ({id,name:`Site ${id}`,show_budget_tracking:true}))
  const targets = ids.map(location_id => ({location_id,target_month:'2026-10-01',revenue_goal:3100,starting_members:100,membership_daily_growth:2,desired_rating:4.85,membership_goal:162}))
  const entries = []
  for(const location_id of ids.filter(id=>id!=='empty')) {
    for(let day=1;day<=days;day++) entries.push({location_id,entry_date:shiftDate('2026-10-01',day),
      yesterday_washes:100,yesterday_redemptions:0,yesterday_basic:4,yesterday_good:0,yesterday_better:6,yesterday_best:0,
      yesterday_total_revenue:100,yesterday_cc_revenue:80,yesterday_house_revenue:0,
      mtd_washes:100*day,mtd_redemptions:0,mtd_basic:4*day,mtd_good:0,mtd_better:6*day,mtd_best:0,
      mtd_membership_actual:100+day*2,current_reviews:day,current_rating:4.85})
  }
  return {locations,targets,entries,balances:[]}
}
const score=(data,date='2026-10-11')=>scoreBudgetLocations(data,date)
const find=(result,id='a')=>result.rows.find(r=>r.id===id)
const assertOfficial=result=>{for(const row of result.rows){assert(Number.isFinite(row.score));assert(row.score>=0&&row.score<=100);assert(Number.isInteger(row.rank));for(const [key,value] of Object.entries(row.components)){assert(Number.isFinite(value));assert(value>=0&&value<=SCORE_WEIGHTS[key])}}}

test('complete reporters preserve weights, caps, proportional formulas and valid-value ties; zero-data site remains ranked at zero',()=>{
 const data=fixture(),before=structuredClone(data),result=score(data)
 assertOfficial(result);assert.equal(result.competitiveSites,3)
 assert.deepEqual(result.competitiveValues,{revenue:2,washes:2})
 assert.equal(find(result).score,85);assert.equal(find(result,'b').score,85)
 assert.equal(find(result).rank,1);assert.equal(find(result,'b').rank,1)
 assert.equal(find(result,'empty').score,0);assert.equal(find(result,'empty').rank,3)
 assert.equal(find(result).components.revenue,10);assert.equal(find(result).components.washes,5)
 assert.equal(find(result).components.revenuePlan,15);assert.equal(find(result).components.growth,15)
 assert.deepEqual(data,before)
})

test('one and multiple missing reporting/revenue days do not fabricate revenue or withhold other supported categories',()=>{
 for(const missing of [['2026-10-05'],['2026-10-05','2026-10-07','2026-10-10']]) {
  const data=fixture();data.entries=data.entries.filter(e=>e.location_id!=='a'||!missing.includes(e.entry_date))
  const row=find(score(data));assertOfficial(score(data))
  assert.deepEqual(row.completeness.missingReportingDates,missing)
  assert.deepEqual(row.completeness.missingRevenueDates,missing.map(date=>shiftDate(date,-1)))
  assert.equal(row.revenue,null);assert.equal(row.scoringRevenue,null)
  assert.equal(row.components.revenue,0);assert.equal(row.components.revenuePlan,0)
  assert.equal(row.components.conversion,20);assert.equal(row.components.pmix,10)
  assert.equal(row.washes,1000,'later cumulative snapshot is used once, not summed across missing days')
  assert.equal(row.lastEntryDate,'2026-10-11');assert(row.score>0)
 }
})

test('missing individual revenue fields invalidate that revenue date without erasing counts, rating or rank',()=>{
 const data=fixture();data.entries.find(e=>e.location_id==='a'&&e.entry_date==='2026-10-08').yesterday_cc_revenue=null
 const row=find(score(data))
 assert.deepEqual(row.completeness.missingRevenueDates,['2026-10-07'])
 assert.equal(row.components.revenue,0);assert.equal(row.components.rating,10)
 assert.equal(row.completeness.dailyEntryComplete,true,'current entry is separate from older missing days')
 assertOfficial(score(data))
})

test('five-day stale comparable site has lower cumulative points and uses full reporting-cutoff revenue/growth expectations',()=>{
 const data=fixture(['a','b'])
 data.entries=data.entries.filter(e=>e.location_id!=='a'||e.entry_date<='2026-10-06')
 data.balances=[{location_id:'a',revenue_month:'2026-10-01',cutoff_business_date:'2026-10-05',amount:500}]
 const result=score(data),stale=find(result),current=find(result,'b')
 assert.equal(stale.expectedRevenue,1000);assert.equal(stale.expectedGrowth,20)
 assert.equal(stale.lastEntryDate,'2026-10-06');assert.equal(stale.componentSources.conversion.throughDate,'2026-10-05')
 assert.equal(stale.scoringRevenue,500);assert.equal(stale.revenue,null)
 assert.equal(stale.components.revenuePlan,7.5);assert.equal(stale.components.growth,7.5)
 assert(stale.score<current.score);assert(stale.rank>current.rank)
 const report=buildBudgetReportRows(data,'2026-10-11').find(r=>r.loc.id==='a')
 assert.equal(report.plan.expected,1000);assert.equal(report.plan.progress,10/31)
 assert.equal(report.rev.paceRatio,.5);assert.equal(report.rev.onTrack,false)
 assert.equal(report.rev.reported.throughDate,'2026-10-05');assert.equal(report.rev.reported.provisional,true)
})

test('category validity is independent; missing targets/categories receive zero without rescaling',()=>{
 const data=fixture(['a','b'])
 for(const row of data.entries.filter(e=>e.location_id==='a')){row.mtd_best=null;row.current_rating=null}
 data.targets[0].starting_members=null
 const row=find(score(data))
 assert.equal(row.components.conversion,0);assert.equal(row.components.pmix,0)
 assert.equal(row.components.growth,0);assert.equal(row.components.rating,0)
 assert.equal(row.washes,1000);assert.equal(row.components.washes,5)
 assert.equal(row.components.revenue,10);assert.equal(row.components.revenuePlan,15)
 assert.equal(row.score,30);assert.equal(row.availableWeight,45)
 assertOfficial(score(data))
})

test('a missing latest category uses its latest valid in-month snapshot with an explicit supporting date',()=>{
 const data=fixture(['a','b']);data.entries.find(e=>e.location_id==='a'&&e.entry_date==='2026-10-11').mtd_membership_actual=null
 const row=find(score(data))
 assert.equal(row.growth,18);assert.equal(row.expectedGrowth,20);assert.equal(row.components.growth,13.5)
 assert.equal(row.componentSources.growth.entryDate,'2026-10-10')
 assert.equal(row.componentSources.rating.entryDate,'2026-10-11')
 assert.equal(row.completeness.dailyEntryComplete,false)
})

test('targets alone or previous-month activity cannot create points; month start sites remain officially ranked at zero',()=>{
 const data=fixture();data.entries=data.entries.map(e=>({...e,entry_date:'2026-09-30'}))
 let result=score(data);assertOfficial(result);assert(result.rows.every(r=>r.score===0&&r.rank===1))
 result=score(fixture(),'2026-10-01');assertOfficial(result)
 assert(result.rows.every(r=>r.score===0&&r.rank===1))
 assert(result.rows.every(r=>r.lastEntryDate===null))
})

test('explicit reported zero is valid for competitive tie rules, while missing metrics earn zero points',()=>{
 const data=fixture()
 data.entries=data.entries.map(e=>({...e,mtd_washes:0,mtd_redemptions:0,mtd_basic:0,mtd_good:0,mtd_better:0,mtd_best:0,
  mtd_membership_actual:100,current_rating:0,yesterday_total_revenue:0,yesterday_cc_revenue:0,yesterday_house_revenue:0}))
 const result=score(data)
 for(const id of ['a','b']){assert.equal(find(result,id).score,15);assert.equal(find(result,id).rank,1)}
 assert.equal(find(result,'empty').score,0);assert.equal(find(result,'empty').rank,3)
})

test('fewer than two valid competitive values award zero only to those categories, with all sites still ranked',()=>{
 const data=fixture(['a','empty']),result=score(data),row=find(result)
 assert.equal(result.competitiveSites,2);assert.deepEqual(result.competitiveValues,{revenue:1,washes:1})
 assert.equal(row.components.revenue,0);assert.equal(row.components.washes,0);assert.equal(row.score,70)
 assert.match(row.componentIssues.revenue,/Fewer than two/);assert.match(row.componentIssues.washes,/Fewer than two/)
 assert.equal(row.rank,1);assert.equal(find(result,'empty').rank,2)
})

test('verified baseline wins over overlapping historical and partial daily revenue; gaps stay incomplete and recovery never double-counts',()=>{
 const data=fixture(['a','b'])
 data.entries=data.entries.filter(e=>e.location_id!=='a'||e.entry_date!=='2026-10-10')
 data.entries.find(e=>e.location_id==='a'&&e.entry_date==='2026-10-09').mtd_revenue_actual=99999
 data.entries.find(e=>e.location_id==='a'&&e.entry_date==='2026-10-09').yesterday_total_revenue=9999
 data.balances=[{location_id:'a',revenue_month:'2026-10-01',cutoff_business_date:'2026-10-08',amount:800}]
 let row=find(score(data))
 assert.equal(row.revenue,null);assert.equal(row.revenueResult.recordedTotal,900)
 assert.equal(row.scoringRevenue,800);assert.equal(row.reportedRevenue,800)
 assert.equal(row.provisionalRevenue,true);assert.equal(row.historicalRevenue,null)
 const restored=fixture(['a']).entries.find(e=>e.entry_date==='2026-10-10');data.entries.push(restored)
 row=find(score(data));assert.equal(row.revenue,1000);assert.equal(row.scoringRevenue,1000);assert.equal(row.provisionalRevenue,false)
})

test('reported cumulative revenue remains a single provisional source and is not mixed with partial daily totals',()=>{
 const data=fixture(['a','b']);data.entries=data.entries.filter(e=>e.location_id!=='a'||e.entry_date==='2026-10-11')
 data.entries.find(e=>e.location_id==='a').mtd_revenue_actual=900
 data.entries.push({...fixture(['a']).entries.at(-1),entry_date:'2026-10-13',yesterday_total_revenue:200})
 const row=find(score(data,'2026-10-13'))
 assert.equal(row.revenue,null);assert.equal(row.revenueResult.recordedTotal,300)
 assert.equal(row.scoringRevenue,900);assert.equal(row.reportedThrough,'2026-10-10')
 assert.equal(row.expectedRevenue,1200);assert.equal(row.components.revenuePlan,11.25)
})

test('duplicate/invalid sources do not crash the pool or receive arbitrary points; older unambiguous snapshots are used',()=>{
 const data=fixture(['a','b']);data.entries.push({...data.entries.find(e=>e.location_id==='a'&&e.entry_date==='2026-10-11'),mtd_washes:999999})
 let result=score(data),row=find(result);assertOfficial(result)
 assert.equal(row.componentSources.washes.entryDate,'2026-10-10');assert.equal(row.washes,900)
 assert.equal(row.components.revenue,0);assert.equal(row.revenue,null);assert.match(row.revenueSourceError,/Duplicate revenue/)
 assert.doesNotThrow(()=>buildBudgetReportRows(data,'2026-10-11'))
 assert.equal(find(score({...data,entries:[...data.entries].reverse()})).score,row.score)
 const invalid=fixture(['a','b']);invalid.balances=[{location_id:'a',revenue_month:'2026-10-01',cutoff_business_date:'2026-10-10',amount:-1}]
 result=score(invalid);assertOfficial(result);assert.equal(find(result).scoringRevenue,null);assert(find(result,'b').score>0)
})

test('historical cutoff ignores future entries/targets/baselines and final zero-score ties use competition ranks',()=>{
 const data=fixture(['a','b','empty']),before=score(data)
 data.entries.push({...data.entries[0],entry_date:'2026-10-12',mtd_washes:99999})
 data.targets.push({...data.targets[0],target_month:'2026-11-01',revenue_goal:1})
 data.balances.push({location_id:'a',revenue_month:'2026-11-01',amount:99999,cutoff_business_date:'2026-11-10'})
 assert.deepEqual(score(data),before)
 data.locations.push({id:'empty2',name:'Empty 2',show_budget_tracking:true})
 const result=score(data);assert.equal(find(result,'empty').rank,3);assert.equal(find(result,'empty2').rank,3)
})
