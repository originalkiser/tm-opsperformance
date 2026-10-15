import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPerformanceSources, budgetPerformanceRow, completedCutoff } from '../src/utils/budgetPerformanceSource.js'
import { agg } from '../src/utils/insightsHelpers.js'

const range = { start: '2026-10-01', end: '2026-10-15' }
const locations = [{ id: 'a', name: 'Fictional A', show_budget_tracking: true }, { id: 'b', name: 'Fictional B', show_budget_tracking: false }]
const entry = (date = '2026-10-15', washes = 1000) => ({ location_id: 'a', entry_date: date,
  mtd_washes: washes, mtd_redemptions: 500, mtd_basic: 10, mtd_good: 10, mtd_better: 15, mtd_best: 15, current_reviews: 12,
  yesterday_washes: 100, yesterday_redemptions: 50, yesterday_basic: 1, yesterday_good: 1, yesterday_better: 2, yesterday_best: 1 })
const log = (id, date, washes) => ({ location_id: id, log_date: date, time_slot: '10:00',
  total_washes: washes, member_washes: 0, memberships_sold: 1, opportunities: washes, better: 1, best: 0, google_reviews: 2 })
const select = (logs, entries, sites = locations, dates = range, today = '2026-10-15') => selectPerformanceSources(logs, entries, sites, dates, today)

test('one MTD snapshot replaces all covered partial logs; company rates use weighted totals', () => {
  const logs = [log('a', '2026-10-01', 9999), log('a', '2026-10-14', 9999), log('b', '2026-10-14', 100)]
  const before = structuredClone(logs)
  const source = select(logs, [entry('2026-10-14', 900), entry()])
  const total = agg(source.totals)
  assert.equal(total.tw, 1100)
  assert.equal(total.ms, 51)
  assert.equal(total.opp, 600)
  assert.equal(total.conversion, '8.5%')
  assert.equal(source.notes[0].complete, true)
  assert.deepEqual(logs, before)
})

test('daily charts use next-morning daily entries, never cumulative snapshots or current partial logs', () => {
  const source = select([log('a', '2026-10-15', 8888), log('a', '2026-10-14', 9999)], [entry()])
  assert.equal(source.daily.length, 1)
  assert.equal(source.daily[0].log_date, '2026-10-14')
  assert.equal(source.daily[0].total_washes, 100)
  assert.equal(source.daily[0].google_reviews, null, 'do not fabricate daily reviews from MTD reviews')
  assert.equal(source.totals[0].total_washes, 1000)
})

test('missing/invalid Budget totals remain unavailable instead of falling back to partial logs', () => {
  for (const entries of [[], [{ ...entry(), mtd_washes: null }], [{ ...entry(), mtd_redemptions: 1001 }]]) {
    const source = select([log('a', '2026-10-14', 9999)], entries)
    assert.equal(source.totals.length, 0)
    assert.equal(source.notes[0].complete, false)
    assert.match(source.notes[0].message, /unavailable/)
  }
})

test('older snapshots are explicitly provisional and do not acquire newer log figures', () => {
  const source = select([log('a', '2026-10-14', 9999)], [entry('2026-10-12')])
  assert.equal(source.totals[0].total_washes, 1000)
  assert.equal(source.notes[0].through, '2026-10-11')
  assert.equal(source.notes[0].complete, false)
  assert.match(source.notes[0].message, /Provisional/)
})

test('corrections and newly submitted dates replace the snapshot without duplicating revenue or counts', () => {
  const saved = [entry('2026-10-14', 900), entry()]
  const corrected = saved.map(e => e.entry_date === '2026-10-15' ? { ...e, mtd_washes: 1200 } : e)
  assert.equal(agg(select([], corrected).totals).tw, 1200)
  assert.equal(agg(select([], [...saved, entry('2026-10-16', 1300)], locations,
    { ...range, end: '2026-10-16' }, '2026-10-16').totals).tw, 1300)
  assert.equal(saved[1].mtd_washes, 1000)
})

test('month-end next-morning entries belong to the preceding business month; no carry into November', () => {
  const monthEnd = entry('2026-11-01', 3100)
  const october = select([], [monthEnd], locations, { start: '2026-10-01', end: '2026-10-31' }, '2026-11-02')
  assert.equal(october.totals[0].total_washes, 3100)
  assert.equal(october.notes[0].through, '2026-10-31')
  const november = select([], [monthEnd], locations, { start: '2026-11-01', end: '2026-11-02' }, '2026-11-02')
  assert.equal(november.totals.length, 0)
})

test('non-MTD ranges preserve Daily Log behavior; zero is valid and missing is distinct', () => {
  const logs = [log('a', '2026-10-14', 50)]
  const source = select(logs, [entry()], locations, { start: '2026-10-10', end: '2026-10-14' })
  assert.equal(source.active, false)
  assert.equal(agg(source.totals).tw, 50)
  const zero = Object.fromEntries(Object.keys(entry()).map(k => [k, 0]))
  assert.equal(budgetPerformanceRow(zero, 'mtd', '2026-10-14').total_washes, 0)
  assert.equal(budgetPerformanceRow({ ...zero, mtd_best: '' }, 'mtd', '2026-10-14'), null)
  assert.equal(budgetPerformanceRow({ ...zero, mtd_best: false }, 'mtd', '2026-10-14'), null)
  assert.equal(completedCutoff(range, '2026-10-15'), '2026-10-14')
})
