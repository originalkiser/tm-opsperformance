import test from 'node:test'
import assert from 'node:assert/strict'
import { runningNetMembers, dailyNetMembers } from '../src/utils/dailyMemberships.js'
import { shopTotals } from '../src/utils/logMath.js'
const day = (lost = 8) => [
 {time_slot:'08:00:00',plans_lost_today:lost,basic:'',reactivations:''},
 {time_slot:'09:00:00',basic:2,reactivations:1},
 {time_slot:'10:00:00',basic:5,reactivations:3},
 {time_slot:'11:00:00',basic:'',reactivations:''},
]
test('opening deficit and cumulative running values follow simple/detailed formulas', () => {
 const rows=day(), before=structuredClone(rows)
 assert.deepEqual([...runningNetMembers(rows,'simple').values()],[-8,-6,-3,-3])
 assert.deepEqual([...runningNetMembers(rows,'detailed').values()],[-8,-5,0,0])
 assert.deepEqual(rows,before)
 for(const formula of ['simple','detailed']) {
  const values=[...runningNetMembers(rows,formula).values()]
  assert.equal(dailyNetMembers(rows,formula),values.at(-1))
  assert.equal(shopTotals(rows,formula).net_members,values.at(-1))
  assert.notEqual(dailyNetMembers(rows,formula),values.reduce((a,b)=>a+b,0))
 }
})
test('loss correction shifts every hour without changing cumulative sales/reactivations', () => {
 const rows=day(), before=structuredClone(rows), original=[...runningNetMembers(rows).values()]
 rows[0].plans_lost_today=12
 assert.deepEqual([...runningNetMembers(rows).values()],original.map(n=>n-4))
 before[0].plans_lost_today=12
 assert.deepEqual(rows,before)
})
test('unknown loss stays unknown; explicit zero calculates confirmed zero and growth', () => {
 for(const formula of ['simple','detailed']) {
  const missing=day(null)
  assert.ok([...runningNetMembers(missing,formula).values()].every(n=>n===null))
  assert.equal(dailyNetMembers(missing,formula),null)
  const zero=day(0)
  assert.equal(runningNetMembers(zero,formula).get(zero[0]),0)
  assert.equal(dailyNetMembers(zero,formula),formula==='simple'?5:8)
 }
})
test('reactivations-only changes carry reported sales; split snapshots are ordered and never summed', () => {
 const rows=day();rows.splice(3,0,{time_slot:'10:00:00',split_index:1,reactivations:4})
 const shuffled=[rows[4],rows[2],rows[0],rows[3],rows[1]]
 assert.deepEqual([...runningNetMembers(shuffled).values()],[-8,-5,0,1,1])
 assert.equal(dailyNetMembers(shuffled),1)
 assert.equal(dailyNetMembers(shuffled,'simple'),-3)
 rows[3].basic=0;rows[3].reactivations=0
 assert.equal(dailyNetMembers(rows),-8, 'explicit zero corrections are not replaced with earlier positive snapshots')
})
test('historical manual values remain unchanged until losses explicitly reported', () => {
 const rows=day(null);rows[1].net_members=-4;rows[1].net_members_legacy=true
 const before=structuredClone(rows)
 assert.equal(dailyNetMembers(rows),null)
 assert.deepEqual(rows,before)
 rows[0].plans_lost_today=8
 assert.equal(dailyNetMembers(rows),0)
 assert.equal(rows[1].net_members,-4)
 assert.equal(rows[1].net_members_legacy,true)
})
