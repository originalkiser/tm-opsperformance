import test from 'node:test'
import assert from 'node:assert/strict'
import { watchBudgetReport } from '../src/utils/budgetReportRefresh.js'

test('report automatically refreshes corrections, skips hidden/overlapping requests and cleans up', async () => {
  let tick, listener, calls=0, finish, cleared=false
  const page={visibilityState:'visible',addEventListener(name,fn){assert.equal(name,'visibilitychange');listener=fn},removeEventListener(name,fn){assert.equal(fn,listener);listener=null}}
  const stop=watchBudgetReport(()=>{calls++;return new Promise(resolve=>{finish=resolve})},{page,schedule(fn,ms){assert.equal(ms,60000);tick=fn;return 7},cancel(id){assert.equal(id,7);cleared=true}})
  const first=tick();await tick();assert.equal(calls,1);finish();await first
  page.visibilityState='hidden';await tick();assert.equal(calls,1)
  page.visibilityState='visible';const next=listener();assert.equal(calls,2);finish();await next
  stop();assert(cleared);assert.equal(listener,null);await tick();assert.equal(calls,2)
})
