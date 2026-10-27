import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEmployeePerformance } from '../src/utils/employeePerformance.js'
import { mappedEmployeeLogs } from '../src/utils/employeeMappingAttribution.js'
import { historicalUsage, rosterHistoricalUsage, readMappings, loadMappingHistory, changeMapping } from '../src/utils/historicalEmployeeMappings.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
const range = { start: '2026-01-01', end: '2026-12-31' }
const sites = [{ id: 'a', name: 'A', opportunities_formula: 'detailed' }, { id: 'b', name: 'B', opportunities_formula: 'simple' }]
function row(id, name, count, extra = {}) {
  return { id, employee_name: name, employee_id: null, location_id: 'a', log_date: '2026-01-01', time_slot: '08:00:00', split_index: 0,
    total_washes: count * 10, member_washes: count * 5, basic: count, good: 0, better: 0, best: 0, google_reviews: 0, ...extra }
}
const mapping = (original_name, employee_id = 'one', extra = {}) => ({ id: original_name, location_id: 'a', original_name, employee_id, employee_name: 'Official Employee', status: 'approved', start_date: null, end_date: null, ...extra })
const data = [row('1', 'Cam', 2), row('2', 'Camby', 5, { time_slot: '09:00:00' }), row('3', 'CAM', 6, { time_slot: '09:00:00', split_index: 1 })]

test('no mappings and unapproved proposals retain the complete existing report result', () => {
  const baseline = buildEmployeePerformance(data, sites, range)
  assert.deepEqual(buildEmployeePerformance(data, sites, range, []), baseline)
  assert.deepEqual(buildEmployeePerformance(data, sites, range, [mapping('Cam', 'one', { status: 'proposed' }), mapping('Camby', 'one', { status: 'rejected' })]), baseline)
})
test('explicit aliases combine split-shift deltas once, preserving every source field', () => {
  const original = structuredClone(data)
  const result = buildEmployeePerformance(data, sites, range, [mapping('Cam'), mapping('Camby'), mapping('CAM')])
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].ms, 6) // 2 + (5-2) + (6-5), never 2+5+6
  assert.equal(result.rows[0].total_washes, 60)
  assert.equal(result.rows[0].name, 'Official Employee')
  assert.deepEqual(data, original)
})
test('same exact alias can resolve to different people on disjoint inclusive dates', () => {
  const logs = [row('1', 'Cam', 2), row('2', 'Cam', 3, { log_date: '2026-01-02' }), row('3', 'Cam', 4, { log_date: '2026-01-03' })]
  const result = buildEmployeePerformance(logs, sites, range, [mapping('Cam', 'one', { end_date: '2026-01-01' }), mapping('Cam', 'two', { employee_name: 'Other Employee', start_date: '2026-01-02', end_date: '2026-01-02' })])
  assert.deepEqual(result.rows.map(r => [r.name, r.ms]), [['Official Employee', 2], ['Other Employee', 3], ['Cam', 4]])
})
test('same-day overlap fails closed even when both mappings target the same employee', () => {
  assert.throws(() => buildEmployeePerformance(data, sites, range, [mapping('Cam'), mapping('Cam', 'one', { status: 'locked' })]), /Overlapping/)
})
test('approved mapping never matches another location or an unapproved spelling automatically', () => {
  const logs = [row('1', 'Cam', 2), row('2', 'cam', 3, { log_date: '2026-01-02' }), row('3', 'Cam', 4, { location_id: 'b' })]
  const result = buildEmployeePerformance(logs, sites, range, [mapping('Cam')])
  assert.equal(result.rows.length, 3)
  assert.equal(result.rows.reduce((n, r) => n + r.ms, 0), 9)
  assert.equal(result.rows.find(r => r.locationId === 'b').name, 'Cam')
})
test('mapped and unapproved same-display-name identities cannot accidentally combine', () => {
  const logs = [row('1', 'Alias', 2), row('2', 'Official Employee', 3, { log_date: '2026-01-02' })]
  const result = buildEmployeePerformance(logs, sites, range, [mapping('Alias')])
  assert.equal(result.rows.length, 2)
  assert.notEqual(result.rows[0].key, result.rows[1].key)
})
test('identical duplicate source IDs still count once after mapping', () => {
  const result = buildEmployeePerformance([data[0], { ...data[0] }], sites, range, [mapping('Cam')])
  assert.equal(result.rows[0].ms, 2)
})
test('mapping preserves uncertainty rather than inventing historical corrected sales', () => {
  const logs = [row('1', 'Cam', 5), row('2', 'Camby', 2, { time_slot: '09:00:00' })]
  assert.equal(buildEmployeePerformance(logs, sites, range, [mapping('Cam'), mapping('Camby')]).rows[0].ms, null)
})
test('blank names remain unassigned; mapped target must be visible', () => {
  const logs = [row('1', null, 2), row('2', 'Alias', 3, { time_slot: '09:00:00' })]
  assert.equal(buildEmployeePerformance(logs, sites, range, [mapping('Alias')]).rows[0].ms, 1)
  assert.throws(() => mappedEmployeeLogs(logs, [mapping('Alias', 'one', { employee_name: null })]), /unavailable/)
})
test('historical inventory retains exact spelling, counts appearances and reports delta sales', () => {
  const usage = historicalUsage(data, 'a').aliases
  assert.equal(usage.length, 3)
  assert.equal(usage.find(r => r.original_name === 'Cam').memberships, 2)
  assert.equal(usage.find(r => r.original_name === 'Camby').memberships, 3)
  assert.equal(usage.find(r => r.original_name === 'CAM').memberships, 1)
})
test('roster usage separates original ID-linked activity from shared name-only duplicates', () => {
  const logs = [row('1', 'Cam', 2, { employee_id: 'one' }), row('2', 'CAM', 5, { time_slot: '09:00:00' }), row('3', 'Cam', 7, { time_slot: '10:00:00', employee_id: 'two' })]
  assert.deepEqual(rosterHistoricalUsage(logs, { id: 'one', name: 'Cam', location_id: 'a' }), { appearances: 1, memberships: 2, last_date: '2026-01-01', shared_name_appearances: 1, shared_name_memberships: 3 })
  assert.equal(rosterHistoricalUsage(logs, { id: 'two', name: 'Cam', location_id: 'a' }).memberships, 2)
})
test('mapping proposal validates confirmation/evidence and passes exact alias and version', async () => {
  const calls = [], client = { rpc: async (...args) => { calls.push(args); return { data: {} } } }
  const args = { action: 'propose', locationId: 'a', originalName: ' Cam ', employeeId: 'one', endDate: '2026-01-01', note: 'Known identity', confirmed: true }
  await changeMapping(client, args)
  assert.equal(calls[0][1].recorded_name, ' Cam ')
  assert.equal(calls[0][1].through_date, '2026-01-01')
  await assert.rejects(changeMapping(client, { ...args, confirmed: false }), /Confirm/)
  await assert.rejects(changeMapping(client, { ...args, note: ' ' }), /reason/)
  await assert.rejects(changeMapping(client, { ...args, startDate: '2026-02-01' }), /start date/)
  await changeMapping(client, { ...args, action: 'correct', mapping: { id: 'm', version: 9 } })
  assert.equal(calls[1][1].expected_version, 9)
})
test('revoked assignment prevents any historical table reads', async () => {
  await assert.rejects(loadMappingHistory({ rpc: async () => ({ data: false }), from() { throw new Error('Should never read') } }, 'other'), /not assigned/)
})
function paged(pages) {
  let i = 0
  const calls = []
  const query = { select(...args) { calls.push(['select', ...args]); return this }, in(...args) { calls.push(['in', ...args]); return this }, order() { return this }, range: async () => pages[i++] }
  return { client: { from: () => query }, calls }
}
test('proposal reads paginate below server cap and never hide read failures', async () => {
  const { client, calls } = paged([{ data: [{ id: '1', employees: { name: 'One' } }], count: 2 }, { data: [{ id: '2', employees: { name: 'Two' } }], count: 2 }])
  assert.equal((await readMappings(client, ['a'])).length, 2)
  assert.ok(calls.some(row => row[1] === 'location_id'))
  await assert.rejects(readMappings(paged([{ data: [], count: 2 }]).client, ['a']), /Incomplete/)
  await assert.rejects(readMappings(paged([{ error: new Error('offline') }]).client, ['a']), /offline/)
})

const textOf = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : ''
function ui(isAdmin = false, extra = {}) {
  const actions = []
  const globals = { supabase: {}, loadMappingHistory: async () => ({ logs: data, mappings: [mapping('Cam', 'one', { id: 'm', version: 1, status: 'proposed' })] }),
    loadRoster: async () => [{ id: 'one', name: 'Official Employee', is_active: true }], historicalUsage,
    changeMapping: async (...args) => actions.push(args), readMappingAudit: async () => [], ...extra }
  const h = locationHelpHarness('components/HistoricalEmployeeMappings', globals, { locationId: 'a', isAdmin })
  h.render(); return { h, actions }
}
test('Store sees historical counts and proposal controls but no Admin decisions', async () => {
  const { h } = ui(); await h.flush()
  const buttons = h.all(n => n.type === 'button').map(textOf)
  assert.ok(buttons.includes('Propose date-scoped mapping'))
  for (const adminAction of ['Approve', 'Reject', 'Lock', 'Correct']) assert.ok(!buttons.includes(adminAction))
  assert.match(textOf(h.render()), /Membership sales/)
})
test('proposal uses no automatic target, defaults through last activity, and cancel never writes', async () => {
  const { h, actions } = ui(); await h.flush()
  h.find(n => n.type === 'button' && textOf(n) === 'Propose date-scoped mapping').props.onClick()
  assert.equal(h.find(n => n.type === 'select').props.value, '')
  assert.equal(h.all(n => n.type === 'input' && n.props.type === 'date')[1].props.value, '2026-01-01')
  assert.equal(h.find(n => n.type === 'button' && textOf(n) === 'Confirm propose').props.disabled, true)
  h.find(n => n.type === 'button' && textOf(n) === 'Cancel').props.onClick()
  assert.equal(actions.length, 0)
})
test('Admin approval requires evidence and identity acknowledgement before RPC', async () => {
  const { h, actions } = ui(true); await h.flush()
  h.find(n => n.type === 'button' && textOf(n) === 'Approve').props.onClick()
  assert.equal(h.find(n => n.type === 'button' && textOf(n) === 'Confirm approve').props.disabled, true)
  h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Confirmed with manager' } })
  h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  assert.equal(h.find(n => n.type === 'button' && textOf(n) === 'Confirm approve').props.disabled, false)
  await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(actions[0][1].action, 'approve')
  assert.equal(actions[0][1].mapping.version, 1)
})
test('unmounted historical read cannot restore another location', async () => {
  let resolve
  const { h } = ui(false, { loadMappingHistory: () => new Promise(r => { resolve = r }) })
  h.unmount(); resolve({ logs: data, mappings: [] }); await h.flush()
  assert.equal(h.all(n => n.type === 'tbody').length, 0)
})

test('mapping cannot conceal conflicting original-name copies of the same checkpoint ID', () => {
  const logs = [row('same', 'Cam', 2), row('same', 'Camby', 2)]
  const result = buildEmployeePerformance(logs, sites, range, [mapping('Cam'), mapping('Camby')])
  assert.equal(result.rows[0].ms, null)
  assert.match(result.attributionNotes[0].issues.join(' '), /conflicting/)
})

test('company reports use complete approved-only RPC and reject unexpected scopes or states', async () => {
  const approved = [mapping('Cam')]
  let sent
  const client = { rpc: async (name, args) => { sent = { name, args }; return { data: approved } } }
  assert.deepEqual(await readMappings(client, ['a'], true), approved)
  assert.equal(sent.name, 'approved_employee_name_mappings')
  assert.deepEqual(sent.args.location_ids, ['a'])
  await assert.rejects(readMappings({ rpc: async () => ({ data: [mapping('Cam', 'one', { location_id: 'b' })] }) }, ['a'], true), /verified/)
  await assert.rejects(readMappings({ rpc: async () => ({ data: [mapping('Cam', 'one', { status: 'proposed' })] }) }, ['a'], true), /verified/)
})
