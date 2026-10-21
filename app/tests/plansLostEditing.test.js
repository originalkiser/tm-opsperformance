import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as membership from '../src/utils/dailyMemberships.js'
import { shopTotals } from '../src/utils/logMath.js'
import { fmtNum } from '../src/utils/format.js'
const Input = () => null
function openLog(canEdit = true, role = 'store', db = [{ id: 'old', location_id: 'a', log_date: '2026-10-20', time_slot: '08:00:00', split_index: 0, basic: 4, net_members: 6, net_members_legacy: true }], opportunitiesFormula = 'detailed') {
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
  }, { locationId: 'a', selectedDate: '2026-10-20', profile: {role}, canEdit, opportunitiesFormula, onRowsChange: rows => { live = rows } })
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

test('hourly table shows opening/running negatives, final-only totals and immediate loss corrections for both formulas', async () => {
 for (const formula of ['simple','detailed']) {
  const db=[
   {id:'open',time_slot:'08:00:00',split_index:0,basic:0,reactivations:0,plans_lost_today:8},
   {id:'later',time_slot:'09:00:00',split_index:0,basic:2,reactivations:1,total_washes:20,member_washes:10},
  ]
  const h=openLog(true,'store',db,formula);h.render();await h.flush()
  const hourly=()=>h.all(n=>n.type==='input' && n.props.disabled && n.props['data-row']!==undefined).map(n=>n.props.value)
  assert.equal(hourly()[0],-8)
  const expected=formula==='simple'?-6:-5
  assert.equal(hourly()[1],expected)
  assert.equal(hourly().at(-1),expected)
  const total=()=>React.Children.toArray(h.find(n=>n.type==='tr' && n.props.className?.includes('border-t-2')).props.children)[formula==='simple'?9:10].props.children
  assert.equal(total(),String(expected))
  assert.equal(h.input().props.disabled,false)
  await h.input().props.onChange('12');await h.flush()
  assert.equal(hourly()[0],-12)
  assert.equal(hourly()[1],expected-4)
  assert.equal(total(),String(expected-4))
  assert.equal(db[1].basic,2);assert.equal(db[1].reactivations,1)
  if (formula==='detailed') {
   const row=()=>h.all(n=>n.type==='tr')[2]
   const opportunities=()=>React.Children.toArray(row().props.children)[12].props.children
   assert.equal(opportunities(),12)
   h.find(n=>n.type==='input' && n.props['data-row']===1 && n.props['data-col']===7).props.onChange({target:{value:'3'}})
   await h.flush()
   assert.equal(hourly()[1],expected-2)
   assert.equal(total(),String(expected-2))
   assert.equal(opportunities(),12, 'reactivations must not alter opportunities/conversion')
  }
 }
})
