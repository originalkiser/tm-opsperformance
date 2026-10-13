import test from 'node:test'
import assert from 'node:assert/strict'
import { applicableCashCents, cashBusinessDate, cashCountError, fetchCashSetting, reconcileCash } from '../src/utils/cashReconciliation.js'
import { dailyPayload } from '../src/utils/budgetRevenue.js'

const form = count => ({ yesterday_total_revenue: '1165.25', yesterday_cc_revenue: '1000', yesterday_house_revenue: '46.25', yesterday_cash_counted: count })
test('cash reconciliation uses exact cents for matches, shortages and overages', () => {
  const exact = reconcileCash(form('969'), 85000)
  assert.deepEqual(exact, { revenue: 11900, hand: 85000, expected: 96900, count: 96900, deposit: 11900, variance: 0, status: 'green' })
  assert.equal(reconcileCash(form('968.99'), 85000).variance, -1)
  assert.equal(reconcileCash(form('969.01'), 85000).variance, 1)
  assert.equal(reconcileCash(form('0'), 85000).deposit, -85000)
  assert.equal(reconcileCash(form('0'), 85000).status, 'red')
})
test('missing/invalid amounts are neutral; explicit zero is valid', () => {
  for (const count of ['', null, undefined, '-1', '1.001', '1e2', 'NaN']) assert.equal(reconcileCash(form(count), 85000).status, 'neutral')
  assert.equal(reconcileCash(form('969'), null).status, 'neutral')
  assert.equal(reconcileCash({ ...form('969'), yesterday_total_revenue: '' }, 85000).status, 'neutral')
  assert.equal(reconcileCash({ ...form('969'), yesterday_cc_revenue: '2000' }, 85000).status, 'neutral')
  assert.equal(reconcileCash({ yesterday_total_revenue: '0', yesterday_cc_revenue: '0', yesterday_house_revenue: '0', yesterday_cash_counted: '0' }, 0).status, 'green')
  assert.ok(cashCountError('1.001')); assert.equal(cashCountError(''), '')
})
test('red discrepancies save actual numeric counts; invalid counts do not save', () => {
  assert.equal(dailyPayload(form('970.01'), 'site', '2026-10-13').yesterday_cash_counted, 970.01)
  assert.equal(dailyPayload(form(''), 'site', '2026-10-13').yesterday_cash_counted, null)
  assert.throws(() => dailyPayload(form('1.001'), 'site', '2026-10-13'))
})
test('next-morning mapping crosses month/year and leap day correctly', () => {
  assert.equal(cashBusinessDate('2026-10-13'), '2026-10-12')
  assert.equal(cashBusinessDate('2026-11-01'), '2026-10-31')
  assert.equal(cashBusinessDate('2027-01-01'), '2026-12-31')
  assert.equal(cashBusinessDate('2028-03-01'), '2028-02-29')
})
test('submitted snapshot wins over subsequent Admin versions; historical query is date bounded', async () => {
  assert.equal(applicableCashCents({ cash_on_hand_version_id: 1, cash_on_hand_cents: 85000 }, { amount_cents: 90000 }), 85000)
  assert.equal(applicableCashCents(null, { amount_cents: 90000 }), 90000)
  assert.equal(applicableCashCents(null, null), null)
  assert.equal(applicableCashCents({ cash_first_submitted_at: '2026-10-01T12:00:00Z', cash_on_hand_cents: null }, { amount_cents: 90000 }), null)
  const calls = []; const query = {}
  for (const key of ['select','eq','lte','order','limit']) query[key] = (...args) => { calls.push([key,...args]); return query }
  query.maybeSingle = async () => ({ data: { amount_cents: 85000 } })
  await fetchCashSetting({ from: name => { assert.equal(name,'cash_on_hand_versions'); return query } }, 'site', '2026-10-12')
  assert.ok(calls.some(call => call[0] === 'lte' && call[1] === 'effective_date' && call[2] === '2026-10-12'))
  query.maybeSingle = async () => ({ error: new Error('permission') })
  await assert.rejects(fetchCashSetting({ from: () => query }, 'site', '2026-10-12'))
})
