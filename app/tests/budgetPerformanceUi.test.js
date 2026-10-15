import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as helpers from '../src/utils/insightsHelpers.js'
import * as colors from '../src/utils/metricColors.js'
import { fmtNum } from '../src/utils/format.js'
import { shopTotals, employeeDeltasByDay } from '../src/utils/logMath.js'
import { commonReportingToday, selectPerformanceSources } from '../src/utils/budgetPerformanceSource.js'

function component(name, dependencies) {
  const text = readFileSync(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '')
  const module = { exports: {} }
  new Function('module', 'exports', ...Object.keys(dependencies), transformSync(text, { loader: 'jsx', format: 'cjs' }).code)(module, module.exports, ...Object.values(dependencies))
  return module.exports.default
}
const location = { id: 'a', name: 'Fictional site', show_budget_tracking: true }
const range = { start: '2026-10-01', end: '2026-10-15' }
const logs = [{ location_id: 'a', log_date: '2026-10-14', time_slot: '10:00', employee_name: 'Fictional employee', total_washes: 9999, member_washes: 0, basic: 1, good: 0, better: 1, best: 0, memberships_sold: 2, opportunities: 9999, google_reviews: 2 }]
const entries = [{ location_id: 'a', entry_date: '2026-10-15', mtd_washes: 1000, mtd_redemptions: 500, mtd_basic: 10, mtd_good: 10, mtd_better: 15, mtd_best: 15, current_reviews: 12, yesterday_washes: 100, yesterday_redemptions: 50, yesterday_basic: 1, yesterday_good: 1, yesterday_better: 2, yesterday_best: 1 }]
const source = selectPerformanceSources(logs, entries, [location], range, '2026-10-15')
const Note = component('BudgetSourceNote', { React })

test('Site Performance renders authoritative MTD and a collapsed source explanation, not covered logs', () => {
  const Table = component('SiteMetricTable', { React, useState: React.useState, ...helpers, ...colors, fmtNum,
    useBudgetPerformance: () => source, BudgetSourceNote: Note, ExportMenu: () => null, fmtDateRange: () => 'October' })
  const html = renderToStaticMarkup(React.createElement(Table, { data: logs, locations: [location], dateRange: range }))
  assert.match(html, /1,000/)
  assert.doesNotMatch(html, /9,999/)
  assert.match(html, /Budget Tracking through/)
  assert.match(html, /<details><summary/)
  assert.doesNotMatch(html, /<details open/)
})

test('Monthly Rollup keeps employee logs intact while replacing shop daily and MTD totals', () => {
  let stateIndex = 0
  const Rollup = component('MonthlyRollup', { React, useState: () => [[logs, ['Fictional employee'], false][stateIndex++], () => {}], useEffect: () => {},
    ...colors, fmtNum, shopTotals, employeeDeltasByDay, useBudgetPerformance: () => source, BudgetSourceNote: Note })
  const html = renderToStaticMarkup(React.createElement(Rollup, { locationId: 'a', dateStart: range.start, dateEnd: range.end, budgetLocation: location }))
  assert.match(html, /9,999/, 'employee totals remain log based')
  assert.match(html, /1,000/, 'shop MTD comes from the snapshot')
  assert.match(html, />100<\/td>/, 'shop daily value comes from Yesterday counts')
  assert.doesNotMatch(html, /10,099|10,999/, 'no log/snapshot addition')
  assert.match(html, /employee columns remain Daily Log based/)
  assert.match(html, /10.0%/)
})

test('company reporting uses a business day completed in every selected site timezone', () => {
  const sites = [{ timezone: 'America/New_York' }, { timezone: 'America/Los_Angeles' }]
  assert.equal(commonReportingToday(sites, new Date('2026-10-15T05:00:00Z')), '2026-10-14')
  assert.equal(commonReportingToday(sites, new Date('2026-10-15T15:00:00Z')), '2026-10-15')
})
