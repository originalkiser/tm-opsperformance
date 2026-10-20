import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyNetMembers, hasLegacyNet, parsePlansLost, lossWriter } from '../src/utils/dailyMemberships.js'
import { shopTotals, employeeDeltasByDay } from '../src/utils/logMath.js'
const rows = lost => [
  { time_slot: '08:00:00', split_index: 0, plans_lost_today: lost, total_washes: 10, member_washes: 2, basic: 3, net_members: 0 },
  { time_slot: '09:00:00', split_index: 0, total_washes: 30, member_washes: 10, basic: 7, best: 2, employee_name: 'Alex', net_members: 0 },
  { time_slot: '09:00:00', split_index: 1, total_washes: 35, member_washes: 12, basic: 8, best: 3, employee_name: 'Chris', net_members: 0 },
]
test('cumulative sales use latest split once; zero and negative Net Members are supported', () => {
  for (const [loss, expected] of [[0, 11], [4, 7], [11, 0], [17, -6]]) {
    const data = rows(loss)
    assert.equal(dailyNetMembers(data), expected)
    assert.equal(shopTotals(data).net_members, expected)
    assert.deepEqual(Object.values(employeeDeltasByDay(data)).map(x => x.net_members), [null, null])
  }
  const edited = rows(4); edited[2].basic = 10
  assert.equal(dailyNetMembers(edited), 9)
})
test('missing losses stay unknown; historical manual Net Members are unchanged', () => {
  const legacy = rows(null); legacy[2].net_members = 5
  const before = structuredClone(legacy)
  assert.equal(dailyNetMembers(legacy), null)
  assert.equal(hasLegacyNet(legacy), true)
  assert.equal(shopTotals(legacy).net_members, 5)
  assert.deepEqual(legacy, before)
  assert.equal(hasLegacyNet([{ net_members: 0, net_members_legacy: true }]), true)
  assert.equal(dailyNetMembers([]), null)
  assert.equal(dailyNetMembers([{ time_slot: '08:00:00', plans_lost_today: 3 }]), -3)
  assert.equal(shopTotals([{ time_slot: '08:00:00', plans_lost_today: 0 }]).net_members, 0)
})
test('losses accept only nonnegative whole database integers', () => {
  for (const v of ['', '-1', '1.2', '1e2', 'x', '2147483648', null]) assert.equal(parsePlansLost(v), null)
  for (const v of ['0', '12', '2147483647']) assert.equal(parsePlansLost(v), Number(v))
})
test('save/edit/reopen is scoped by location and date; saves never carry hourly values', async () => {
  const db = new Map(), writes = []
  const client = { from(name) { assert.equal(name, 'daily_logs'); return { async upsert(row, options) {
    await Promise.resolve()
    assert.equal(options.onConflict, 'location_id,log_date,time_slot,split_index')
    writes.push(row); db.set(`${row.location_id}:${row.log_date}`, { ...row }); return { error: null }
  } } } }
  const a = lossWriter(client, 'a', '2026-10-20'), b = lossWriter(client, 'b', '2026-10-20'), tomorrow = lossWriter(client, 'a', '2026-10-21')
  await Promise.all([a(2), a(5), b(0), tomorrow(12)])
  assert.equal(db.get('a:2026-10-20').plans_lost_today, 5)
  assert.equal(db.get('b:2026-10-20').plans_lost_today, 0)
  assert.equal(db.get('a:2026-10-21').plans_lost_today, 12)
  assert.equal(db.has('b:2026-10-21'), false)
  for (const row of writes) assert.deepEqual(Object.keys(row).sort(), ['location_id', 'log_date', 'plans_lost_today', 'split_index', 'time_slot'])
})
test('failed saves surface errors and the queue permits a retry', async () => {
  let fail = true
  const write = lossWriter({ from() { return { async upsert() { return { error: fail ? { message: 'denied' } : null } } } } }, 'a', '2026-10-20')
  await assert.rejects(write(2), e => e.message === 'denied')
  fail = false; await write(0)
})
