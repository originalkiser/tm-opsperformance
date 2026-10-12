import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCreditCardInput, creditCardInputError, calculateCreditCardOnEnter } from '../src/utils/creditCardCalculator.js'
import { dailyPayload, cashRevenue, calculateMtdRevenue } from '../src/utils/budgetRevenue.js'
import { REVENUE_FIELDS, validateRevenue } from '../src/utils/budgetDailyFields.js'

test('exact revenue labels are shared by Manager and Admin fields', () => {
  assert.deepEqual(REVENUE_FIELDS.map(field => field.label), [
    'YESTERDAY TOTAL TO ACCOUNT FOR / TOTAL PAYMENTS ($)',
    'YESTERDAY CREDIT CARD REVENUE ($)',
    'YESTERDAY HOUSE ACCOUNT / OTHER TENDERS ($)',
  ])
})
test('addition calculates exact integer cents, including spaces and zero', () => {
  assert.equal(calculateCreditCardInput('45.25+120+1000'), '1165.25')
  assert.equal(calculateCreditCardInput(' 0.10 + 0.20 + 0 '), '0.30')
  assert.equal(calculateCreditCardInput('0'), '0.00')
  assert.equal(calculateCreditCardInput('9999999999.98 + 0.01'), '9999999999.99')
})
test('invalid expressions and overflow cannot resolve or save', () => {
  for (const input of ['', '+1', '1+', '1++2', '-1+2', '1-2', '1*2', '1/2', '1.001+2', '1e2', 'Infinity', 'NaN', '1 2+3', '1+alert(1)', '9999999999.99+0.01']) {
    assert.throws(() => calculateCreditCardInput(input), undefined, input)
    assert.throws(() => dailyPayload({ yesterday_total_revenue: 2000, yesterday_cc_revenue: input || '1+', yesterday_house_revenue: 0 }, 'test', '2026-10-12'))
    if (input) assert.ok(creditCardInputError(input))
  }
})
test('Enter resolves without submitting, Tab is untouched and invalid Enter keeps input', () => {
  let prevented = 0, stopped = 0, result = null
  const event = { key: 'Enter', preventDefault() { prevented++ }, stopPropagation() { stopped++ } }
  calculateCreditCardOnEnter(event, '45.25+120+1000', value => { result = value })
  assert.equal(result, '1165.25'); assert.equal(prevented, 1); assert.equal(stopped, 1)
  calculateCreditCardOnEnter({ ...event, key: 'Tab' }, '1+2', () => assert.fail('Tab calculated'))
  assert.equal(prevented, 1)
  calculateCreditCardOnEnter(event, '1+', () => assert.fail('Invalid expression resolved'))
  assert.equal(prevented, 2)
})
test('unresolved expression is blocked; resolved amount saves numerically without changing Cash/MTD rules', () => {
  const form = { yesterday_total_revenue: 1200, yesterday_cc_revenue: '45.25+120+1000', yesterday_house_revenue: 10 }
  assert.match(creditCardInputError(form.yesterday_cc_revenue), /Press Enter/)
  assert.match(validateRevenue(form), /Press Enter/)
  assert.equal(cashRevenue(form), null)
  assert.throws(() => dailyPayload(form, 'test', '2026-10-12'))
  form.yesterday_cc_revenue = calculateCreditCardInput(form.yesterday_cc_revenue)
  assert.equal(creditCardInputError(form.yesterday_cc_revenue), null)
  const payload = dailyPayload(form, 'test', '2026-10-12')
  assert.equal(payload.yesterday_cc_revenue, 1165.25)
  assert.equal(typeof payload.yesterday_cc_revenue, 'number')
  assert.equal(cashRevenue(form), 24.75)
  const baseline = { location_id: 'test', revenue_month: '2026-10-01', cutoff_business_date: '2026-10-10', amount: 1000 }
  assert.equal(calculateMtdRevenue([payload], 'test', '2026-10-12', baseline).total, 2200)
  assert.equal(calculateMtdRevenue([payload], 'test', '2026-11-01', baseline).total, 0)
})
