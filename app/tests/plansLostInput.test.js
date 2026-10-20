import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { parsePlansLost } from '../src/utils/dailyMemberships.js'

test('Plans Lost uses a keyboard-accessible dialog with the exact manager instructions', () => {
  const h = locationHelpHarness('components/PlansLostInput', { useId: () => 'loss', parsePlansLost }, { value: 0, onChange() {}, disabled: true })
  const dialog = h.find(n => n.type === 'dialog'); let opened = 0, closed = 0
  dialog.ref.current = { showModal() { opened++ }, close() { closed++ } }
  const info = h.find(n => n.type === 'button' && n.props['aria-label'])
  assert.equal(info.props.disabled, undefined, 'help remains available for every site and read-only/legacy state')
  info.props.onClick(); assert.equal(opened, 1)
  assert.equal(h.find(n => n.type === 'button' && n.props['aria-label']).props['aria-expanded'], true)
  assert.equal(dialog.props['aria-labelledby'], 'loss-title')
  assert.equal(h.find(n => n.type === 'h2').props.children, 'Where to Find Plans Lost Today')
  const text = h.all(n => n.type === 'p').map(n => n.props.children)
  assert.ok(text.includes('DRB Sites: Plan Analysis Report → Pass Plans Lost'))
  assert.ok(text.includes('Micrologic Sites: UNLIMITED GROWTH/CHURN BY DAY V1 → Cancel + Decline'))
  h.find(n => n.type === 'button' && n.props.children === 'Close').props.onClick(); assert.equal(closed, 1)
  dialog.props.onClose()
  assert.equal(h.find(n => n.type === 'button' && n.props['aria-label']).props['aria-expanded'], false)
})
test('loss input labels zero, exposes invalid values and save failures accessibly', () => {
  const changes = []
  const h = locationHelpHarness('components/PlansLostInput', { useId: () => 'loss', parsePlansLost }, { value: 0, onChange: v => changes.push(v), error: 'Not saved: denied' })
  assert.equal(h.find(n => n.type === 'label').props.htmlFor, 'loss')
  let input = h.find(n => n.type === 'input')
  assert.equal(input.props.value, 0); assert.equal(input.props.min, '0'); assert.equal(input.props.step, '1')
  input.props.onChange({ target: { value: '-1' } })
  assert.equal(h.find(n => n.type === 'input').props['aria-invalid'], true)
  assert.match(h.find(n => n.props?.id === 'loss-status').props.children, /nonnegative whole number/)
  h.find(n => n.type === 'input').props.onChange({ target: { value: '0' } })
  assert.equal(h.find(n => n.props?.id === 'loss-status').props.children, 'Not saved: denied')
  assert.deepEqual(changes, ['-1', '0'])
})
