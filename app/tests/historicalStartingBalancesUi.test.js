import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSync } from 'esbuild'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function harness(role = 'admin', initiallyExpanded) {
  let state = initiallyExpanded
  let editorRenders = 0
  const source = read('../src/components/HistoricalMtdStartingBalances.jsx').replace(/^import .*\n/gm, '')
  const module = { exports: {} }
  const useState = initial => {
    if (state === undefined) state = initial
    return [state, update => { state = typeof update === 'function' ? update(state) : update }]
  }
  const panel = () => { editorRenders++; return React.createElement('p', null, 'Historical editor') }
  new Function('module', 'exports', 'React', 'useState', 'useAuth', 'AdminStartingBalancePanel',
    transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(
    module, module.exports, React, useState, () => ({ profile: role ? { role } : null }), panel)
  const locations = [{ id: 'fictional', name: 'Fictional site', timezone: 'America/Chicago' }]
  return { render: (sites = locations) => module.exports.default({ locations: sites }), locations, count: () => editorRenders }
}

test('historical option starts collapsed and does not mount or load the editor', () => {
  const h = harness()
  const html = renderToStaticMarkup(h.render())
  assert.match(html, /Historical MTD Starting Balances/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /Historical editor/)
  assert.equal(h.count(), 0)
})

test('Admin can expand, save through the existing panel, close and reopen', () => {
  const h = harness()
  h.render().props.children[0].props.onClick()
  const open = h.render()
  assert.match(renderToStaticMarkup(open), /aria-expanded="true"/)
  const panel = open.props.children[1].props.children
  assert.deepEqual(panel.props.locations, h.locations)
  assert.equal(typeof panel.props.onSaved, 'function')
  panel.props.onSaved({ location_id: 'fictional', amount: 1234, cutoff_business_date: '2026-10-10' })
  assert.match(renderToStaticMarkup(h.render()), /Historical editor/)
  panel.props.onClose()
  assert.match(renderToStaticMarkup(h.render()), /aria-expanded="false"/)
  h.render().props.children[0].props.onClick()
  assert.match(renderToStaticMarkup(h.render()), /Historical editor/)
})

test('Store, Area Manager and signed-out viewers cannot render historical controls even if expanded', () => {
  for (const role of ['store', 'area_manager', null]) {
    const h = harness(role, true)
    assert.equal(renderToStaticMarkup(h.render()), '')
    assert.equal(h.count(), 0)
  }
})

test('Admin with no Budget sites sees an empty message rather than a broken editor', () => {
  const h = harness('admin', true)
  assert.match(renderToStaticMarkup(h.render([])), /No sites have Budget Tracking enabled/)
  assert.equal(h.count(), 0)
})

test('report retains starting-balance calculations but exposes no historical editing controls', () => {
  const report = read('../src/components/BudgetTrackingReport.jsx')
  assert.doesNotMatch(report, /AdminStartingBalancePanel|RevenueStartingBalanceEditor|balancePanelOpen|balanceTools|Admin starting balances/)
  assert.match(report, /useBudgetReport\(locations/)
  const loader = read('../src/hooks/useBudgetReport.js')
  const rows = read('../src/utils/budgetReportRows.js')
  assert.match(loader, /fetchStartingBalances\(supabase, locIds, reportingDate\)/)
  assert.match(rows, /calculateMtdRevenue\(entries, loc.id, reportingDate, startingBalances.find/)
  assert.match(report, /AdminCashOnHandPanel/)
  const admin = read('../src/pages/Admin.jsx')
  assert.match(admin, /isAdmin && tab === 'budget_tracking'/)
  assert.match(admin, /<HistoricalMtdStartingBalances locations=\{locations.filter\(location => location.show_budget_tracking\)\}/)
})
