import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetLabelFields, budgetFieldWording, budgetDisplayFields, parseBudgetLabels, readBudgetLabels, budgetLabelEditorAction } from '../src/utils/budgetLabels.js'
import { YESTERDAY_FIELDS, MTD_FIELDS, REVENUE_FIELDS, emptyDailyForm, isDayComplete } from '../src/utils/budgetDailyFields.js'
import { yesterdayMetrics, mtdMetrics } from '../src/utils/budgetMath.js'
const defaults = () => budgetLabelFields.map(({ id, label, helper }) => ({ id, label, helper }))

test('fixed catalog preserves original input defaults and never changes field identities or optional rules', () => {
  assert.equal(budgetLabelFields.length, 21)
  const labels = parseBudgetLabels(defaults())
  for (const field of [...YESTERDAY_FIELDS, ...MTD_FIELDS]) assert.deepEqual(budgetDisplayFields([field], labels)[0], { ...field, hint: field.hint || '' })
  for (const field of REVENUE_FIELDS) assert.equal(budgetFieldWording(field.key, labels).label, field.label)
  const raw = { key: 'yesterday_wash_overrides', optional: true, label: 'Ignored' }
  assert.deepEqual(budgetDisplayFields([raw], { 'yesterday-wash-overrides': { label: 'New wording', helper: 'Explanation' } }), [{ ...raw, label: 'New wording', hint: 'Explanation' }])
  assert.throws(() => budgetFieldWording('role'), /not configurable/)
})

test('malformed or unknown configuration fails closed; no partial catalog or arbitrary keys', () => {
  for (const change of [items => items.pop(), items => items.push(items[0]), items => { items[0].id = '__proto__' }, items => { items[0].label = '' }, items => { items[0].helper = 'a'.repeat(401) }]) {
    const items = defaults(); change(items); assert.throws(() => parseBudgetLabels(items))
  }
  assert.equal(parseBudgetLabels(defaults())['yesterday-washes'].label, 'Yesterday Washes')
})

test('read and write use only scoped RPCs, expected revision and fixed wording arguments', async () => {
  const calls = [], client = { async rpc(name, args) { calls.push({ name, args }); return { data: name === 'budget_tracker_labels' ? defaults() : { items: budgetLabelFields.map(item => ({ ...item, default_label: item.label, default_helper: item.helper, revision: 0 })), history: [] } } } }
  await readBudgetLabels(client)
  await budgetLabelEditorAction(client, 'save', { id: 'yesterday-washes', revision: 3 }, 'Wash count', 'Prior day')
  assert.deepEqual(calls[1], { name: 'budget_tracker_label_editor', args: { p_action: 'save', p_key: 'yesterday-washes', p_revision: 3, p_label: 'Wash count', p_helper: 'Prior day' } })
  await assert.rejects(budgetLabelEditorAction({ rpc: async () => ({ error: { code: 'PT409' } }) }, 'save'), /changed elsewhere/)
  await assert.rejects(readBudgetLabels({ rpc: async () => ({ error: { code: '42501' } }) }), /Showing original wording/)
})

test('wording never modifies form values, completion validation or yesterday/MTD reporting math', () => {
  const form = emptyDailyForm(); for (const key in form) form[key] = '0'
  form.yesterday_washes = '100'; form.yesterday_redemptions = '20'; form.yesterday_basic = '10'
  form.mtd_washes = '300'; form.mtd_redemptions = '60'; form.mtd_basic = '30'
  const before = JSON.stringify(form), metrics = [yesterdayMetrics(form, {}), mtdMetrics(form, {}), isDayComplete(form)]
  const labels = parseBudgetLabels(defaults().map(item => ({ ...item, label: 'Changed ' + item.id, helper: 'Instructions only' })))
  budgetDisplayFields([...YESTERDAY_FIELDS, ...MTD_FIELDS], labels)
  assert.equal(JSON.stringify(form), before)
  assert.deepEqual([yesterdayMetrics(form, {}), mtdMetrics(form, {}), isDayComplete(form)], metrics)
})
