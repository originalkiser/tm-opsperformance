import assert from 'node:assert/strict'
import test from 'node:test'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { adminCategories, availableAdminTools, findAdminTools, scopedAdminSite, adminDestination } from '../src/utils/administration.js'

const locations = [{ id: 'enabled', show_budget_tracking: true }, { id: 'disabled' }]
const Directory = () => null
const Cash = () => null
const BudgetLabels = () => null

function administration({ query = '', role = 'admin', managerPreview = false, capable = false } = {}) {
  const calls = []
  let params = new URLSearchParams(query)
  const auth = { user: { id: 'fictional-admin' }, profile: { role, is_active: true }, managerPreview, locations }
  const harness = locationHelpHarness('pages/Admin', {
    useAuth: () => auth, useSearchParams: () => [params, update => { params = update(params) }],
    supabase: { async rpc(name) { calls.push(name); return { data: { can_edit_templates: capable } } } },
    adminCategories, availableAdminTools, scopedAdminSite,
    AdministrationDirectory: Directory, AdminCashOnHandPanel: Cash, BudgetLabelsEditor: BudgetLabels,
    NavBar: () => null, Link: () => null,
  })
  return { ...harness, calls, auth }
}

test('search supports aliases, descriptions and scopes while excluding restricted editors', () => {
  const ordinary = availableAdminTools(false)
  const privileged = availableAdminTools(true)
  for (const [term, id] of [['drawer float', 'cash-on-hand'], ['starting balance', 'budget_tracking'], ['QR code', 'checklist-qr'], ['operating hours', 'operating-hours'], ['temporary password', 'add_user']]) {
    assert.ok(findAdminTools(ordinary, term).some(tool => tool.id === id), term)
  }
  assert.equal(findAdminTools(ordinary, 'budget labels').length, 0)
  assert.deepEqual(findAdminTools(privileged, 'budget labels').map(tool => tool.id), ['budget-labels'])
  const directory = locationHelpHarness('components/AdministrationDirectory', {
    adminCategories, adminDestination, findAdminTools, Link: () => null,
  }, { tools: privileged, site: 'enabled' })
  directory.find(node => node.props.id === 'admin-tool-search').props.onChange({ target: { value: 'drawer' } })
  assert.ok(directory.find(node => node.props.to === '/admin?tool=cash-on-hand&site=enabled'))
  assert.equal(directory.find(node => node.props.to === '/admin?tool=budget-labels&site=enabled'), undefined)
  assert.ok(directory.find(node => node.props.to === '/admin?category=checklists&site=enabled'))
  directory.unmount()
})

test('Store and Manager View cannot see the directory or open an Admin deep link', async () => {
  for (const options of [{ role: 'store' }, { managerPreview: true }]) {
    for (const query of ['', 'tool=cash-on-hand']) {
      const h = administration({ ...options, query, capable: true })
      await h.flush()
      assert.ok(h.find(node => node.props.role === 'alert'))
      assert.equal(h.find(node => node.type === Directory || node.type === Cash), undefined)
      assert.deepEqual(h.calls, [])
      h.unmount()
    }
  }
})

test('restricted deep links require a current Super Admin capability', async () => {
  const ordinary = administration({ query: 'tool=budget-labels' })
  await ordinary.flush()
  assert.equal(ordinary.find(node => node.type === BudgetLabels), undefined)
  assert.ok(ordinary.find(node => node.props.children === 'This administration tool is unavailable.'))
  ordinary.unmount()

  const privileged = administration({ query: 'tool=budget-labels', capable: true })
  assert.equal(privileged.find(node => node.type === BudgetLabels), undefined)
  await privileged.flush()
  assert.ok(privileged.find(node => node.type === BudgetLabels))
  assert.deepEqual(privileged.calls, ['configuration_capabilities'])
  privileged.auth.user = { id: 'replacement-account' }
  assert.equal(privileged.find(node => node.type === BudgetLabels), undefined)
  privileged.unmount()
})

test('Cash on Hand deep links preserve Budget-enabled location scope and return navigation', () => {
  const h = administration({ query: 'tool=cash-on-hand&site=enabled' })
  const cash = h.find(node => node.type === Cash)
  assert.deepEqual(cash.props.locations, [locations[0]])
  assert.equal(cash.props.selectedLocationId, 'enabled')
  assert.ok(h.find(node => node.props.to === '/admin?category=locations&site=enabled'))
  h.unmount()

  const invalid = administration({ query: 'tool=cash-on-hand&site=disabled' })
  assert.equal(invalid.find(node => node.type === Cash).props.selectedLocationId, 'enabled')
  invalid.unmount()
})

test('the moved Budget Tracker Labels editor still sends audited save and restore actions', async () => {
  const { budgetLabelFields, budgetLabelEditorAction, budgetLabelSection } = await import('../src/utils/budgetLabels.js')
  const calls = [], events = []
  const items = budgetLabelFields.map(field => ({
    id: field.id, label: field.label, helper: field.helper,
    default_label: field.label, default_helper: field.helper, revision: 0,
  }))
  const h = locationHelpHarness('components/BudgetLabelsEditor', {
    budgetLabelEditorAction, budgetLabelSection,
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event.type) },
    supabase: { async rpc(name, args) {
      calls.push({ name, args })
      const item = items.find(row => row.id === args.p_key)
      if (args.p_action === 'save') Object.assign(item, { label: args.p_label, helper: args.p_helper, revision: item.revision + 1 })
      if (args.p_action === 'restore') Object.assign(item, { label: item.default_label, helper: item.default_helper, revision: item.revision + 1 })
      return { data: { items: structuredClone(items), history: [] } }
    } },
  })
  const button = label => h.find(node => node.type === 'button' && node.props.children === label)
  await button('Load labels').props.onClick()
  await h.flush()
  const selector = () => h.find(node => node.props['aria-label'] === 'Budget Tracker label field')
  assert.ok(h.find(node => node.type === 'optgroup' && node.props.label === 'Daily Cash Reconciliation'))
  selector().props.onChange({ target: { value: 'cash-reconciliation-heading' } })
  await h.flush()
  h.find(node => node.props['aria-label'] === 'Replacement label').props.onChange({ target: { value: 'Verified replacement label' } })
  assert.equal(button('Save wording').props.disabled, false)
  await button('Save wording').props.onClick()
  await h.flush()
  assert.equal(button('Restore original wording').props.disabled, false)
  await button('Restore original wording').props.onClick()
  await h.flush()
  assert.ok(calls.every(call => call.name === 'budget_tracker_label_editor'))
  const writes = calls.map(call => call.args).filter(args => args.p_action !== 'read')
  assert.deepEqual(writes.map(({ p_action, p_key, p_revision, p_label }) => [p_action, p_key, p_revision, p_label]), [
    ['save', 'cash-reconciliation-heading', 0, 'Verified replacement label'],
    ['restore', 'cash-reconciliation-heading', 1, null],
  ])
  assert.deepEqual(events, ['tm-budget-labels-updated', 'tm-budget-labels-updated'])
  h.unmount()
})
