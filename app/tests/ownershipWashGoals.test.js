import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'

function harness(failSave = false) {
  const source = readFileSync(new URL('../src/components/OwnershipWashGoals.jsx', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const code = transformSync(source, { loader: 'jsx', format: 'cjs' }).code
  let cursor = 0, effect, mounted = false, writes = []
  const state = []
  const row = { location_id: 'wash', goal_1: 'Improve conversion', goal_2: 'Grow members', goal_3: 'Better service', updated_at: 'original' }
  const useState = initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }] }
  const supabase = { from(table) {
    assert.equal(table, 'ownership_wash_goals')
    let payload, filters = []
    const query = { select() { return query }, eq(key, value) { filters.push([key, value]); return query }, maybeSingle() { return Promise.resolve({ data: row }) }, update(value) { payload = value; return query }, insert(value) { payload = value; return query }, single() { writes.push({ payload, filters }); return Promise.resolve(failSave ? { error: new Error('conflict') } : { data: { ...payload, updated_at: 'new' } }) } }
    return query
  } }
  const mod = { exports: {} }
  new Function('module', 'exports', 'React', 'useState', 'useEffect', 'supabase', code)(mod, mod.exports, React, useState, fn => { if (!mounted) effect = fn }, supabase)
  const render = () => { cursor = 0; return mod.exports.default({ locationId: 'wash' }) }
  const nodes = tree => tree == null || typeof tree !== 'object' ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]
  const find = predicate => nodes(render()).find(predicate)
  const button = label => find(node => node.type === 'button' && node.props.children === label)
  return { render, find, button, writes, async load() { render(); mounted = true; effect(); await Promise.resolve() } }
}

test('persistent goals load locked; explicit editing and Cancel preserve stored values', async () => {
  const h = harness(); await h.load()
  let goal = h.find(node => node.type === 'textarea')
  assert.equal(goal.props.value, 'Improve conversion'); assert.equal(goal.props.readOnly, true)
  h.button('Edit goals').props.onClick()
  goal = h.find(node => node.type === 'textarea'); assert.equal(goal.props.readOnly, false)
  goal.props.onChange({ target: { value: 'Unsaved replacement' } })
  h.button('Cancel').props.onClick()
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'Improve conversion')
  assert.equal(h.writes.length, 0)
})

test('goal saves use separate site storage, protect concurrent edits and relock after success', async () => {
  const h = harness(); await h.load(); h.button('Edit goals').props.onClick()
  h.find(node => node.type === 'textarea').props.onChange({ target: { value: ' New goal ' } })
  await h.button('Save goals').props.onClick()
  assert.equal(h.writes[0].payload.goal_1, 'New goal')
  assert.deepEqual(h.writes[0].filters, [['location_id', 'wash'], ['updated_at', 'original']])
  assert.equal(h.find(node => node.type === 'textarea').props.readOnly, true)
  assert.ok(!('log_date' in h.writes[0].payload))
})

test('failed goal saves leave draft editable and show an error', async () => {
  const h = harness(true); await h.load(); h.button('Edit goals').props.onClick()
  await h.button('Save goals').props.onClick()
  assert.equal(h.find(node => node.type === 'textarea').props.readOnly, false)
  assert.match(h.find(node => node.props?.role === 'alert').props.children, /not saved/)
})
