import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetMonthStart, budgetDaysElapsed, calculateMtdRevenue, latestHistoricalRevenue, revenuePresentation, dailyPayload, shiftDate } from '../src/utils/budgetRevenue.js'
import { sumDailyRevenueGoals, fetchDailyRevenueGoals } from '../src/utils/dailyRevenueGoals.js'
import { laborBudget } from '../src/utils/laborBudget.js'
import { revenueDisplayPlan } from '../src/utils/budgetDisplay.js'
import { computeMembershipGoal, membershipPace } from '../src/utils/budgetMath.js'
import { scoreBudgetLocations, SCORE_WEIGHTS } from '../src/utils/budgetScoring.js'

const report = (date, amount) => ({ location_id: 'fictional', entry_date: date, mtd_revenue_actual: amount })
const goal = (date, total) => ({ location_id: 'fictional', business_date: date, total, retail: '0', recurring: total })

test('latest valid cumulative report wins without summing reports or requiring earlier submissions', () => {
  const entries = [report('2026-11-02', '50'), report('2026-11-06', '250.25'), report('2026-11-07', '-1'), report('2026-11-10', '999')]
  const latest = latestHistoricalRevenue(entries, 'fictional', '2026-11-09')
  assert.deepEqual(latest, { amount: 250.25, entryDate: '2026-11-06' })
  assert.equal(revenuePresentation({ complete: true, total: 1000, throughDate: '2026-11-08' }, latest).amount, 250.25)
  assert.equal(revenuePresentation({ complete: false, recordedTotal: 90 }, latest).throughDate, '2026-11-05')
  assert.equal(revenuePresentation({ complete: false, recordedTotal: 90 }, null).amount, null)
  assert.equal(revenuePresentation({ complete: true, total: 90, throughDate: '2026-11-08' }, null).amount, 90)
  assert.equal(latestHistoricalRevenue([report('2026-11-06', 1), report('2026-11-06', 2), report('2026-11-02', 0)], 'fictional', '2026-11-09').amount, 0)
})

test('reported MTD saves explicitly, rejects invalid input, and blank preserves an existing value', () => {
  assert.equal(dailyPayload({ mtd_revenue_actual: '120.50' }, 'fictional', '2026-11-02').mtd_revenue_actual, 120.5)
  assert.equal(Object.hasOwn(dailyPayload({ mtd_revenue_actual: '' }, 'fictional', '2026-11-02'), 'mtd_revenue_actual'), false)
  assert.throws(() => dailyPayload({ mtd_revenue_actual: '12.345' }, 'fictional', '2026-11-02'))
})

test('daily budgets retain decimal precision and distinguish zero, missing and duplicate dates', () => {
  const rows = [goal('2026-11-01', '0.123456789012345'), goal('2026-11-02', '0.000000000000005')]
  assert.equal(sumDailyRevenueGoals(rows, 'fictional', '2026-11-02').decimal, '0.123456789012350')
  assert.equal(sumDailyRevenueGoals([goal('2026-11-01', '0')], 'fictional', '2026-11-01').amount, 0)
  assert.equal(sumDailyRevenueGoals(rows, 'fictional', '2026-11-03').amount, null)
  assert.deepEqual(sumDailyRevenueGoals([...rows, rows[0]], 'fictional', '2026-11-02').invalidDates, ['2026-11-01'])
})

test('600 fictional site/date budgets reconcile without per-day cent rounding', () => {
  const rows = Array.from({ length: 20 }, (_, site) => Array.from({ length: 30 }, (_, day) => ({ ...goal(shiftDate('2026-11-01', day), '1.0001'), location_id: String(site) }))).flat()
  assert.equal(rows.length, 600)
  for (let site = 0; site < 20; site++) assert.equal(sumDailyRevenueGoals(rows, String(site), '2026-11-30').decimal, '30.0030')
})

test('stale actuals compare to daily goals at their own business date', () => {
  const historical = { amount: 150, entryDate: '2026-11-03' }
  const plan = revenueDisplayPlan({ complete: false }, historical, 1000, '2026-11-10', [goal('2026-11-01', '50'), goal('2026-11-02', '100'), goal('2026-11-03', '900')], 'fictional')
  assert.equal(plan.expected, 150)
  assert.equal(plan.progress, 0.15)
  assert.equal(plan.onTrack, true)
  assert.equal(revenueDisplayPlan({ complete: false }, historical, 1000, '2026-11-10').expected, null)
})

test('December 1 closes November with thirty days and reuses membership calculations', () => {
  assert.equal(budgetMonthStart('2026-12-01'), '2026-11-01')
  assert.equal(budgetDaysElapsed('2026-12-01'), 30)
  const rows = Array.from({ length: 30 }, (_, day) => ({ location_id: 'fictional', entry_date: shiftDate('2026-11-02', day), yesterday_total_revenue: 10, yesterday_cc_revenue: 10, yesterday_house_revenue: 0 }))
  assert.equal(calculateMtdRevenue(rows, 'fictional', '2026-12-01').total, 300)
  assert.equal(latestHistoricalRevenue([report('2026-12-01', 300), report('2026-11-01', 999)], 'fictional', '2026-12-01').amount, 300)
  assert.equal(computeMembershipGoal(1000, 2, '2026-11-01'), 1060)
  assert.equal(computeMembershipGoal(null, 2, '2026-11-01'), null)
  assert.equal(membershipPace(1060, 1000, 2, '2026-12-01').expected, 1060)
  assert.equal(membershipPace(1002, 1000, 2, '2026-11-02').expected, 1002)
})

test('scoring consumes the same dated daily plan with unchanged weights', () => {
  const rows = [goal('2026-11-01', '100'), goal('2026-11-02', '200')]
  const input = { locations: [{ id: 'fictional', name: 'Fictional', show_budget_tracking: true }], targets: [{ location_id: 'fictional', target_month: '2026-11-01', revenue_goal: 1000 }], entries: [report('2026-11-03', 150)], dailyGoals: rows }
  const scored = scoreBudgetLocations(input, '2026-11-09').rows[0]
  assert.equal(scored.expectedRevenue, 300)
  assert.equal(scored.components.revenuePlan, 7.5)
  assert.equal(scored.reportedThrough, '2026-11-02')
  assert.deepEqual(SCORE_WEIGHTS, { conversion: 20, revenue: 20, pmix: 10, washes: 10, revenuePlan: 15, growth: 15, rating: 10 })
})

test('daily-goal reader paginates exact text decimals and closes November on December 1', async () => {
  const calls = []
  const client = { from(table) {
    assert.equal(table, 'budget_daily_revenue_goals')
    return { select(columns) { assert.match(columns, /total:total_revenue_goal::text/); return this },
      in(key, ids) { assert.deepEqual(ids, ['fictional']); return this },
      gte(key, date) { assert.equal(date, '2026-11-01'); return this },
      lte(key, date) { assert.equal(date, '2026-11-30'); return this }, order() { return this },
      async range(start, end) { calls.push([start, end]); return { data: Array(start === 0 ? 500 : 100).fill(goal('2026-11-01', '1.000000000000000001')) } } }
  } }
  const rows = await fetchDailyRevenueGoals(client, ['fictional'], '2026-12-01')
  assert.equal(rows.length, 600)
  assert.equal(rows[0].total, '1.000000000000000001')
  assert.deepEqual(calls, [[0,499],[500,999]])
  assert.deepEqual(await fetchDailyRevenueGoals(client, [], '2026-12-01'), [])
  assert.deepEqual(await fetchDailyRevenueGoals(client, ['fictional'], '2026-10-15'), [])
})

test('daily-goal read errors or lossy numeric transport cannot become valid partial plans', async () => {
  let call = 0
  const client = { from() { return { select() { return this }, in() { return this }, gte() { return this }, lte() { return this }, order() { return this },
    async range() { return ++call === 1 ? { data: Array(500).fill(goal('2026-11-01', '1')) } : { data: null, error: new Error('denied') } } } } }
  await assert.rejects(fetchDailyRevenueGoals(client, ['fictional'], '2026-11-03'), /denied/)
  client.from = () => ({ select() { return this }, in() { return this }, gte() { return this }, lte() { return this }, order() { return this }, async range() { return { data: [{ ...goal('2026-11-01','1'), total: 1 }] } } })
  await assert.rejects(fetchDailyRevenueGoals(client, ['fictional'], '2026-11-03'), /exact decimal strings/)
})

test('percentage budgets suppress zero placeholder hour allowances and zero percentage is explicit', () => {
  assert.deepEqual(laborBudget({ full_service_labor_percentage: '0.35', labor_hours_non_salary: 0, labor_hours_with_salary: 0 }), {
    method: 'percentage', percentage: 0.35, hours: null, hoursWithManager: null,
  })
  assert.equal(laborBudget({ full_service_labor_percentage: 0 }).method, 'percentage')
  assert.equal(laborBudget({ full_service_labor_percentage: null, labor_hours_non_salary: 170 }).hours, 170)
})
