import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as compliance from '../src/utils/checklistCompliance.js'
const site = { id: 'a', site_code: '1001', name: 'Fictional North', market: 'North', timezone: 'America/New_York', local_today: '2026-11-11' }
const snapshot = () => ({ generated_at: '2026-11-11T15:00:00Z', locations: [site, { ...site, id: 'b', site_code: '1002', name: 'Fictional South', market: 'South' }], submissions: ['opening', 'midday', 'closing'].map(template_key => ({ location_id: 'a', template_key, period_date: '2026-11-11', status: 'submitted', is_pilot: false })) })
function fixture({ slow = false, fail = false, profile = { role: 'admin', is_active: true }, user = { id: 'one' } } = {}) {
  let auth = { user, profile, locations: [site] }
  const calls = [], exports = [], pending = []
  const h = locationHelpHarness('pages/ChecklistCompliance', {
    ...compliance, useAuth: () => auth, Link: () => null, NavBar: () => null, supabase: {}, localChecklistDate: () => '2026-11-11',
    fetchChecklistCompliance: async (_client, range) => { calls.push(range); if (slow) return new Promise((resolve, reject) => pending.push({ resolve, reject })); if (fail) throw new Error('Report unavailable'); return snapshot() },
    downloadComplianceCsv: (...args) => exports.push(args),
  })
  return { ...h, calls, exports, pending, auth: value => { auth = value; h.render() } }
}
const button = (h, text) => h.find(node => node.type === 'button' && node.props.children === text)
const change = (h, label, value) => h.find(node => node.props?.['aria-label'] === label).props.onChange({ target: { value } })
const bodyRows = h => h.all(node => node.type === 'tr').slice(1)

test('report renders all sites including missing, binary scores, summary and filtered export', async () => {
  const h = fixture(); await h.flush()
  assert.equal(h.calls.length, 1); assert.equal(bodyRows(h).length, 2)
  assert.ok(h.find(node => node.type === 'td' && node.props.children === '100%'))
  assert.ok(h.find(node => node.type === 'td' && node.props.children === '0%'))
  assert.ok(h.find(node => node.type === 'p' && node.props.children === '50%'))
  change(h, 'Completion status', 'missing'); h.render()
  assert.equal(bodyRows(h).length, 1)
  button(h, 'Export visible rows (CSV)').props.onClick()
  assert.equal(h.exports[0][0][0].site.id, 'b')
  assert.equal(h.exports[0][0].length, 1)
  assert.ok(h.find(node => node.type === 'p' && node.props.children === '50%')) // status filter does not inflate summary.
  h.unmount()
})

test('market/location filters and weekly control work without raw data access', async () => {
  const h = fixture(); await h.flush()
  change(h, 'Market', 'North'); h.render(); assert.equal(bodyRows(h).length, 1)
  change(h, 'Market', ''); change(h, 'Location', 'b'); h.render(); assert.equal(bodyRows(h).length, 1)
  button(h, 'Weekly').props.onClick(); await h.flush()
  assert.deepEqual(h.calls.at(-1), { start: '2026-11-09', end: '2026-11-15' })
  assert.equal(h.find(node => node.props?.['aria-label'] === 'Start date'), undefined)
  assert.ok(h.find(node => node.props?.['aria-label'] === 'Week containing'))
  h.unmount()
})

test('loading, repeated refresh and date changes clear scores/export until the latest response', async () => {
  const h = fixture({ slow: true }); await h.flush()
  assert.equal(bodyRows(h).length, 0)
  assert.equal(button(h, 'Export visible rows (CSV)').props.disabled, true)
  assert.equal(button(h, 'Loading…').props.disabled, true)
  change(h, 'End date', '2026-11-12'); await h.flush()
  assert.equal(h.pending.length, 2)
  h.pending[1].resolve(snapshot()); await h.flush(); assert.equal(bodyRows(h).length, 4)
  h.pending[0].resolve({ ...snapshot(), locations: [] }); await h.flush(); assert.equal(bodyRows(h).length, 4)
  button(h, 'Refresh').props.onClick(); h.render()
  assert.equal(bodyRows(h).length, 0)
  assert.equal(button(h, 'Export visible rows (CSV)').props.disabled, true)
  h.unmount(); h.pending[2].resolve(snapshot()); await h.flush()
})

test('failed load shows blocker and retry, never missing zeros or export', async () => {
  const h = fixture({ fail: true }); await h.flush()
  assert.equal(h.find(node => node.props?.role === 'alert').props.children, 'Report unavailable')
  assert.equal(bodyRows(h).length, 0)
  assert.equal(button(h, 'Export visible rows (CSV)').props.disabled, true)
  button(h, 'Refresh').props.onClick(); await h.flush(); assert.equal(h.calls.length, 2)
  h.unmount()
})

test('invalid range blocks fetch and removes old scores', async () => {
  const h = fixture(); await h.flush()
  change(h, 'Start date', '2027-01-01'); h.render()
  assert.ok(h.find(node => node.props?.role === 'alert'))
  assert.equal(bodyRows(h).length, 0); assert.equal(h.calls.length, 1)
  assert.equal(button(h, 'Export visible rows (CSV)').props.disabled, true)
  h.unmount()
})

test('inactive, deleted, unsupported and signed-out accounts make no reporting call', async () => {
  for (const profile of [null, { role: 'admin', is_active: false }, { role: 'admin', is_active: true, deleted_at: '2026-01-01' }, { role: 'unknown', is_active: true }]) {
    const h = fixture({ profile }); await h.flush()
    assert.equal(h.calls.length, 0); assert.ok(h.find(node => node.props?.role === 'alert')); h.unmount()
  }
  const h = fixture({ user: null }); await h.flush(); assert.equal(h.calls.length, 0); h.unmount()
})

test('account changes clear prior data immediately and ignore an earlier successful read', async () => {
  const h = fixture({ slow: true }); await h.flush()
  h.auth({ user: { id: 'two' }, profile: { role: 'store', is_active: true, location_id: 'b' }, locations: [{ ...site, id: 'b' }] })
  assert.equal(bodyRows(h).length, 0)
  h.pending[0].resolve(snapshot()); await h.flush(); assert.equal(bodyRows(h).length, 0)
  h.pending[1].resolve({ ...snapshot(), locations: [{ ...site, id: 'b' }], submissions: [] }); await h.flush()
  assert.equal(bodyRows(h).length, 1)
  h.auth({ user: null, profile: null, locations: [] }); assert.equal(bodyRows(h).length, 0)
  assert.equal(button(h, 'Export visible rows (CSV)'), undefined); h.unmount()
})

test('a removed location filter resets instead of silently hiding refreshed available sites', async () => {
  const h = fixture({ slow: true }); await h.flush()
  h.pending[0].resolve(snapshot()); await h.flush()
  change(h, 'Location', 'a'); h.render(); assert.equal(bodyRows(h).length, 1)
  button(h, 'Refresh').props.onClick(); await h.flush()
  h.pending[1].resolve({ ...snapshot(), locations: [{ ...site, id: 'b' }], submissions: [] }); await h.flush()
  assert.equal(h.find(node => node.props?.['aria-label'] === 'Location').props.value, '')
  assert.equal(bodyRows(h).length, 1); h.unmount()
})
