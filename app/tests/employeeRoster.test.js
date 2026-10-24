import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRoster, validateDuplicateReview, addRosterEmployee, updateRosterEmployee, reviewRosterDuplicates, rosterError, loadRoster } from '../src/utils/employeeRoster.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
const rows = [{ id: 'a', name: 'Cam', location_id: 'site', is_active: true }, { id: 'b', name: ' CAM ', location_id: 'site', is_active: false }, { id: 'c', name: 'Other', location_id: 'site', is_active: null }]
test('filters include legacy unknown status in Inactive and never lose original names', () => {
  assert.deepEqual(filterRoster(rows, 'active').map(r => r.id), ['a'])
  assert.deepEqual(filterRoster(rows, 'inactive').map(r => r.id), ['b', 'c'])
  assert.deepEqual(filterRoster(rows, 'all'), rows)
})
test('duplicate review requires multiple same-site records and a selected primary; confirmation is separate', async () => {
  assert.equal(validateDuplicateReview(rows, ['a', 'b'], 'a').length, 2)
  for (const [ids, primary] of [[['a'], 'a'], [['a', 'missing'], 'a'], [['a', 'b'], 'c']]) assert.throws(() => validateDuplicateReview(rows, ids, primary))
  assert.throws(() => validateDuplicateReview([rows[0], { ...rows[1], location_id: 'other' }], ['a', 'b'], 'a'))
  await assert.rejects(reviewRosterDuplicates({}, rows, ['a', 'b'], 'a', false), /same actual person/)
})
test('review submits exact reviewed names/status and requires full atomic count', async () => {
  let sent
  const client = { async rpc(name, args) { sent = { name, args }; return { data: 2 } } }
  await reviewRosterDuplicates(client, rows, ['a', 'b'], 'a', true)
  assert.equal(sent.name, 'review_employee_duplicates')
  assert.deepEqual(sent.args.reviewed_rows, rows.slice(0, 2).map(({ id, name, is_active }) => ({ id, name, is_active })))
  await assert.rejects(reviewRosterDuplicates({ rpc: async () => ({ data: 1 }) }, rows, ['a', 'b'], 'a', true), /do not retry blindly/)
})
test('Add uses actual insertable fields; update restricts fields and checks original row snapshot', async () => {
  const calls = []
  const chain = { insert(v) { calls.push(['insert', v]); return this }, update(v) { calls.push(['update', v]); return this }, eq(k, v) { calls.push([k, v]); return this }, is(k, v) { calls.push([k, v]); return this }, select() { return this }, single: async () => ({ data: rows[0] }) }
  const client = { from: () => chain }
  await addRosterEmployee(client, 'site', '  New  ')
  assert.deepEqual(calls[0], ['insert', { location_id: 'site', name: 'New', is_active: true }])
  calls.length = 0
  await updateRosterEmployee(client, rows[0], { name: 'Renamed', employee_id: 'ignored', id: 'ignored', location_id: 'ignored' })
  assert.deepEqual(calls[0], ['update', { name: 'Renamed' }]); assert.ok(calls.some(c => c[0] === 'location_id' && c[1] === 'site'))
  assert.ok(calls.some(c => c[0] === 'name' && c[1] === 'Cam'))
  await assert.rejects(addRosterEmployee(client, 'site', ' '), /name/)
})
test('revoked roster access never starts broad table reads; server duplicate errors remain visible', async () => {
  await assert.rejects(loadRoster({ rpc: async () => ({ data: false }), from() { throw new Error('unexpected read') } }, 'site'), /permission/)
  assert.match(rosterError({ code: '23505' }), /inactive/)
  assert.match(rosterError({ code: 'PGRST116' }), /changed/)
})
function harness(extra = {}, isAdmin = true) {
  const actions = []
  const h = locationHelpHarness('pages/Employees', {
    supabase: {}, filterRoster, validateDuplicateReview, rosterError,
    loadRoster: async () => rows,
    addRosterEmployee: async (...args) => actions.push(['add', ...args]),
    updateRosterEmployee: async (...args) => actions.push(['update', ...args]),
    reviewRosterDuplicates: async (...args) => actions.push(['review', ...args]),
    window: { confirm: () => false }, ...extra,
  }, { locationId: 'site', isAdmin }, 'Roster')
  h.render(); return { h, actions }
}
const button = text => n => n.type === 'button' && n.props.children === text
const textOf = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join(' ') : node?.props ? textOf(node.props.children) : ''
test('roster initializes from existing rows, filters statuses and hides Admin selection for managers', async () => {
  const { h } = harness({}, false); await h.flush()
  assert.equal(h.all(n => n.type === 'li').length, 1)
  const filter = h.find(n => n.type === 'select'); filter.props.onChange({ target: { value: 'all' } })
  assert.equal(h.all(n => n.type === 'li').length, 3)
  assert.equal(h.all(n => n.type === 'input' && n.props.type === 'checkbox').length, 0)
})
test('rename cancellation never writes; accepted confirmation explains retained historical sales', async () => {
  let confirmation = ''
  const { h, actions } = harness({ window: { confirm: text => { confirmation = text; return false } } }); await h.flush()
  h.find(button('Edit Name')).props.onClick(); h.render()
  const form = h.find(n => n.type === 'form' && n.props['aria-label'] === 'Edit employee name')
  form.props.onSubmit({ preventDefault() {} }); assert.equal(actions.length, 0)
  assert.match(confirmation, /Historical sales retain their originally recorded names/)
  h.find(button('Cancel')).props.onClick(); assert.equal(h.find(n => n.props?.['aria-label'] === 'Edit employee name'), undefined)
})
test('Admin review exposes original IDs/names/status and requires explicit identity confirmation; cancel is write-free', async () => {
  const { h, actions } = harness(); await h.flush()
  h.find(n => n.type === 'select').props.onChange({ target: { value: 'all' } }); h.render()
  const selections = h.all(n => n.type === 'input' && n.props.type === 'checkbox')
  selections[0].props.onChange({ target: { checked: true } }); selections[1].props.onChange({ target: { checked: true } }); h.render()
  h.find(n => n.type === 'button' && textOf(n).startsWith('Review selected duplicates')).props.onClick(); h.render()
  const review = h.find(n => n.props?.['aria-label'] === 'Duplicate review'); assert.match(textOf(review), /Inactive/)
  assert.equal(h.find(button('Retain selected record and deactivate duplicates')).props.disabled, true)
  h.find(button('Cancel review')).props.onClick(); assert.equal(actions.length, 0)
})
test('read failures clear rows and disable mutations but keep Reload usable', async () => {
  const { h } = harness({ loadRoster: async () => { throw new Error('offline') } }); await h.flush()
  assert.equal(h.all(n => n.type === 'li' && textOf(n).includes('Cam')).length, 0)
  assert.equal(h.find(button('Add Employee')).props.disabled, true)
  assert.equal(h.find(button('Reload roster')).props.disabled, false)
})
test('late reads after unmount cannot restore a different location roster', async () => {
  let resolve
  const { h } = harness({ loadRoster: () => new Promise(r => { resolve = r }) })
  h.unmount(); resolve(rows); await h.flush()
  assert.equal(h.all(n => n.type === 'li').length, 0)
})

test('Employees page offers only current authorized location options and guards inactive profiles', () => {
  const context = { user: { id: 'manager' }, profile: { role: 'store', is_active: true, deleted_at: null }, locations: [{ id: 'assigned', name: 'Assigned Site' }] }
  const h = locationHelpHarness('pages/Employees', { useAuth: () => context, NavBar: () => null }, {})
  const opts = h.all(n => n.type === 'option')
  assert.deepEqual(opts.map(n => n.props.value), ['assigned'])
  context.profile.is_active = false
  assert.equal(h.all(n => n.type === 'option').length, 0)
  assert.match(textOf(h.find(n => n.props?.role === 'alert')), /active account/)
})
test('rename positive confirmation sends only a roster name update and refreshes', async () => {
  const { h, actions } = harness({ window: { confirm: () => true } }); await h.flush()
  h.find(button('Edit Name')).props.onClick(); h.render()
  h.find(n => n.type === 'input' && n.props.value === 'Cam').props.onChange({ target: { value: 'New Name' } }); h.render()
  await h.find(n => n.type === 'form' && n.props['aria-label'] === 'Edit employee name').props.onSubmit({ preventDefault() {} }); await h.flush()
  assert.equal(actions.length, 1); assert.deepEqual(actions[0][3], { name: 'New Name' })
})
test('confirmed duplicate review sends one atomic operation and clears selection after refresh', async () => {
  const { h, actions } = harness(); await h.flush()
  h.find(n => n.type === 'select').props.onChange({ target: { value: 'all' } }); h.render()
  const boxes = h.all(n => n.type === 'input' && n.props.type === 'checkbox')
  boxes[0].props.onChange({ target: { checked: true } }); boxes[1].props.onChange({ target: { checked: true } }); h.render()
  h.find(n => n.type === 'button' && textOf(n).startsWith('Review selected duplicates')).props.onClick(); h.render()
  h.all(n => n.type === 'input' && n.props.type === 'checkbox').at(-1).props.onChange({ target: { checked: true } }); h.render()
  h.find(button('Retain selected record and deactivate duplicates')).props.onClick(); await h.flush()
  assert.equal(actions.length, 1); assert.equal(actions[0][0], 'review'); assert.equal(actions[0].at(-1), true)
  assert.equal(h.find(n => n.props?.['aria-label'] === 'Duplicate review'), undefined)
})
