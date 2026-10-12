import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMtdRevenue, startingBalanceCutoffError, lastCompletedBusinessDate, latestHistoricalRevenue } from '../src/utils/budgetRevenue.js'
import { revenuePace } from '../src/utils/budgetMath.js'
const row = (date, total) => ({location_id:'site',entry_date:date,yesterday_total_revenue:total,yesterday_cc_revenue:0,yesterday_house_revenue:0})
const balance = cutoff => ({location_id:'site',revenue_month:'2026-10-01',cutoff_business_date:cutoff,amount:1000})
test('cutoff controls overlap, missing days and corrections without mutating manager entries', () => {
  const entries=[row('2026-10-10',90),row('2026-10-11',100),row('2026-10-12',110),row('2026-10-14',130)]
  const before=JSON.stringify(entries)
  let result=calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-10'))
  assert.deepEqual(result.missingDates,['2026-10-12']);assert.equal(result.recordedTotal,1240);assert.equal(result.total,null)
  assert.equal(revenuePace(result.total,10000,0.4).onTrack,null)
  result=calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-12'))
  assert.equal(result.total,1130);assert.deepEqual(result.missingDates,[])
  assert.equal(JSON.stringify(entries),before)
  entries[2].yesterday_total_revenue=999 // Covered day correction cannot change verified total.
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-12')).total,1130)
  entries[3].yesterday_total_revenue=135
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-12')).total,1135)
  entries[2].yesterday_total_revenue=110
  entries.push(row('2026-10-13',120))
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-10')).total,1365)
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-09')).total,1465)
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-14',{...balance('2026-10-10'),amount:2000}).total,2365)
})
test('covered invalid or duplicate rows are preserved and excluded; post-cutoff duplicates fail',()=>{
  const entries=[row('2026-10-11',-1),row('2026-10-11',999),row('2026-10-12',110)]
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-12',balance('2026-10-10')).total,1110)
  assert.throws(()=>calculateMtdRevenue([...entries,row('2026-10-12',110)],'site','2026-10-12',balance('2026-10-10')))
})
test('historical/provisional references never replace or overlap an active verified balance',()=>{
  const entries=[{location_id:'site',entry_date:'2026-10-12',mtd_revenue_actual:9000}]
  assert.equal(latestHistoricalRevenue(entries,'site','2026-10-14',balance('2026-10-10')),null)
  assert.equal(calculateMtdRevenue(entries,'site','2026-10-14',balance('2026-10-10')).total,null)
  assert.equal(latestHistoricalRevenue(entries,'site','2026-10-14').amount,9000)
})
test('cutoffs require real October dates and the last completed site-local day',()=>{
  for(const date of ['','2026-09-30','2026-11-01','2026-10-32','2026-02-30','2026-10-1']) assert.ok(startingBalanceCutoffError(date))
  assert.equal(startingBalanceCutoffError('2026-10-11','2026-10-01','2026-10-11'),null)
  assert.ok(startingBalanceCutoffError('2026-10-12','2026-10-01','2026-10-11'))
  const instant=new Date('2026-10-12T02:00:00Z')
  assert.equal(lastCompletedBusinessDate('America/Chicago',instant),'2026-10-10')
  assert.equal(lastCompletedBusinessDate('Asia/Tokyo',instant),'2026-10-11')
})
test('later-cutoff balance does not enter earlier historical views or another month',()=>{
  assert.equal(calculateMtdRevenue([],'site','2026-10-10',balance('2026-10-11')).startingBalance,null)
  assert.equal(calculateMtdRevenue([],'site','2026-11-01',balance('2026-10-31')).total,0)
  assert.equal(calculateMtdRevenue([row('2026-11-02',50)],'site','2026-11-02',balance('2026-10-31')).total,50)
})
