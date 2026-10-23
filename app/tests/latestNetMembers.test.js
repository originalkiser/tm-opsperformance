import test from 'node:test'
import assert from 'node:assert/strict'
import { latestDailyNetMembers, selectMtdNetMembers, loadMembershipSnapshots } from '../src/utils/dashboardNetMembers.js'
import { selectTodayPerformance } from '../src/utils/dashboardPerformance.js'
const now = new Date('2026-10-23T16:00:00Z')
const site = { id: 'a', timezone: 'America/New_York', show_budget_tracking: true }
const range = { start: '2026-10-01', end: '2026-10-23' }
const day = (date, basic = 5, lost = 5, extra = {}) => [
  { location_id: 'a', log_date: date, time_slot: '08:00:00', plans_lost_today: lost },
  { location_id: 'a', log_date: date, time_slot: '12:00:00', basic, reactivations: 2, ...extra },
]
const snapshot = (date = '2026-10-20', extra = {}) => ({ location_id: 'a', starting_members: 100, active_members: 100, covered_through: date, ...extra })

test('daily fallback skips missing/invalid days, retains zero, excludes later dates, and never sums days', () => {
  for (const formula of ['simple', 'detailed']) {
    const loc = { ...site, opportunities_formula: formula }
    const logs = [...day('2026-10-19', 8), ...day('2026-10-21', 5, 5, { reactivations: 0 }), ...day('2026-10-22', 99, null), ...day('2026-10-24', 99)]
    const before = structuredClone(logs)
    const value = latestDailyNetMembers(logs, loc, '2026-10-23', now)
    assert.equal(value.value, 0); assert.equal(value.through, '2026-10-21')
    assert.equal(latestDailyNetMembers(logs, loc, '2026-10-20', now).through, '2026-10-19')
    assert.equal(latestDailyNetMembers(logs, loc, '2026-10-18', now).value, null)
    assert.equal(latestDailyNetMembers(logs, loc, '2026-10-30', now).through, '2026-10-21')
    assert.deepEqual(logs, before)
    const today = selectTodayPerformance(logs, [loc], now)
    assert.equal(today.netMembers.a.value, 0); assert.equal(today.totals.length, 0, 'stale net must not carry other daily metrics')
  }
})

test('daily may reference the previous month, while MTD never carries that value forward', () => {
  const logs = day('2026-09-30', 10)
  assert.equal(latestDailyNetMembers(logs, site, range.end, now).through, '2026-09-30')
  const value = selectMtdNetMembers(logs, [snapshot('2026-09-30')], [site], range, now).a
  assert.equal(value.value, null); assert.equal(value.through, null)
})

test('MTD retains snapshot plus consecutive daily totals up to first gap, for both formulas', () => {
  for (const formula of ['simple', 'detailed']) {
    const loc = { ...site, opportunities_formula: formula }
    const logs = [...day('2026-10-20', 999), ...day('2026-10-21'), ...day('2026-10-23', 999)]
    const result = selectMtdNetMembers(logs, [snapshot()], [loc], range, now).a
    assert.equal(result.value, formula === 'simple' ? 0 : 2)
    assert.equal(result.through, '2026-10-21')
    assert.equal(result.snapshotThrough, '2026-10-20')
    const stale = selectMtdNetMembers([], [snapshot()], [loc], range, now).a
    assert.equal(stale.value, 0); assert.equal(stale.through, '2026-10-20')
  }
})

test('without a snapshot MTD requires continuous logs from month start, including signed/zero results', () => {
  for (const formula of ['simple', 'detailed']) {
    const loc = { ...site, opportunities_formula: formula }
    const logs = [...day('2026-10-01', 3), ...day('2026-10-02', 5), ...day('2026-10-04', 999)]
    const result = selectMtdNetMembers(logs, [], [loc], range, now).a
    assert.equal(result.value, formula === 'simple' ? -2 : 2)
    assert.equal(result.through, '2026-10-02')
    assert.equal(selectMtdNetMembers(logs.filter(r => r.log_date !== '2026-10-01'), [], [loc], range, now).a.value, null)
    assert.equal(selectMtdNetMembers(logs, [], [loc], {start:'2026-10-02',end:range.end}, now).a.value, null)
  }
})

test('historical MTD ignores future snapshots/days and uses latest valid eligible snapshot', () => {
  const values = selectMtdNetMembers([...day('2026-10-20'), ...day('2026-10-21', 999)], [snapshot('2026-10-21', {active_members:999}), snapshot('2026-10-20', {active_members:null}), snapshot('2026-10-19')], [site], { start:range.start, end:'2026-10-20' }, now)
  assert.equal(values.a.through, '2026-10-20'); assert.equal(values.a.value, 2)
})

test('snapshot loader searches older cutoffs when newest headcount is missing and stops at valid zero', async () => {
  const calls = []
  const client = { async rpc(name, args) {
    calls.push(args)
    return { data: [args.p_through_date >= '2026-10-21' ? snapshot('2026-10-21', {active_members:null}) : snapshot()] }
  } }
  assert.deepEqual(await loadMembershipSnapshots(client, [site], range), [snapshot()])
  assert.deepEqual(calls.map(c => c.p_through_date), ['2026-10-22','2026-10-21','2026-10-20'])
  const historical = []
  await loadMembershipSnapshots({async rpc(name,args){historical.push(args);return {data:[snapshot()]}}}, [site], {start:range.start,end:'2026-10-20'}, '2026-10-21')
  assert.equal(historical[0].p_through_date,'2026-10-20', 'a snapshot entered on selected morning may cover yesterday')
  let requests=0
  assert.deepEqual(await loadMembershipSnapshots({async rpc(){requests++;return {data:[]}}},[site],{start:'2026-10-01',end:'2026-10-03'}),[])
  assert.equal(requests,2,'search is bounded by month start')
})

test('daily history pagination completes a split day before choosing its cumulative balance', async () => {
  const { loadDailyNetHistory } = await import('../src/utils/dashboardPerformance.js')
  const calls=[]
  const first=Array.from({length:1000},(_,i)=>({...day('2026-10-21')[i===0?0:1],time_slot:i===0?'08:00:00':'10:00:00',basic:i===0?0:3}))
  const last={...day('2026-10-21',9)[1],time_slot:'20:00:00'}
  const client={from(){const q={select(){return q},in(){return q},lte(k,date){assert.equal(date,range.end);return q},order(){return q},async range(start){calls.push(start);return {data:start===0?first:[last,...day('2026-10-20',999)]}}};return q}}
  const rows=await loadDailyNetHistory(client,[{...site,opportunities_formula:'simple'}],range.end,now)
  assert.deepEqual(calls,[0,1000])
  assert.equal(latestDailyNetMembers(rows,{...site,opportunities_formula:'simple'},range.end,now).value,4)
  assert.ok(rows.every(r=>r.log_date==='2026-10-21'))
})
