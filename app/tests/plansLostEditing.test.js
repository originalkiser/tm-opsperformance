import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { netMemberStyle, netMembersCls } from '../src/utils/netMemberColors.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { dailyLogPersistence } from '../src/utils/dailyLogEmployees.js'
import * as membership from '../src/utils/dailyMemberships.js'
import { shopTotals } from '../src/utils/logMath.js'
import { fmtNum } from '../src/utils/format.js'
const Input = () => null
function openLog(canEdit = true, role = 'store', db = [{ id: 'old', location_id: 'a', log_date: '2026-10-20', time_slot: '08:00:00', split_index: 0, basic: 4, net_members: 6, net_members_legacy: true }], opportunitiesFormula = 'detailed', view = 'table') {
  const writes = []; let live
  const supabase = { from(table) { let body, action, filters=[]; const q = {
    select() { return q }, eq(k,v) { filters.push([k,v]); return q }, is(k,v) { filters.push([k,v]); return q }, order() { return q },
    update(row) { body=row; action='update'; return q }, insert(row) { body=row; action='insert'; return q },
    async maybeSingle() {
      let old=db.find(r=>filters.every(([k,v])=>r[k]===v || r[k]===undefined))
      if(action) { writes.push(body); if(!old){old={id:'new'};db.push(old)};Object.assign(old,body) }
      return {data:old?structuredClone(old):null,error:null}
    },
    then(resolve) { return Promise.resolve({ data: table === 'daily_logs' ? structuredClone(db) : [], error: null }).then(resolve) },
  }; return q } }
  const h = locationHelpHarness('components/DailyLogTable', {
    ...membership, dailyLogPersistence, netMemberStyle, netMembersCls, supabase, shopTotals, fmtNum, PlansLostInput: Input,
    useCallback: f => f, useAuth: () => ({ updateProfileSettings() {} }),
    EmployeeSelect: () => null, TmLoader: () => null, DowntimeModal: () => null,
    pmixCls: () => '', convCls: () => '', pmixTotalsCls: () => '', convTotalsCls: () => '',
    localStorage: { getItem: () => view, setItem() {} },
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

test('hourly table hides the loss-only anchor and empty hours, preserving running values and totals and immediate loss corrections for both formulas', async () => {
 for (const formula of ['simple','detailed']) {
  const db=[
   {id:'open',time_slot:'08:00:00',split_index:0,basic:0,reactivations:0,plans_lost_today:8},
   {id:'later',time_slot:'09:00:00',split_index:0,basic:2,reactivations:1,total_washes:20,member_washes:10},
  ]
  const h=openLog(true,'store',db,formula);h.render();await h.flush()
  const hourly=()=>h.all(n=>n.type==='input' && n.props.disabled && n.props['data-row']!==undefined).map(n=>n.props.value)
  assert.equal(hourly()[0],'')
  const expected=formula==='simple'?-6:-5
  assert.equal(hourly()[1],expected)
  assert.equal(hourly().at(-1),'')
  const total=()=>React.Children.toArray(h.find(n=>n.type==='tr' && n.props.className?.includes('border-t-2')).props.children)[formula==='simple'?9:10].props.children
  assert.equal(total(),String(expected))
  assert.equal(h.input().props.disabled,false)
  await h.input().props.onChange('12');await h.flush()
  assert.equal(hourly()[0],'')
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

test('Net Members colors follow loss edits through negative, zero and positive; unknown stays neutral', async () => {
 const h=openLog(true,'store',[{id:'historic',time_slot:'08:00:00',split_index:0,basic:4,total_washes:10,member_washes:2,net_members:6,net_members_legacy:true}]);h.render();await h.flush()
 const total=()=>React.Children.toArray(h.find(n=>n.type==='tr' && n.props.className?.includes('border-t-2')).props.children)[10]
 // Historical net of six remains positive before an explicit loss is reported.
 assert.match(total().props.className,/bg-green-100/)
 for (const [loss,color] of [['9','red'],['4','yellow'],['0','green']]) {
  await h.input().props.onChange(loss);await h.flush()
  assert.match(total().props.className,new RegExp('bg-'+color+'-100'))
  const firstNet=h.all(n=>n.type==='td').find(n=>React.Children.toArray(n.props.children).some(c=>c?.props?.['data-row']===0 && c?.props?.['data-col']===8))
  assert.match(firstNet.props.className,new RegExp('bg-'+color+'-100'))
 }
 const unknown=openLog(true,'store',[{id:'unknown',time_slot:'08:00:00',split_index:0,basic:4,net_members:0}]);unknown.render();await unknown.flush()
 const cell=React.Children.toArray(unknown.find(n=>n.type==='tr' && n.props.className?.includes('border-t-2')).props.children)[10]
 assert.doesNotMatch(cell.props.className,/bg-(red|yellow|green)/)
 assert.equal(netMemberStyle(''),null)
 assert.equal(netMemberStyle(null),null)
})

for (const view of ['table', 'card']) {
 for (const formula of ['simple', 'detailed']) {
  test(`${view}/${formula}: empty hours stay neutral; recorded zero, negative and positive values keep colors`, async () => {
   const db = [
    {id:'loss',time_slot:'08:00:00',plans_lost_today:5,basic:0,reactivations:0},
    {id:'negative',time_slot:'09:00:00',employee_name:'Alex',basic:2,total_washes:20,member_washes:10},
    {id:'zero',time_slot:'10:00:00',employee_name:'Alex',basic:5,reactivations:0,total_washes:30,member_washes:10},
    {id:'positive',time_slot:'11:00:00',employee_name:'Alex',basic:6,reactivations:2},
    {id:'explicit-zero',time_slot:'12:00:00',basic:0,reactivations:0},
   ]
   const before=structuredClone(db)
   const h=openLog(false,'store',db,formula,view);h.render();await h.flush()
   const netAt=async hour => {
    if(view==='card') {
     h.find(n=>n.type==='select').props.onChange({target:{value:`${String(hour).padStart(2,'0')}:00:00`}})
     await h.flush()
     const input=h.find(n=>n.type==='input' && n.props.disabled && n.props.min===undefined)
     const card=h.find(n=>n.type==='div' && React.Children.toArray(n.props.children).some(c=>c?.type==='input' && c.props.min===undefined))
     return {value:input.props.value, color:card.props.className}
    }
    const input=h.find(n=>n.type==='input' && n.props['data-row']===hour-8 && n.props.min===undefined)
    const cell=h.find(n=>n.type==='td' && n.props.children?.type==='input' && n.props.children.props['data-row']===hour-8 && n.props.children.props.min===undefined)
    return {value:input.props.value,color:cell.props.className}
   }
   for(const hour of [8,13,20]) {
    const net=await netAt(hour);assert.equal(net.value,'');assert.doesNotMatch(net.color,/bg-(red|yellow|green)-100/)
   }
   for(const [hour,value,color] of [[9,-3,'red'],[10,0,'yellow'],[11,formula==='simple'?1:3,'green'],[12,-5,'red']]) {
    const net=await netAt(hour);assert.equal(net.value,value);assert.match(net.color,new RegExp(`bg-${color}-100`))
   }
   assert.deepEqual(db,before)
  })
 }
}

test('historical recorded negative and zero Net Members remain visible while empty hours stay blank', async () => {
 const h=openLog(false,'store',[
  {id:'old-negative',time_slot:'09:00:00',net_members:-4,net_members_legacy:true},
  {id:'old-zero',time_slot:'10:00:00',net_members:0,net_members_legacy:true},
 ])
 h.render();await h.flush()
 const nets=h.all(n=>n.type==='input' && n.props['data-row']!==undefined && n.props.min===undefined).map(n=>n.props.value)
 assert.deepEqual(nets.slice(0,4),['',-4,0,''])
})
