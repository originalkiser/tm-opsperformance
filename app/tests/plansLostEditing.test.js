import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as membership from '../src/utils/dailyMemberships.js'
import { shopTotals } from '../src/utils/logMath.js'
import { fmtNum } from '../src/utils/format.js'
const Input = () => null
function openLog(canEdit = true, role = 'store', db = [{ id: 'old', location_id: 'a', log_date: '2026-10-20', time_slot: '08:00:00', split_index: 0, basic: 4, net_members: 6, net_members_legacy: true }]) {
  const writes = []; let live
  const supabase = { from(table) { const q = {
    select() { return q }, eq() { return q }, order() { return q },
    async upsert(row) { writes.push(row); const old = db.find(r => r.time_slot === row.time_slot); Object.assign(old, row); return { error: null } },
    then(resolve) { return Promise.resolve({ data: table === 'daily_logs' ? structuredClone(db) : [], error: null }).then(resolve) },
  }; return q } }
  const h = locationHelpHarness('components/DailyLogTable', {
    ...membership, supabase, shopTotals, fmtNum, PlansLostInput: Input,
    useCallback: f => f, useAuth: () => ({ updateProfileSettings() {} }),
    EmployeeSelect: () => null, TmLoader: () => null, DowntimeModal: () => null,
    pmixCls: () => '', convCls: () => '', pmixTotalsCls: () => '', convTotalsCls: () => '',
    localStorage: { getItem: () => 'table', setItem() {} },
    window: { addEventListener() {}, removeEventListener() {} }, clearTimeout() {}, setTimeout() {},
  }, { locationId: 'a', selectedDate: '2026-10-20', profile: {role}, canEdit, onRowsChange: rows => { live = rows } })
  return Object.assign(h, { input: () => h.find(n => n.type === Input), live: () => live, db, writes })
}
test('Store and Admin can save/correct/reopen loss values on an existing legacy log without touching manual net', async () => {
  for (const role of ['store', 'admin']) {
    const h = openLog(true, role); h.render(); await h.flush()
    assert.equal(h.input().props.disabled, false)
    await h.input().props.onChange('9'); await h.flush()
    assert.equal(membership.dailyNetMembers(h.live()), -5)
    assert.equal(h.input().props.disabled, false)
    await h.input().props.onChange('0'); await h.flush()
    assert.equal(membership.dailyNetMembers(h.live()), 4)
    assert.equal(h.db[0].net_members, 6)
    assert.equal(h.db[0].net_members_legacy, true)
    assert.ok(h.writes.every(r => !('net_members' in r) && !('basic' in r)))
    const reopened = openLog(true, role, h.db); reopened.render(); await reopened.flush()
    assert.equal(reopened.input().props.value, 0)
    assert.equal(reopened.input().props.disabled, false)
  }
})
test('existing location/date edit denial still disables losses and rejects writes', async () => {
  const h = openLog(false); h.render(); await h.flush()
  assert.equal(h.input().props.disabled, true)
  await h.input().props.onChange('3'); await h.flush()
  assert.equal(h.writes.length, 0)
})
