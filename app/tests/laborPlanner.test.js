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
    budget: { method: 'hours', hourly: 250, combined: 295 }, traffic: { '2:720': { average: 100, samples: 4 } } }
  const generated = analyzePlan(recommendPlan(winter, 12), winter, [])
  assert.ok(generated.coverage.every(row => !row.gap))
  const peak = generated.coverage.find(row => row.day === 2 && row.hour === 720)
  assert.deepEqual([peak.required, peak.recommended, peak.minimum], [3, 6, 6])
  const constrained = { ...winter, budget: { method: 'hours', hourly: 95, combined: 140 } }
  const result = analyzePlan(recommendPlan(constrained, 12), constrained, [])
  assert.ok(result.coverage.some(row => row.gap))
  assert.ok(result.hourly <= 95 * 60)
  const withoutPeaks = recommendPlan({ ...constrained, settings: { ...constrained.settings, peak: 1000 } }, 12)
  assert.deepEqual(recommendPlan(constrained, 12), withoutPeaks)
  const monday = recommendPlan(winter, 12).find(s => s.role === 'GM' && s.day === 1)
  const mondayBreaks = generated.coverage.filter(row => row.day === 1 &&
    row.hour < monday.adminStart + 210 && row.hour + 60 > monday.adminStart)
  assert.ok(mondayBreaks.length > 0 && mondayBreaks.every(row => !row.gap))
})

test('AGM and TL shifts share the tighter of both Express labor limits', () => {
  for (const budget of [
    { method: 'hours', hourly: 28, combined: 200 },
    { method: 'hours', hourly: 200, combined: 73 },
  ]) {
    const constrained = { ...inputs, budget }
    const plan = recommendPlan(constrained, 10)
    const analysis = analyzePlan(plan, constrained, [])
    assert.equal(analysis.gmMinutes, 45 * 60)
    assert.ok(plan.some(s => ['AGM', 'TL 1', 'TL 2'].includes(s.role)))
    assert.ok(analysis.hourly > 0 && analysis.hourly <= 28 * 60)
    assert.equal(analysis.combined, analysis.hourly + 45 * 60)
    assert.ok(analysis.warnings.some(w => /Budget conflict.*28.00 hourly hours/.test(w)))
    assert.ok(analysis.warnings.some(w => /falls short of both mandatory coverage and AGM\/TL hour targets/.test(w)))
  }
  const gm = shift({ role: 'GM', end: 1020, adminStart: 660, breakStart: null })
  const edited = analyzePlan([gm], { ...inputs, budget: { method: 'hours', hourly: 200, combined: 9 } }, [])
  assert.equal(edited.combined, 600)
  assert.ok(edited.warnings.includes('Combined labor exceeds the target including GM.'))
})

test('opening prep defaults to 60 minutes and existing 30-minute drafts keep their settings', () => {
  assert.equal(defaults.prep, 60)
  const winter = { ...inputs, hours: getEffectiveSchedule({ active: 'winter' }) }
  const early = analyzePlan([], winter, []).coverage.find(row => row.day === 1)
  assert.equal(early.hour, 420)
  const changed = { ...winter, settings: { ...defaults, prep: 0 } }
  assert.equal(analyzePlan([], changed, []).coverage.find(row => row.day === 1).hour, 480)
  const legacy = { ...winter, settings: { prep: 30, middayStart: 660, middayEnd: 900, peak: 40 } }
  assert.deepEqual(analyzePlan([], legacy, []).coverage.find(row => row.day === 1 && row.hour === 420).required, 1)
  assert.equal(legacy.settings.prep, 30)
})

test('configurable traffic thresholds scale above four and distinguish zero, sparse and missing data', () => {
  const traffic = {
    '1:480': { average: 0, samples: 4 },
    '1:540': { average: 90, samples: 1 },
    '1:660': { average: 90, samples: 4 },
  }
  const configured = { ...inputs, settings: { ...defaults, peak: 50, peakStep: 20 }, traffic }
  const rows = analyzePlan([], configured, []).coverage.filter(row => row.day === 1)
  assert.deepEqual([480, 540, 600, 660].map(hour => rows.find(row => row.hour === hour).recommended), [2, 2, 2, 6])
  assert.equal(rows.find(row => row.hour === 480).traffic.average, 0)
  assert.equal(rows.find(row => row.hour === 600).traffic, null)
  const { peakStep, ...legacy } = configured.settings
  const saved = analyzePlan([], { ...configured, settings: legacy }, [])
  assert.equal(saved.coverage.find(row => row.day === 1 && row.hour === 660).recommended, 4)
})

test('generated shifts are at least four hours and prefer six where coverage permits', () => {
  const winter = { ...inputs, hours: getEffectiveSchedule({ active: 'winter' }),
    budget: { method: 'hours', hourly: 250, combined: 295 } }
  const shifts = recommendPlan(winter, 12)
  assert.ok(shifts.length > 0)
  assert.ok(shifts.every(s => s.end - s.start >= 240))
  const hourly = shifts.filter(s => s.role !== 'GM')
  assert.ok(hourly.some(s => s.end - s.start === 360))
  assert.ok(hourly.some(s => s.end - s.start > 360))
  assert.ok(analyzePlan([shift({ end: 600 })], winter, []).warnings.some(w => /shorter than four hours/.test(w)))
})

test('winter and standard opening have one leader, then a second employee at an allowed offset', () => {
  for (const active of ['winter', 'standard']) {
    const scenario = { ...inputs, hours: getEffectiveSchedule({ active }), budget: { method: 'hours', hourly: 250, combined: 295 } }
    const plan = recommendPlan(scenario, 12)
    for (let day = 0; day < 7; day++) {
      const open = day === 0 || active === 'winter' ? 480 : 420
      const first = plan.filter(s => s.day === day).sort((a, b) => a.start - b.start)
      assert.equal(first[0].start, open - 60)
      assert.ok(['GM', 'AGM', 'TL 1', 'TL 2'].includes(first[0].role))
      assert.ok([open - 30, open].includes(first[1].start))
    }
    assert.ok(!plan.some(s => s.role === 'GM' && s.day === 0))
    assert.ok(analyzePlan([shift({ role: 'GM', day: 0 })], scenario, []).warnings.some(w => /exception to the default day off/.test(w)))
  }
})

test('observed busy days get distributed leadership and the GM works busy optional days', () => {
  const scenario = { ...inputs, hours: getEffectiveSchedule({ active: 'winter' }),
    budget: { method: 'hours', hourly: 250, combined: 295 },
    traffic: { '2:720': { average: 100, samples: 4 }, '5:720': { average: 90, samples: 4 } } }
  const plan = recommendPlan(scenario, 12)
  assert.ok(plan.some(s => s.day === 2 && s.role === 'GM'))
  for (const day of [2, 5]) {
    const onDuty = plan.filter(s => s.day === day && ['GM', 'AGM', 'TL 1', 'TL 2'].includes(s.role))
    assert.ok(new Set(onDuty.map(s => s.role)).size >= 3)
    assert.ok(new Set(onDuty.map(s => s.start)).size >= 2)
  }
  assert.ok(analyzePlan(plan, scenario, []).coverage.every(row => !row.gap))
})
