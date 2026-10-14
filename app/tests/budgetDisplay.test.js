import test from 'node:test'
import assert from 'node:assert/strict'
import { revenueDisplayPlan, displayCount } from '../src/utils/budgetDisplay.js'

test('MTD goals follow the same reporting date as provisional/automatic dollars',()=>{
  const automatic={complete:true,total:1200,throughDate:'2026-10-12'}
  const plan=revenueDisplayPlan(automatic,null,3100)
  assert.equal(plan.expected,1200);assert.equal(plan.progress,12/31);assert.equal(plan.onTrack,true)
  const provisional=revenueDisplayPlan({complete:false,startingBalance:{amount:1000,cutoff_business_date:'2026-10-10'}},null,3100)
  assert.equal(provisional.expected,1000);assert.equal(provisional.progress,10/31)
  assert.equal(revenueDisplayPlan({complete:false},null,3100).progress,null)
  assert.equal(revenueDisplayPlan(automatic,null,0).expected,null)
  assert.equal(displayCount(''), '—');assert.equal(displayCount(0),'0')
})

