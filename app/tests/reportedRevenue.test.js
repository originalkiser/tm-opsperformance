import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMtdRevenue, latestHistoricalRevenue, revenuePresentation } from '../src/utils/budgetRevenue.js'
import { reportedRevenuePace } from '../src/utils/budgetRevenueReporting.js'
const row = (date, amount) => ({location_id:'site',entry_date:date,mtd_revenue_actual:amount})
test('latest valid reported MTD remains visible without combining incomplete daily revenue',()=>{
 const entries=[row('2026-10-08',20000),row('2026-10-11',40000),{...row('2026-10-12','40000.001'),yesterday_total_revenue:100,yesterday_cc_revenue:0,yesterday_house_revenue:0}]
 const auto=calculateMtdRevenue(entries,'site','2026-10-12')
 const historic=latestHistoricalRevenue(entries,'site','2026-10-12')
 const pace=reportedRevenuePace(auto,historic,100000)
 assert.equal(auto.total,null);assert.equal(auto.recordedTotal,100)
 assert.equal(pace.reported.amount,40000);assert.equal(pace.reported.provisional,true)
 assert.equal(pace.reported.throughDate,'2026-10-10');assert.equal(pace.pct,0.4)
 assert.equal(pace.onTrack,true)
 assert.equal(reportedRevenuePace(auto,historic,100000).paceRatio,0.4/(10/31))
})
test('pace uses the reported date rather than later missing reporting days',()=>{
 const auto=calculateMtdRevenue([],'site','2026-10-25')
 const pace=reportedRevenuePace(auto,{amount:40000,entryDate:'2026-10-11'},100000)
 assert.equal(pace.onTrack,true) // Oct 10 progress, not Oct 24 progress.
 assert.equal(pace.reported.reportingDate,'2026-10-11')
})
test('verified Admin amount wins over overlapping reported figures and partial later rows',()=>{
 const balance={location_id:'site',revenue_month:'2026-10-01',cutoff_business_date:'2026-10-10',amount:35000}
 const auto=calculateMtdRevenue([{location_id:'site',entry_date:'2026-10-13',yesterday_total_revenue:300,yesterday_cc_revenue:0,yesterday_house_revenue:0}],'site','2026-10-13',balance)
 const pace=reportedRevenuePace(auto,{amount:99999,entryDate:'2026-10-12'},100000)
 assert.equal(pace.reported.amount,35000);assert.equal(pace.reported.source,'verified balance')
 assert.equal(pace.reported.throughDate,'2026-10-10');assert.equal(pace.onTrack,true)
 assert.equal(auto.recordedTotal,35300);assert.equal(auto.total,null)
})
test('complete automatic totals take precedence and absent sources remain unavailable',()=>{
 const complete=calculateMtdRevenue([],'site','2026-11-01')
 assert.equal(revenuePresentation(complete,{amount:99999,entryDate:'2026-10-31'}).amount,0)
 assert.equal(revenuePresentation(complete).provisional,false)
 const incomplete=calculateMtdRevenue([],'site','2026-11-03')
 assert.equal(reportedRevenuePace(incomplete,null,100000).pct,null)
 assert.equal(reportedRevenuePace(incomplete,null,100000).onTrack,null)
 assert.equal(latestHistoricalRevenue([row('2026-10-31',99999),row('2026-11-01',99999)],'site','2026-11-03'),null)
})
test('reported MTD is site/month/as-of scoped and zero remains valid',()=>{
 assert.deepEqual(latestHistoricalRevenue([row('2026-10-05',0),row('2026-10-20',1000),{...row('2026-10-10',999),location_id:'other'}],'site','2026-10-12'),{amount:0,entryDate:'2026-10-05'})
})
