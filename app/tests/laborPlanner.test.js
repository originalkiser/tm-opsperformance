import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePlan, breakLength, defaults, recommendPlan, summarizeTraffic, sunday } from '../src/utils/laborPlanner.js'
import { getEffectiveSchedule } from '../src/utils/operatingHours.js'
import { isViewReadRequest } from '../src/utils/managerViewPolicy.js'

const inputs = {
  hours: getEffectiveSchedule({ active: 'standard' }),
  settings: defaults, budget: { method: 'hours', hourly: 205, combined: 250 }, traffic: {},
}
const shift = (overrides = {}) => ({ day: 1, role: 'TL 1', employeeId: 'one', start: 420, end: 780, breakStart: 660, ...overrides })

test('counts paid and unpaid breaks and GM admin separately from floor time', () => {
  const gm = shift({ role: 'GM', employeeId: 'gm', end: 1020, adminStart: 660, breakStart: null })
  const six = shift()
  const long = shift({ role: 'CWA 1', employeeId: 'two', end: 810, breakStart: 720 })
  const analysis = analyzePlan([gm, six, long], inputs, ['one', 'two', 'gm'].map(id => ({ id })))
  assert.equal(breakLength(six), 15)
  assert.equal(breakLength(long), 30)
  assert.deepEqual([analysis.gmMinutes, analysis.hourly, analysis.combined], [600, 720, 1320])
  assert.equal(analysis.coverage.find(row => row.day === 1 && row.hour === 660).minimum, 1)
  assert.ok(analysis.warnings.some(w => w.includes('a break contributes')))
  assert.ok(analysis.warnings.some(w => w.includes('inadequate closing')))
})

test('weekly recommendation includes five GM days, 45 hours and the Monday admin block', () => {
  const plan = recommendPlan(inputs, 10)
  const gm = plan.filter(s => s.role === 'GM')
  assert.equal(gm.length, 5)
  assert.equal(gm.reduce((sum, s) => sum + s.end - s.start, 0), 2700)
  assert.ok([1, 5, 6].every(day => gm.some(s => s.day === day)))
  assert.equal(gm.find(s => s.day === 1).breakStart, null)
  assert.ok(gm.find(s => s.day === 1).adminStart != null)
  const analysis = analyzePlan(plan, inputs, [])
  assert.ok(analysis.hourly <= 205 * 60)
  assert.ok(analysis.combined <= 250 * 60)
  assert.ok(analysis.warnings.some(w => w.includes('lack an active employee')))
})

test('shows both variances as warnings and rejects generation without an approved full-service cap', () => {
  const low = { ...inputs, budget: { method: 'hours', hourly: 1, combined: 1 } }
  const result = analyzePlan([shift()], low, [])
  assert.ok(result.warnings.includes('Hourly labor exceeds the target excluding GM.'))
  assert.ok(result.warnings.includes('Combined labor exceeds the target including GM.'))
  const percentage = { ...inputs, budget: { method: 'percentage', hourly: null, combined: null } }
  assert.deepEqual(recommendPlan(percentage, 10), [])
  assert.ok(analyzePlan([], percentage, []).warnings.includes('Missing approved full-service hours cap.'))
})

test('detects overlapping assignments across positions', () => {
  const result = analyzePlan([shift(), shift({ role: 'CWA 1', start: 600 })], inputs, [{ id: 'one' }])
  assert.ok(result.warnings.some(w => w.includes('overlapping shifts')))
  assert.equal(result.coverage.find(row => row.day === 1 && row.hour === 600).minimum, 1)
})

test('traffic consolidates split checkpoints, preserves zero, and excludes missing hours', () => {
  const row = (time_slot, total_washes, split_index = 0, log_date = '2026-11-09') => ({ log_date, time_slot, split_index, total_washes })
  const traffic = summarizeTraffic([
    row('08:00:00', 0), row('09:00:00', 5), row('09:00:00', 8, 1), row('11:00:00', 20),
    row('08:00:00', 2, 0, '2026-11-16'), row('09:00:00', 11, 0, '2026-11-16'),
    row('08:00:00', 100, 0, '2026-11-23'), row('08:00:00', 100, 0, '2026-10-19'),
  ], '2026-11-22')
  assert.deepEqual(traffic['1:480'], { average: 1, samples: 2 })
  assert.deepEqual(traffic['1:540'], { average: 8.5, samples: 2 })
  assert.equal(traffic['1:420'], undefined)
  assert.equal(traffic['1:660'], undefined)
  assert.equal(sunday('2026-11-24'), '2026-11-22')
})

test('Manager View allows loading only, not draft saves or cap approval', async () => {
  const route = name => 'https://example.test/rest/v1/rpc/' + name
  assert.equal(await isViewReadRequest(route('weekly_labor_planner'), { method: 'POST' }), true)
  for (const method of ['save_weekly_labor_plan', 'approve_weekly_labor_cap']) {
    assert.equal(await isViewReadRequest(route(method), { method: 'POST' }), false)
  }
})

test('fills traffic-driven peak coverage only after mandatory coverage fits', () => {
  const winter = { ...inputs, hours: getEffectiveSchedule({ active: 'winter' }),
    traffic: { '2:720': { average: 100, samples: 4 } } }
  const generated = analyzePlan(recommendPlan(winter, 12), winter, [])
  assert.ok(generated.coverage.every(row => !row.gap))
  const peak = generated.coverage.find(row => row.day === 2 && row.hour === 720)
  assert.deepEqual([peak.required, peak.recommended, peak.minimum], [3, 4, 4])
  const constrained = { ...winter, budget: { method: 'hours', hourly: 95, combined: 140 } }
  const result = analyzePlan(recommendPlan(constrained, 12), constrained, [])
  assert.ok(result.coverage.some(row => row.gap))
  assert.ok(result.hourly <= 95 * 60)
})
