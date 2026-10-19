import test from 'node:test'
import assert from 'node:assert/strict'
import { ownershipHarness, ownershipApi } from './helpers/ownershipHarness.js'
import { ownershipBusinessDate } from '../src/utils/ownershipBusinessDate.js'

const a = { id: 'a', name: 'A', timezone: 'America/New_York' }
const b = { id: 'b', name: 'B', timezone: 'America/Los_Angeles' }
const savedGoals = id => ({ location_id: id, goal_1: `${id} conversion`, goal_2: `${id} members`, goal_3: `${id} service`, updated_at: 'original' })
const Goals = () => null
const goalNode = h => h.find(node => node.type === Goals)
const textareas = h => h.all(node => node.type === 'textarea')
const click = (h, label) => h.find(node => node.type === 'button' && node.props.children === label).props.onClick()
function section(api, locations = [a], date = '2026-10-19T16:00:00Z') {
  let instant = date, tick
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])) } }
  const h = ownershipHarness('OwnershipLogSection', { locations }, {
    supabase: api.client, OwnershipWashGoals: Goals, ownershipBusinessDate,
    ownershipLogStatus: () => 'none', STATUS_LABEL: {}, TmLoader: () => null,
    Date: Clock, setInterval: fn => { tick = fn; return 1 }, clearInterval() {},
  })
  h.render()
  h.tick = date => { instant = date; tick(); h.render() }
  return h
}
function goalsHarness(api, locationId) {
  return ownershipHarness('OwnershipWashGoals', { locationId }, { supabase: api.client })
}

test('new site-local business day clears every daily field while retaining the same goals component', async () => {
  const api = ownershipApi({ posts: [{ id: 'old', location_id: 'a', log_date: '2026-10-19', yesterday_conversion_pct: 10, biggest_challenge: 'challenge', what_you_did: 'action', plan_for_today: 'plan', goal_action_today: 'daily action' }] })
  const h = section(api, [a], '2026-10-20T03:59:00Z'); await h.flush()
  assert.deepEqual(textareas(h).map(n => n.props.value), ['challenge', 'action', 'plan', 'daily action'])
  const key = goalNode(h).key
  h.tick('2026-10-20T04:00:00Z'); await h.flush()
  assert.deepEqual(textareas(h).map(n => n.props.value), ['', '', '', ''])
  assert.equal(h.find(n => n.type?.name === 'PercentInput').props.value, '')
  assert.equal(goalNode(h).key, key)
  assert.equal(goalNode(h).props.locationId, 'a')
  assert.equal(api.writes.length, 0)
  h.unmount()
})

test('Dashboard site prop switching follows the new location and rejects a late prior-site response', async () => {
  const api = ownershipApi(); api.client.defer = true
  const h = section(api)
  h.props({ locations: [b] })
  assert.equal(goalNode(h).props.locationId, 'b')
  api.deferred[1].resolve({ data: [] }); await h.flush()
  api.deferred[0].resolve({ data: [{ id: 'late', location_id: 'a', log_date: '2026-10-19', biggest_challenge: 'Wrong site' }] }); await h.flush()
  assert.equal(textareas(h)[0].props.value, '')
  await click(h, 'Submit Post')
  assert.equal(api.writes[0].payload.location_id, 'b')
  assert.equal(api.writes[0].payload.biggest_challenge, null)
  h.unmount()
})

test('goals load without any daily posts, survive remount on another day and stay isolated by site', async () => {
  const api = ownershipApi({ goals: { a: savedGoals('a'), b: savedGoals('b') } })
  for (const id of ['a', 'b', 'a']) {
    const h = goalsHarness(api, id); h.render(); await h.flush()
    assert.deepEqual(textareas(h).map(n => n.props.value), [1, 2, 3].map(i => savedGoals(id)[`goal_${i}`]))
    assert.ok(textareas(h).every(n => n.props.readOnly))
    h.unmount()
  }
  assert.ok(api.reads.every(r => r.table === 'ownership_wash_goals' && r.filters.length === 1))
  assert.equal(api.writes.length, 0)
})

test('explicit Edit goals and Save persist all three goals without submitting a daily post', async () => {
  const api = ownershipApi()
  const h = goalsHarness(api, 'a'); h.render(); await h.flush()
  click(h, 'Edit goals')
  textareas(h).forEach((n, i) => n.props.onChange({ target: { value: `Goal ${i + 1}` } }))
  await click(h, 'Save goals'); await h.flush()
  assert.equal(api.writes.length, 1)
  assert.equal(api.writes[0].table, 'ownership_wash_goals')
  assert.ok(!('log_date' in api.writes[0].payload))
  assert.ok(textareas(h).every(n => n.props.readOnly))
  h.unmount()
  const reopened = goalsHarness(api, 'a'); reopened.render(); await reopened.flush()
  assert.deepEqual(textareas(reopened).map(n => n.props.value), ['Goal 1', 'Goal 2', 'Goal 3'])
})

test('submitting and editing daily posts never write goals or historical comments', async () => {
  const api = ownershipApi({ goals: { a: savedGoals('a') }, posts: [{ id: 'past', location_id: 'a', log_date: '2026-10-18', biggest_challenge: 'historical', comments: 'Legacy goals remain verbatim' }] })
  const before = structuredClone(api.goals)
  const h = section(api); await h.flush()
  await click(h, 'Submit Post'); await h.flush()
  click(h, 'Edit'); await h.flush()
  textareas(h)[0].props.onChange({ target: { value: 'Corrected' } })
  await click(h, 'Update Post'); await h.flush()
  assert.deepEqual(api.writes.map(w => w.payload.log_date), ['2026-10-19', '2026-10-18'])
  assert.ok(api.writes.every(w => w.table === 'ownership_log_entries' && !('comments' in w.payload) && !('goal_1' in w.payload)))
  assert.deepEqual(api.goals, before)
  h.unmount()
})

test('Admin backfill keeps goals mounted while loading a date and ignores late responses', async () => {
  const api = ownershipApi({ goals: { a: savedGoals('a') } }); api.client.defer = true
  const h = ownershipHarness('OwnershipLogReport', { location: a, onClose() {}, onSaved() {} }, {
    supabase: api.client, OwnershipWashGoals: Goals, PercentInput: () => null, TmLoader: () => null,
  }, 'EditModal')
  h.render()
  const originalKey = goalNode(h).key
  h.find(n => n.type === 'input' && n.props.type === 'date').props.onChange({ target: { value: '2026-09-01' } })
  h.render()
  assert.equal(goalNode(h).key, originalKey)
  api.deferred[1].resolve({ data: null }); await h.flush()
  api.deferred[0].resolve({ data: { id: 'stale', biggest_challenge: 'Wrong date' } }); await h.flush()
  assert.equal(textareas(h)[0].props.value, '')
  await click(h, 'Submit Post')
  assert.equal(api.writes[0].payload.log_date, '2026-09-01')
  assert.equal(api.writes[0].table, 'ownership_log_entries')
  assert.deepEqual(api.goals.a, savedGoals('a'))
  h.unmount()
})

test('site calendar dates handle different zones and year boundaries', () => {
  const instant = new Date('2027-01-01T05:01:00Z')
  assert.equal(ownershipBusinessDate(a.timezone, instant), '2027-01-01')
  assert.equal(ownershipBusinessDate(b.timezone, instant), '2026-12-31')
})

test('goals ignore a late load from a previous site', async () => {
  const api = ownershipApi(); api.client.defer = true
  const h = goalsHarness(api, 'a'); h.render()
  h.props({ locationId: 'b' })
  api.deferred[1].resolve({ data: savedGoals('b') }); await h.flush()
  api.deferred[0].resolve({ data: savedGoals('a') }); await h.flush()
  assert.equal(textareas(h)[0].props.value, 'b conversion')
  h.unmount()
})

test('Store supplied location remains the only choice; Admin supplied locations remain selectable', async () => {
  const api = ownershipApi()
  const store = section(api, [a]); await store.flush()
  assert.deepEqual(store.all(n => n.type === 'option').map(n => n.props.value), ['a'])
  store.props({ locations: [a], profile: { role: 'store', location_id: 'unavailable' } })
  assert.equal(goalNode(store).props.locationId, 'a')
  const admin = section(api, [a, b]); await admin.flush()
  admin.find(n => n.type === 'select').props.onChange({ target: { value: 'b' } }); await admin.flush()
  assert.equal(goalNode(admin).props.locationId, 'b')
  store.unmount(); admin.unmount()
})
