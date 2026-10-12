import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMtdRevenue, shiftDate, dailyPayload, fetchRevenueEntries, revenueCents, latestHistoricalRevenue, fetchStartingBalances } from '../src/utils/budgetRevenue.js'
import { calculateCashRevenue, validateRevenue, emptyDailyForm, countMissing, isDayComplete } from '../src/utils/budgetDailyFields.js'
import { revenuePace } from '../src/utils/budgetMath.js'

const row = (date, total, location = 'test') => ({ location_id: location, entry_date: date, yesterday_total_revenue: total, yesterday_cc_revenue: 0, yesterday_house_revenue: 0 })
const baseline = { location_id: 'test', revenue_month: '2026-10-01', cutoff_business_date: '2026-10-10', amount: '63638.80' }
test('October cutoff includes October 11 exactly once, including later manager corrections', () => {
  const entries = [row('2026-10-12', 7000), row('2026-10-13', '100.10'), row('2026-10-14', '200.20')]
  entries.push(row('2026-10-11', 9000)) // October 10 is already in the balance.
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-12', baseline).total, 70638.8)
  entries[3].yesterday_total_revenue = 9500
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-12', baseline).total, 70638.8)
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-14', baseline).total, 70939.1)
  entries[0].yesterday_total_revenue = 9999
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-14', baseline).total, 73938.1)
  entries[1].yesterday_total_revenue = '150.10'
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-14', baseline).total, 73988.1)
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-14', { ...baseline, amount: '64000' }).total, 74349.3)
})
test('post-cutoff missing or invalid figures suppress totals and pace until corrected', () => {
  const firstMissing = calculateMtdRevenue([], 'test', '2026-10-12', baseline)
  assert.deepEqual(firstMissing.missingDates, ['2026-10-11'])
  assert.equal(firstMissing.total, null)
  const entries = [row('2026-10-14', 100)]
  let result = calculateMtdRevenue(entries, 'test', '2026-10-14', baseline)
  assert.deepEqual(result.missingDates, ['2026-10-11', '2026-10-12'])
  assert.equal(result.total, null)
  assert.equal(revenuePace(result.total, 100000, 0.4).onTrack, null)
  entries.push({ ...row('2026-10-13', 200), yesterday_cc_revenue: 201 })
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-14', baseline).total, null)
  entries[1].yesterday_cc_revenue = 0
  entries.push(row('2026-10-12', 50)) // Returning manager fills missed October 11.
  result = calculateMtdRevenue(entries, 'test', '2026-10-14', baseline)
  assert.equal(result.total, 63988.8)
  assert.equal(revenuePace(result.total, 100000, 0.4).onTrack, true)
})
test('October balance never applies to earlier dates, other sites or November', () => {
  assert.equal(calculateMtdRevenue([], 'test', '2026-10-10', baseline).startingBalance, null)
  assert.equal(calculateMtdRevenue([], 'test', '2026-10-11', baseline).total, 63638.8)
  assert.equal(calculateMtdRevenue([], 'other', '2026-10-12', baseline).total, null)
  assert.equal(calculateMtdRevenue([], 'test', '2026-11-01', baseline).total, 0)
  assert.equal(calculateMtdRevenue([row('2026-11-02', 500)], 'test', '2026-11-02', baseline).total, 500)
  assert.equal(calculateMtdRevenue([row('2026-10-12', 0)], 'test', '2026-10-12', { ...baseline, amount: 0 }).total, 0)
  assert.throws(() => calculateMtdRevenue([], 'test', '2026-10-12', { ...baseline, cutoff_business_date: '2026-10-11' }))
})
test('starting-balance read errors cannot silently fall back; November skips October reads', async () => {
  const client = { from() { return { select() { return this }, in() { return this }, eq() { return { data: null, error: new Error('denied') } } } } }
  await assert.rejects(fetchStartingBalances(client, ['test'], '2026-10-12'), /denied/)
  assert.deepEqual(await fetchStartingBalances(client, ['test'], '2026-11-01'), [])
})
test('transition finds latest recorded historical reference despite newer blank entries', () => {
  const entries = [
    { location_id: 'test', entry_date: '2026-10-09', mtd_revenue_actual: 60000 },
    { location_id: 'test', entry_date: '2026-10-11', mtd_revenue_actual: '63638.80' },
    row('2026-10-12', 100),
    { location_id: 'other', entry_date: '2026-10-12', mtd_revenue_actual: 999999 },
    { location_id: 'test', entry_date: '2026-10-13', mtd_revenue_actual: 999999 },
  ]
  const before = JSON.stringify(entries)
  assert.deepEqual(latestHistoricalRevenue(entries, 'test', '2026-10-12'), { amount: 63638.8, entryDate: '2026-10-11' })
  const automatic = calculateMtdRevenue(entries, 'test', '2026-10-12')
  assert.equal(automatic.total, null)
  assert.equal(automatic.recordedTotal, 100)
  assert.equal(revenuePace(automatic.total, 100000, 0.4).onTrack, null)
  assert.equal(JSON.stringify(entries), before)
})
test('historical reference does not carry into another month and zero is valid', () => {
  const entries = [{ location_id: 'test', entry_date: '2026-10-31', mtd_revenue_actual: 63638.8 }]
  assert.equal(latestHistoricalRevenue(entries, 'test', '2026-11-02'), null)
  entries.push({ location_id: 'test', entry_date: '2026-11-01', mtd_revenue_actual: 0 })
  assert.deepEqual(latestHistoricalRevenue(entries, 'test', '2026-11-02'), { amount: 0, entryDate: '2026-11-01' })
})
test('next month switches to automatic totals without backfilling transition month', () => {
  const entries = [row('2026-10-12', 100), row('2026-11-02', 200), row('2026-11-03', 300)]
  const result = calculateMtdRevenue(entries, 'test', '2026-11-03')
  assert.equal(result.complete, true)
  assert.equal(result.total, 500)
  assert.equal(revenuePace(result.total, 1000, 0.1).onTrack, true)
})
test('cash is exact cents and remains blank until every component exists', () => {
  assert.equal(calculateCashRevenue({ yesterday_total_revenue: '0.30', yesterday_cc_revenue: '0.10', yesterday_house_revenue: '0.20' }), 0)
  assert.equal(calculateCashRevenue({ yesterday_total_revenue: 100 }), null)
  assert.equal(calculateCashRevenue({ yesterday_total_revenue: 5825, yesterday_cc_revenue: 5500, yesterday_house_revenue: 525 }), -200)
})
test('invalid entered amounts are rejected even if another amount is blank', () => {
  for (const value of ['-1', '-0.001', '1.001', 'Infinity', 'NaN', ' ', '1e2', '10000000000']) {
    assert.ok(validateRevenue({ yesterday_total_revenue: value, yesterday_cc_revenue: '', yesterday_house_revenue: '' }), value)
  }
  assert.ok(validateRevenue({ yesterday_total_revenue: 10, yesterday_cc_revenue: 9, yesterday_house_revenue: 2 }))
  assert.equal(revenueCents('9999999999.99'), 999999999999)
})
test('MTD shifts entry dates, excludes other sites, future entries and prior month business', () => {
  const result = calculateMtdRevenue([row('2026-10-01', 999), row('2026-10-02', '100.10'), row('2026-10-03', '200.20'), row('2026-10-04', 999), row('2026-10-02', 999, 'other')], 'test', '2026-10-03')
  assert.equal(result.total, 300.30)
  assert.equal(result.complete, true)
})
test('first of month is zero, including year rollover', () => {
  assert.equal(calculateMtdRevenue([row('2027-01-01', 5000)], 'test', '2027-01-01').total, 0)
  assert.equal(shiftDate('2027-01-01', -1), '2026-12-31')
})
test('missing dates do not become zeros; explicit zero is a complete business day', () => {
  const result = calculateMtdRevenue([row('2026-10-02', 0), row('2026-10-04', 250)], 'test', '2026-10-04')
  assert.equal(result.total, null)
  assert.equal(result.recordedTotal, 250)
  assert.deepEqual(result.missingDates, ['2026-10-02'])
  assert.equal(revenuePace(result.total, 1000, 0.1).onTrack, null)
})
test('invalid existing amounts and duplicate dates cannot produce complete totals', () => {
  assert.equal(calculateMtdRevenue([row('2026-10-02', -1)], 'test', '2026-10-02').total, null)
  assert.throws(() => calculateMtdRevenue([row('2026-10-02', 1), row('2026-10-02', 2)], 'test', '2026-10-02'))
})
test('an incomplete revenue breakdown is not counted as a complete business day', () => {
  const partial = { ...row('2026-10-02', 100), yesterday_house_revenue: null }
  const result = calculateMtdRevenue([partial], 'test', '2026-10-02')
  assert.equal(result.total, null)
  assert.deepEqual(result.missingDates, ['2026-10-01'])
})
test('corrections recompute later totals rather than keeping stale snapshots', () => {
  const entries = [row('2026-10-02', 100), row('2026-10-03', 200)]
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-03').total, 300)
  entries[0].yesterday_total_revenue = 150
  assert.equal(calculateMtdRevenue(entries, 'test', '2026-10-03').total, 350)
})
test('leap day, month end and DST use calendar dates', () => {
  assert.equal(shiftDate('2028-03-01', -1), '2028-02-29')
  assert.equal(shiftDate('2026-11-02', -1), '2026-11-01')
  const entries = Array.from({ length: 29 }, (_, i) => row(shiftDate('2028-02-01', i + 1), 1))
  assert.equal(calculateMtdRevenue(entries, 'test', '2028-02-29').total, 28)
})
test('saving excludes historical MTD column and completion ignores computed MTD', () => {
  const form = Object.fromEntries(Object.keys(emptyDailyForm()).map(key => [key, 0]))
  form.mtd_revenue_actual = 12345
  const payload = dailyPayload(form, 'test', '2026-10-02')
  assert.equal(Object.hasOwn(payload, 'mtd_revenue_actual'), false)
  assert.equal(countMissing(form), 0)
  assert.equal(isDayComplete(payload), true)
  assert.equal(isDayComplete({ ...payload, yesterday_total_revenue: '' }), false)
})
test('historical cumulative records alone are retained but not treated as daily totals', () => {
  const historical = { location_id: 'test', entry_date: '2026-10-02', mtd_revenue_actual: 4000 }
  assert.equal(calculateMtdRevenue([historical], 'test', '2026-10-02').total, null)
  assert.equal(historical.mtd_revenue_actual, 4000)
})
test('reads paginate and reject an error on any page', async () => {
  let calls = 0
  const client = { from() { return { select() { return this }, in() { return this }, gte() { return this }, lte() { return this }, order() { return this }, async range(start, end) {
    calls++
    assert.equal(end - start, 499)
    return { data: calls === 1 ? Array(500).fill(row('2026-10-02', 1)) : [row('2026-10-03', 2)], error: null }
  } } } }
  assert.equal((await fetchRevenueEntries(client, ['test'], '2026-10-03')).length, 501)
  client.from = () => ({ select() { return this }, in() { return this }, gte() { return this }, lte() { return this }, order() { return this }, async range() { return { data: null, error: new Error('offline') } } })
  await assert.rejects(fetchRevenueEntries(client, ['test'], '2026-10-03'), /offline/)
})
