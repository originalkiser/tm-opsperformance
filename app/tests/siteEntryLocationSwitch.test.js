import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import * as fields from '../src/utils/budgetDailyFields.js'
import * as revenue from '../src/utils/budgetRevenue.js'
import * as math from '../src/utils/budgetMath.js'
import { cashCountError } from '../src/utils/cashReconciliation.js'
import { entryLocationOptions, resolveEntryLocation } from '../src/utils/locationAccess.js'

// Run actual components/hooks and event handlers with deferred API responses.
// Keys returned by Site Entry are used as mount identities, just as in React.
function harness(file, name, props, globals = {}) {
  const hooks = []
  let cursor, effects, dirty, value, mounted = true
  const useState = initial => {
    const i = cursor++
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
    return [hooks[i], next => { if (mounted) { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; dirty = true } }]
  }
  const useRef = initial => hooks[cursor++] ||= { current: initial }
  const useEffect = (fn, deps) => {
    const i = cursor++, old = hooks[i]
    if (!old || deps.some((dep, j) => !Object.is(dep, old.deps[j]))) {
      effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() } })
    }
  }
  let source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\n/gm, '')
  if (name !== 'default') source += `\nexport { ${name} }`
  const mod = { exports: {} }
  const bindings = { React, useState, useEffect, useRef, useMemo: fn => fn(), ...globals }
  new Function('module', 'exports', ...Object.keys(bindings), transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(mod, mod.exports, ...Object.values(bindings))
  function render(commit = true) {
    do { dirty = false; cursor = 0; effects = []; value = mod.exports[name](...(Array.isArray(props) ? props : [props])); if (commit) effects.forEach(fn => fn()) } while (commit && dirty)
    return value
  }
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]
  return {
    render, props(next, commit = true) { props = next; return render(commit) },
    find(predicate) { return nodes(render()).find(predicate) },
    async flush() { for (let i = 0; i < 16; i++) { await Promise.resolve(); render() } return value },
    unmount() { hooks.forEach(h => h?.cleanup?.()); mounted = false },
  }
}
const sites = ['Greenville', 'Cleveland', 'Batesville'].map(name => ({ id: name, name, show_budget_tracking: true, show_ownership_tools: true }))
const date = '2026-10-22'
const fullRow = id => ({ ...Object.fromEntries(Object.keys(fields.emptyDailyForm()).map(k => [k, 0])), location_id: id, entry_date: date, mtd_membership_actual: sites.findIndex(s => s.id === id) + 100 })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function api() {
  const requests = [], writes = []
  return {
    requests, writes,
    fetchRevenueEntries(_client, [id]) { const d = deferred(); requests.push({ id, ...d }); return d.promise },
    fetchStartingBalances: async () => [],
    supabase: { from() { return {
      select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null }),
      upsert(payload) { writes.push(payload); return { select() { return this }, single: async () => ({ data: payload }) } },
    } } },
  }
}

function hook(client, id, onSaved = () => {}) {
  return harness('hooks/useBudgetDailyEntry.js', 'default', [id, date, onSaved], { ...fields, ...revenue, cashCountError, ...client })
}
const Placeholder = () => null
const Daily = () => null, Budget = () => null, Ownership = () => null, Rollup = () => null, Snapshot = () => null, Summary = () => null, Picker = () => null
function dashboard(client = api().supabase) {
  const stored = new Map([['tm_selected_location', sites[0].id], ['tm_active_tab', 'budget']])
  const h = harness('pages/Dashboard.jsx', 'default', {}, {
    useAuth: () => ({ profile: { role: 'admin' }, locations: sites }),
    localStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    loadSavedDateRange: () => ({ start: date, end: date }), saveDateRange() {}, fmtDateRange: () => '',
    entryLocationOptions, resolveEntryLocation, isDayComplete: fields.isDayComplete,
    shopTotals: rows => rows[0] || null, morningEntryStatus: complete => complete ? 'complete' : 'pending',
    supabase: client, setInterval: () => 1, clearInterval() {},
    NavBar: Placeholder, LocationRepair: Placeholder, DateSelector: Placeholder, LocationSelector: Picker,
    DailyLogTable: Daily, BudgetTrackingSection: Budget, OwnershipLogSection: Ownership,
    MonthlyRollup: Rollup, DailySnapshot: Snapshot, EmployeeSummary: Summary,
  })
  h.render()
  return h
}
const content = h => h.find(n => n.type === 'div' && n.props.className === 'p-4')

test('Greenville → Cleveland → Batesville changes the mount boundary for every Site Entry tab', async () => {
  const h = dashboard(), keys = []
  for (const site of sites) {
    h.find(n => n.type === Picker).props.onChange(site.id)
    const boundary = content(h); keys.push(boundary.key)
    assert.ok(boundary.key.endsWith(site.id))
    assert.equal(h.find(n => n.type === Budget).props.locations[0].id, site.id)
    assert.equal(h.find(n => n.type === Ownership).props.locations[0].id, site.id)
    assert.equal(h.find(n => n.type === Daily).props.locationId, site.id)
    assert.equal(h.find(n => n.type === Rollup).props.locationId, site.id)
    await h.flush()
  }
  assert.equal(new Set(keys).size, 3)
  const before = content(h).key
  h.find(n => n.type === 'button' && n.props.children?.[0] === 'Daily Log').props.onClick()
  assert.equal(content(h).key, before, 'switching tabs in one site preserves drafts')
  h.unmount()
})

test('shared daily rows disappear immediately; late prior-site notifications cannot leak into the new snapshot', () => {
  const h = dashboard()
  const previous = h.find(n => n.type === Daily).props.onRowsChange
  previous([{ time_slot: '12:00', basic: 99 }])
  assert.equal(h.find(n => n.type === Snapshot).props.rows.length, 1)
  h.find(n => n.type === Picker).props.onChange('Cleveland')
  assert.deepEqual(h.find(n => n.type === Snapshot).props.rows, [])
  previous([{ time_slot: '13:00', basic: 123 }])
  assert.deepEqual(h.find(n => n.type === Snapshot).props.rows, [])
  assert.deepEqual(h.find(n => n.type === Summary).props.rows, [])
  h.unmount()
})

test('Budget daily entry never initializes from a profile site absent from the supplied location choices', () => {
  for (const site of sites) {
    let requested
    const h = harness('components/BudgetTrackingSection.jsx', 'DailyEntryTab', { locations: [site], profile: { role: 'admin', location_id: 'Greenville' } }, {
      ...fields, ...math, displayCount: String, reportedRevenuePace: () => ({ reported: {} }), TmLoader: Placeholder,
      useBudgetDailyEntry(id) { requested = id; return { form: fields.emptyDailyForm(), loading: true, mtdRevenue: {}, historicalRevenue: {} } },
    })
    h.render()
    assert.equal(requested, site.id)
    assert.equal(h.find(n => n.type === 'select').props.value, site.id)
    assert.ok(h.find(n => n.type === Placeholder), 'loading replaces all prior-site inputs')
    assert.equal(h.find(n => n.type === 'input'), undefined)
    h.unmount()
  }
})

test('each new site starts loading; unsaved Greenville edits are discarded and only Batesville values can be saved', async () => {
  const client = api()
  let h
  for (const site of sites) {
    h?.unmount()
    h = hook(client, site.id)
    assert.equal(h.render().loading, true)
    await h.render().handleSave()
    assert.equal(client.writes.length, 0)
    client.requests.at(-1).resolve([fullRow(site.id)])
    await h.flush()
    assert.equal(h.render().entry.location_id, site.id)
    assert.equal(h.render().form.mtd_membership_actual, fullRow(site.id).mtd_membership_actual)
    if (site.id === 'Greenville') h.render().set('mtd_membership_actual', 999)
  }
  await h.render().handleSave()
  assert.equal(client.writes.length, 1)
  assert.equal(client.writes[0].location_id, 'Batesville')
  assert.equal(client.writes[0].mtd_membership_actual, 102)
  h.unmount()
})

test('rapid location changes ignore out-of-order responses and errors, including return to the original site', async () => {
  const client = api(), h = hook(client, 'Greenville')
  h.render()
  h.props(['Cleveland', date])
  h.props(['Batesville', date])
  assert.equal(h.render().loading, true)
  await h.render().handleSave()
  assert.equal(client.writes.length, 0)
  client.requests[2].resolve([fullRow('Batesville')]); await h.flush()
  client.requests[0].resolve([fullRow('Greenville')])
  client.requests[1].reject(new Error('Late Cleveland failure')); await h.flush()
  assert.equal(h.render().entry.location_id, 'Batesville')
  assert.equal(h.render().error, '')
  h.props(['Greenville', date])
  assert.equal(h.render().loading, true)
  client.requests[3].resolve([fullRow('Greenville')]); await h.flush()
  assert.equal(h.render().entry.location_id, 'Greenville')
  h.unmount()
})

test('failed current-site loads remain blank and cannot submit a previous site draft', async () => {
  const client = api(), h = hook(client, 'Greenville')
  h.render(); client.requests[0].resolve([fullRow('Greenville')]); await h.flush()
  h.render().set('mtd_membership_actual', 999)
  h.props(['Cleveland', date])
  client.requests[1].reject(new Error('Offline')); await h.flush()
  assert.equal(h.render().entry, null)
  assert.equal(h.render().form.mtd_membership_actual, '')
  assert.match(h.render().error, /Unable to load/)
  await h.render().handleSave()
  assert.equal(client.writes.length, 0)
  h.unmount()
})


test('completion indicators reset with the selected site and ignore a late prior-site result', async () => {
  const requests = []
  const client = { from(table) { return { select() { return this }, eq() { return this }, maybeSingle() {
    const d = deferred(); requests.push({ table, ...d }); return d.promise
  } } } }
  const h = dashboard(client)
  requests[0].resolve({ data: fullRow('Greenville') }); await h.flush()
  requests[1].resolve({ data: { submitted_at: 'saved' } }); await h.flush()
  const budgetButton = () => h.find(n => n.type === 'button' && n.props.children?.[0] === 'Budget Tracking')
  assert.equal(budgetButton().props.title, undefined)
  h.find(n => n.type === Picker).props.onChange('Cleveland')
  assert.equal(budgetButton().props.title, 'Pending — by 10am local')
  h.find(n => n.type === Picker).props.onChange('Batesville')
  requests[2].resolve({ data: fullRow('Cleveland') }); await h.flush()
  assert.equal(budgetButton().props.title, 'Pending — by 10am local')
  h.unmount()
})

test('an in-flight save stays bound to its original site and cannot mark the next site saved', async () => {
  const client = api(), save = deferred()
  let saved = 0
  const original = client.supabase.from
  client.supabase.from = (...args) => ({ ...original(...args), upsert(payload) {
    client.writes.push(payload)
    return { select() { return this }, single: () => save.promise }
  } })
  const old = hook(client, 'Greenville', () => { saved++ })
  old.render(); client.requests[0].resolve([fullRow('Greenville')]); await old.flush()
  const pending = old.render().handleSave()
  old.unmount()
  const next = hook(client, 'Cleveland', () => { saved++ })
  next.render()
  save.resolve({ data: fullRow('Greenville') }); await pending; await next.flush()
  assert.equal(client.writes[0].location_id, 'Greenville')
  assert.equal(next.render().loading, true)
  assert.equal(next.render().saved, false)
  assert.equal(saved, 0)
  next.unmount()
})
