import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMtdRevenue, shiftDate, dailyPayload, fetchRevenueEntries, revenueCents } from '../src/utils/budgetRevenue.js'
import { calculateCashRevenue, validateRevenue, emptyDailyForm, countMissing, isDayComplete } from '../src/utils/budgetDailyFields.js'
import { revenuePace } from '../src/utils/budgetMath.js'

const row = (date, total, location = 'test') => ({ location_id: location, entry_date: date, yesterday_total_revenue: total, yesterday_cc_revenue: 0, yesterday_house_revenue: 0 })
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
