import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDailyForm, countMissing, isDayComplete, isPerformanceEntryComplete } from '../src/utils/budgetDailyFields.js'
import { dailyPayload } from '../src/utils/budgetRevenue.js'
import { reconcileCash } from '../src/utils/cashReconciliation.js'
import { scoreBudgetLocations } from '../src/utils/budgetScoring.js'

test('cash is required for completion, including explicit zero, but discrepancies are valid submissions',()=>{
  const form=Object.fromEntries(Object.keys(emptyDailyForm()).map(k=>[k,0]))
  assert(isDayComplete(form));assert.equal(countMissing({...form,yesterday_cash_counted:''}),1)
  assert.equal(isDayComplete({...form,yesterday_cash_counted:null}),false)
  assert.equal(isDayComplete({...form,yesterday_cash_counted:'1.001'}),false)
  const short={...form,yesterday_total_revenue:119,yesterday_cash_counted:968}
  assert.equal(reconcileCash(short,85000).variance,-100);assert(isDayComplete(short))
  assert.equal(dailyPayload(short,'site','2026-10-15').yesterday_cash_counted,968)
  assert(isPerformanceEntryComplete({...form,yesterday_cash_counted:null}),'cash workflow requirement does not change the seven performance categories')
})

test('Budget MTD scoring is authoritative: partial hourly logs cannot replace or add to cumulative totals',()=>{
  const input={locations:['a','b'].map(id=>({id,name:id,show_budget_tracking:true})),targets:['a','b'].map(location_id=>({location_id,target_month:'2026-10-01',revenue_goal:3100,membership_goal:162,starting_members:100,membership_daily_growth:2,desired_rating:4.85})),entries:['a','b'].map(location_id=>({...Object.fromEntries(Object.keys(emptyDailyForm()).map(k=>[k,0])),location_id,entry_date:'2026-10-03',mtd_washes:100,mtd_redemptions:50,mtd_best:5,mtd_membership_actual:104,current_rating:5})),balances:['a','b'].map(location_id=>({location_id,revenue_month:'2026-10-01',amount:600,cutoff_business_date:'2026-10-02'}))}
  const before=scoreBudgetLocations(input,'2026-10-03')
  const withPartialLogs=scoreBudgetLocations({...input,dailyLogs:[{location_id:'a',log_date:'2026-10-02',total_washes:999999},{location_id:'a',log_date:'2026-10-02',total_washes:999999}]},'2026-10-03')
  assert.deepEqual(withPartialLogs,before);assert.equal(before.rows.find(r=>r.id==='a').washes,100)
})
