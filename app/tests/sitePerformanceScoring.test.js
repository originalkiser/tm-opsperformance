import { kpiTableBindings } from './helpers/kpiTableBindings.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { buildBudgetReportRows, budgetReportPeriod } from '../src/utils/budgetReportRows.js'
import { scoreBudgetLocations, SCORE_LABELS, SCORE_WEIGHTS } from '../src/utils/budgetScoring.js'
import * as helpers from '../src/utils/insightsHelpers.js'
import * as colors from '../src/utils/metricColors.js'
import * as display from '../src/utils/budgetDisplay.js'
import { shiftDate } from '../src/utils/budgetRevenue.js'
import { pct1 } from '../src/utils/budgetMath.js'
import { fmtNum } from '../src/utils/format.js'
import { selectPerformanceSources, budgetPerformanceRow } from '../src/utils/budgetPerformanceSource.js'

const date = '2026-10-03', dateRange = { start: '2026-10-01', end: date }
const Placeholder = () => null
function compile(name, globals, exportName = 'default') {
  const source = readFileSync(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\n/gm, '')
  const mod = { exports: {} }, bindings = { React, useState: React.useState, ...globals }
  new Function('module', 'exports', ...Object.keys(bindings), transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(mod, mod.exports, ...Object.values(bindings))
  return exportName === '*' ? mod.exports : mod.exports[exportName]
}
const details = compile('BudgetScoreDetails', { SCORE_LABELS, SCORE_WEIGHTS }, '*')
const SourceNote = compile('BudgetSourceNote', {})
const Table = compile('SiteMetricTable', { ...kpiTableBindings(), ...helpers, ...colors, ...display, pct1, fmtNum, BudgetScoreDetails: details.default, formatBudgetScore: details.formatBudgetScore, BudgetSourceNote: SourceNote, ExportMenu: Placeholder, fmtDateRange: () => 'October' }, 'PerformanceTable')
function fixture() {
  const ids = ['a', 'b', 'c', 'd']
  return {
    locations: ids.map(id => ({ id, name: `Site ${id}`, show_budget_tracking: true })),
    targets: ids.map(location_id => ({ location_id, target_month: '2026-10-01', revenue_goal: 3100, starting_members: 100, membership_daily_growth: 2, membership_goal: 162, desired_rating: 4.85 })),
    entries: ids.map((location_id, i) => ({ location_id, entry_date: date, yesterday_washes: 100, yesterday_redemptions: 80, yesterday_basic: 0, yesterday_good: 0, yesterday_better: 0, yesterday_best: 4, mtd_washes: 100 - i * 20, mtd_redemptions: 0, mtd_basic: 0, mtd_good: 0, mtd_better: 0, mtd_best: 10, mtd_membership_actual: 104 + i, current_reviews: 12, current_rating: 4.85, yesterday_total_revenue: 0, yesterday_cc_revenue: 0, yesterday_house_revenue: 0 })),
    balances: ids.map((location_id, i) => ({ location_id, revenue_month: '2026-10-01', amount: 600 - i * 100, cutoff_business_date: '2026-10-02' })),
  }
}
function reports(data, locations = data.locations, range = dateRange) {
  const rows = buildBudgetReportRows(data, range.end)
  let sitePool, budgetPool
  const Budget = compile('BudgetTrackingReport', {
    useAuth: () => ({ profile: { role: 'area_manager' } }), budgetReportPeriod,
    useBudgetReport(pool, day) { budgetPool = { pool, day }; return { rows, loading: false, error: '', refresh() {} } },
    displayMoney: display.displayMoney, displayCount: display.displayCount, pct1,
    REPORT_STATUS_CLS: colors.REPORT_STATUS_CLS, BudgetScoreDetails: details.default,
    BudgetCashCell: Placeholder, BudgetRevenueNotes: Placeholder, PaceBadge: Placeholder,
  })
  const Site = compile('SitePerformanceReport', {
    useReportNetMembers: () => ({values: undefined}),
    budgetReportPeriod, shiftDate, selectPerformanceSources, budgetPerformanceRow, PerformanceTable: Table,
    SiteMetricTable: () => React.createElement('p', {}, 'Legacy range'),
    useBudgetReport(pool, day) { sitePool = { pool, day }; return { rows, loading: false, error: '' } },
  })
  return {
    rows,
    budget: renderToStaticMarkup(React.createElement(Budget, { locations: data.locations, dateRange: range })),
    site: renderToStaticMarkup(React.createElement(Site, { locations, scoringLocations: data.locations, dateRange: range, data: [] })),
    get pools() { return { sitePool, budgetPool } },
  }
}
const rowsOf = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1])).filter(r => r.length)
const plain = s => s.replace(/<[^>]*>/g, '')
function assertParity(result) {
  const budget = rowsOf(result.budget), site = rowsOf(result.site)
  for (const b of budget) {
    const s = site.find(s => plain(s[0]) === plain(b[1]))
    assert.ok(s, `site row for ${plain(b[1])}`)
    for (const [bi, si] of [[0,8],[5,7],[6,6],[7,9],[8,11],[9,12],[10,10],[13,15],[14,16]]) assert.equal(s[si], b[bi], `same KPI/score markup ${bi} for ${plain(b[1])}`)
  }
}

test('both reports render identical KPI values, scores, details and ranks from the same Budget dataset', () => {
  const result = reports(fixture())
  assertParity(result)
  assert.deepEqual(result.pools.sitePool, result.pools.budgetPool)
  assert.equal(result.rows[0].score, 100)
  assert.match(result.site, /MTD shop totals prioritize Budget Tracking through 2026-10-02/)
  assert.match(result.site, /Source details/)
  for (const label of ['MTD Revenue','Total Members','Membership Growth','Expected Growth','Rating','Score','Rank']) assert.ok(result.site.includes(label))
})

test('missing, stale, provisional and invalid Budget records have numeric scores and ranks in both reports', () => {
  const data = fixture()
  data.entries[1].mtd_membership_actual = null
  data.entries[2].entry_date = '2026-10-02'
  data.entries[3].yesterday_total_revenue = null
  data.balances[3].cutoff_business_date = '2026-10-01'
  const result = reports(data)
  assertParity(result)
  assert.ok(result.rows.every(r => Number.isInteger(r.rank) && Number.isFinite(r.score)))
  assert.match(result.site, /Incomplete reporting/)
  assert.doesNotMatch(result.site, /Provisional preview|Unranked|no official score/)
})

test('ties and genuine zero values preserve the Budget score/rank model and formatting', () => {
  const data = fixture()
  data.entries = data.entries.map(e => ({ ...data.entries[0], location_id: e.location_id, mtd_membership_actual: 0, current_rating: 0 }))
  data.balances = data.balances.map(b => ({ ...data.balances[0], location_id: b.location_id, amount: 0 }))
  const result = reports(data)
  assertParity(result)
  assert.ok(result.rows.every(r => r.rank === 1))
  assert.equal(result.rows[0].scoringResult.components.growth, 0)
  assert.match(result.site, /\$0\.00/)
})

test('site/market display filtering never changes the competitive pool or an existing site rank', () => {
  const data = fixture(), all = reports(data), selected = reports(data, [data.locations[3]])
  const b = rowsOf(all.budget).find(r => plain(r[1]) === 'Site d')
  const s = rowsOf(selected.site)[0]
  assert.equal(s[8], b[0]); assert.equal(s[16], b[14])
  assert.equal(plain(s[8]), '4')
  assert.deepEqual(selected.pools.sitePool.pool, data.locations)
})

test('periods align on morning entry date; future and non-MTD ranges cannot fabricate Budget scores', () => {
  assert.deepEqual(budgetReportPeriod(dateRange, date), { reportingDate: date, supported: true })
  for (const range of [{ start: '2026-10-02', end: date }, { start: '2026-09-01', end: date }, { start: '2026-10-01', end: '2026-10-04' }]) assert.equal(budgetReportPeriod(range, date).supported, false)
  const result = reports(fixture(), undefined, { start: '2026-10-02', end: date })
  assert.match(result.site, /Legacy range/)
  assert.match(result.budget, /Budget scoring requires a month-to-date range/)
  assert.equal(result.pools.sitePool.day, null)
  assert.equal(result.pools.budgetPool.day, null)
})

test('shared row selector ignores other months/future snapshots and uses exactly the existing scoring function', () => {
  const data = fixture(), before = buildBudgetReportRows(data, date)
  data.entries.unshift({ ...data.entries[0], entry_date: '2026-11-01', mtd_membership_actual: 99999 })
  data.targets.unshift({ ...data.targets[0], target_month: '2026-11-01', revenue_goal: 1 })
  data.balances.unshift({ ...data.balances[0], revenue_month: '2026-11-01', amount: 99999 })
  assert.deepEqual(buildBudgetReportRows(data, date), before)
  assert.deepEqual(before.map(r => r.scoringResult), scoreBudgetLocations(data, date).rows)
})

test('non-Budget/excluded locations retain existing metrics but never receive a second score', () => {
  const data = fixture()
  data.locations[2].show_budget_tracking = false
  data.locations[3].exclude_from_reporting = true
  const result = reports(data)
  assert.equal(result.rows.length, 2)
  for (const name of ['Site c','Site d']) {
    const r = rowsOf(result.site).find(r => plain(r[0]).startsWith(name))
    assert.equal(plain(r[8]), 'Unranked'); assert.equal(plain(r[16]), '—')
  }
})

test('sorting and exports retain scoring columns and sort official incomplete scores numerically', () => {
  const data = fixture(); data.entries[3].current_rating = null
  const budgetRows = buildBudgetReportRows(data, date)
  let spec
  const globals = { ...kpiTableBindings(), ...helpers, ...colors, ...display, pct1, fmtNum, BudgetScoreDetails: details.default, formatBudgetScore: details.formatBudgetScore, BudgetSourceNote: Placeholder,
    ExportMenu: Placeholder, fmtDateRange: () => 'October', exportCsv: value => { spec = value } }
  const source = { totals: budgetRows.map(r => budgetPerformanceRow(r.entry, 'mtd', '2026-10-02')).filter(Boolean), notes: [] }
  const h = locationHelpHarness('components/SiteMetricTable', globals, { source, locations: data.locations, dateRange, budgetRows }, 'PerformanceTable')
  const csv = () => h.find(n => n.type === Placeholder && n.props.items).props.items[2].run()
  csv(); assert.equal(spec.columns.length, 17)
  assert.ok(spec.rows.every(r => r.length === 17)); assert.equal(spec.totalsRow.length, 17)
  assert.match(spec.rows.at(-1)[0], /Site d/)
  h.find(n => n.type === 'button' && n.props.children?.[0] === 'Score').props.onClick()
  csv(); assert.match(spec.rows.at(-1)[0], /Site a/)
  h.find(n => n.type === 'button' && n.props.children?.[0] === 'Total Members').props.onClick()
  csv(); assert.equal(spec.rows[0][10], '107')
  h.unmount()
})


function reportHook(client, locations, day = date) {
  const hooks = []; let cursor, queue, dirty, output, currentLocations = locations, currentDay = day, live = true
  const useState = initial => {
    const i = cursor++; if (!(i in hooks)) hooks[i] = initial
    return [hooks[i], value => { if (live) { hooks[i] = value; dirty = true } }]
  }
  const useRef = initial => hooks[cursor++] ||= { current: initial }
  const useEffect = (fn, deps) => {
    const i = cursor++, old = hooks[i]
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) queue.push(() => { old?.stop?.(); hooks[i] = { deps, stop: fn() } })
  }
  const source = readFileSync(new URL('../src/hooks/useBudgetReport.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const mod = { exports: {} }
  const bindings = { useState, useEffect, useRef, buildBudgetReportRows, revenueMonthStart: d => d.slice(0,7) + '-01', ...client }
  new Function('module','exports', ...Object.keys(bindings), transformSync(source, { format: 'cjs' }).code)(mod, mod.exports, ...Object.values(bindings))
  const render = () => { do { dirty = false; cursor = 0; queue = []; output = mod.exports.default(currentLocations, currentDay); queue.forEach(fn => fn()) } while (dirty); return output }
  return { render, props(locations, day) { currentLocations = locations; currentDay = day; return render() },
    async flush() { for (let i=0; i<12; i++) { await Promise.resolve(); render() } return output },
    unmount() { hooks.forEach(h => h?.stop?.()); live = false },
  }
}
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function reads() {
  const requests = [], watches = []
  return {
    requests, watches,
    supabase: { from(table) { assert.equal(table, 'budget_targets'); return { select() { return this }, in(field, ids) { assert.equal(field, 'location_id'); this.ids = ids; return this }, eq(field, month) { const d=deferred(); requests.push({ ...d, ids: this.ids, field, month }); return d.promise } } } },
    fetchRevenueEntries(_client, ids, day) { requests.at(-1).entryScope = { ids, day }; return Promise.resolve(fixture().entries.filter(e => ids.includes(e.location_id))) },
    fetchStartingBalances(_client, ids, day) { requests.at(-1).balanceScope = { ids, day }; return Promise.resolve(fixture().balances.filter(e => ids.includes(e.location_id))) },
    watchBudgetReport(load) { const watcher={load,stopped:false}; watches.push(watcher); return () => { watcher.stopped=true } },
  }
}

test('shared loader reads identical month, entry and balance scopes, preserves peers, and ignores late prior-scope responses', async () => {
  const client = reads(), data=fixture(), h=reportHook(client,data.locations)
  assert.equal(h.render().loading,true)
  assert.deepEqual(client.requests[0].entryScope,{ids:['a','b','c','d'],day:date})
  assert.deepEqual(client.requests[0].balanceScope,client.requests[0].entryScope)
  assert.equal(client.requests[0].month,'2026-10-01')
  h.props([data.locations[1]],date)
  assert.equal(client.watches[0].stopped,true)
  client.requests[1].resolve({data:data.targets});await h.flush()
  assert.equal(h.render().rows[0].loc.id,'b')
  client.requests[0].reject(new Error('late prior scope'));await h.flush()
  assert.equal(h.render().error,'');assert.equal(h.render().rows[0].loc.id,'b')
  h.unmount();assert.equal(client.watches.at(-1).stopped,true)
})

test('shared refresh updates scores from corrections, ignores overlapping older reads, and fails closed on read errors', async () => {
  const client=reads(),data=fixture(),h=reportHook(client,data.locations)
  h.render();client.requests[0].resolve({data:data.targets});await h.flush()
  const before=h.render().rows.find(r=>r.loc.id==='a').score
  const first=client.watches[0].load(),second=h.render().refresh()
  const corrected=data.targets.map(t=>({...t,desired_rating: t.location_id==='a'?5:t.desired_rating}))
  client.requests[2].resolve({data:corrected});await second;await h.flush()
  const after=h.render().rows.find(r=>r.loc.id==='a').score
  assert.notEqual(after,before)
  client.requests[1].resolve({data:data.targets});await first;await h.flush()
  assert.equal(h.render().rows.find(r=>r.loc.id==='a').score,after)
  const failed=h.render().refresh();client.requests[3].resolve({error:new Error('denied')});await failed;await h.flush()
  assert.equal(h.render().rows.length,0);assert.match(h.render().error,/Unable to load/)
  h.unmount()
})

test('unsupported period and empty location scopes issue no Budget queries and cannot reuse previous rows', async () => {
  const client=reads(),h=reportHook(client,fixture().locations,null)
  h.render();await h.flush();assert.equal(client.requests.length,0);assert.deepEqual(h.render().rows,[])
  h.props([],date);await h.flush();assert.equal(client.requests.length,0);assert.deepEqual(h.render().rows,[])
  h.unmount()
})

test('zero-data eligible locations display official 0.0 and a numeric rank in both scored Reports views',()=>{
 const data=fixture();data.entries=[];data.balances=[]
 const result=reports(data)
 assert.ok(result.rows.every(r=>r.score===0 && r.rank===1))
 for(const row of rowsOf(result.budget)){assert.equal(plain(row[0]),'1');assert.match(plain(row[14]),/^0.0/)}
 for(const html of [result.budget,result.site]){
  assert.doesNotMatch(html,/Unranked|Provisional preview|no official score/)
  assert.match(html,/Last entry: None this month/)
  assert.match(html,/Official score: 0.0 \/ 100 · Rank: 1/)
  assert.match(html,/Incomplete reporting/)
 }
 const siteRows=rowsOf(result.site).filter(row=>plain(row[0]).startsWith('Site '))
 for(const row of siteRows){assert.equal(plain(row[8]),'1');assert.match(plain(row[16]),/^0.0/)}
})

test('shared KPI table retains supported stale score/rank, reporting dates and provisional revenue labels in exports',()=>{
 const data=fixture();data.entries[0].entry_date='2026-10-02';data.balances[0].cutoff_business_date='2026-10-01'
 const budgetRows=buildBudgetReportRows(data,date),row=budgetRows.find(r=>r.loc.id==='a')
 let spec
 const globals={...kpiTableBindings(),...helpers,...colors,...display,pct1,fmtNum,BudgetScoreDetails:details.default,formatBudgetScore:details.formatBudgetScore,BudgetSourceNote:Placeholder,
  ExportMenu:Placeholder,fmtDateRange:()=> 'October',exportCsv:value=>{spec=value}}
 const source={notes:[],totals:budgetRows.map(r=>budgetPerformanceRow(r.entry,'mtd',r.scoringResult.businessDate)).filter(Boolean)}
 const h=locationHelpHarness('components/SiteMetricTable',globals,{source,locations:data.locations,dateRange,budgetRows,title:'MTD Performance'},'PerformanceTable')
 h.find(n=>n.type===Placeholder&&n.props.items).props.items[2].run()
 const exported=spec.rows.find(r=>r[0]==='Site a')
 assert.equal(exported[8],row.rank);assert.equal(exported[16],row.score.toFixed(1))
 const html=renderToStaticMarkup(h.render())
 assert.match(html,/Last entry: 2026-10-02/)
 assert.match(html,/Provisional source; not complete verified MTD actual revenue/)
 assert.match(html,/Stale entry/)
 assert.doesNotMatch(html,/no official score|Provisional preview/)
})
