import test from 'node:test'
import assert from 'node:assert/strict'
import { complianceShortcutRange, complianceShortcutRequest, selectedComplianceRows, groupComplianceLocations, compliancePeriodLabel, complianceCsv } from '../src/utils/checklistCompliance.js'

const site = (id, timezone = 'America/Chicago', today = '2026-11-30') => ({ id, site_code: id, name: `Fictional ${id}`, timezone, local_today: today })
const occurrence = (location_id, template_key, period_date, status = 'submitted', weekly_timing) => ({ location_id, template_key, period_date, status, is_pilot: false, ...(weekly_timing ? { weekly_timing } : {}) })
const timing = phase => ({ due_at: '2026-12-01T06:00:00Z', due_date: '2026-11-30', phase })

test('LW is the previous complete week, including Monday, year and DST boundaries', () => {
  assert.deepEqual(complianceShortcutRange('lw', '2026-11-30'), { start: '2026-11-23', end: '2026-11-29' })
  assert.deepEqual(complianceShortcutRange('lw', '2027-01-01'), { start: '2026-12-21', end: '2026-12-27' })
  assert.deepEqual(complianceShortcutRange('wtd', '2026-03-08'), { start: '2026-03-02', end: '2026-03-08' })
  assert.deepEqual(complianceShortcutRange('mtd', '2026-11-30'), { start: '2026-11-01', end: '2026-11-30' })
  assert.throws(() => complianceShortcutRange('other', '2026-11-30'))
})

test('one request covers site-local Sunday/Monday rollover, without adding wrong dates to either site', () => {
  const sites = [site('1', 'America/New_York', '2026-11-30'), site('2', 'America/Phoenix', '2026-11-29')]
  const range = complianceShortcutRequest('wtd', sites, new Date('2026-11-30T05:30Z'))
  assert.deepEqual(range, { start: '2026-11-23', end: '2026-11-30' })
  const rows = selectedComplianceRows({ locations: sites, submissions: [] }, 'daily', range, 'wtd')
  assert.equal(rows.filter(r => r.site.id === '1').length, 1)
  assert.equal(rows.filter(r => r.site.id === '2').length, 7)
  assert.ok(rows.every(r => r.period <= r.site.local_today))
  const groups = groupComplianceLocations(rows)
  assert.deepEqual(groups.map(g => g.summary.total), [1, 7])
})

test('MTD weekly rows include whole intersecting weeks, including the prior-month Monday', () => {
  const range = { start: '2026-11-01', end: '2026-11-30' }
  const rows = selectedComplianceRows({ locations: [site('1')], submissions: [] }, 'weekly', range, 'mtd')
  assert.deepEqual(rows.map(r => r.period), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  assert.equal(rows.at(-1).end, '2026-12-06')
})

test('location summaries reuse binary period scores, preserve all 20 sites, and do not average checklist completion', () => {
  const input = { locations: Array.from({ length: 20 }, (_, i) => site(String(i + 1))), submissions: [] }
  input.submissions = ['opening', 'midday', 'closing'].map(key => occurrence('1', key, '2026-11-29'))
  input.submissions.push(occurrence('1', 'opening', '2026-11-30'))
  const rows = selectedComplianceRows(input, 'daily', { start: '2026-11-29', end: '2026-11-30' })
  const groups = groupComplianceLocations(rows)
  assert.equal(groups.length, 20)
  assert.equal(groups[0].summary.percent, 50)
  assert.equal(groups[0].summary.complete, 1)
  assert.equal(groups[0].summary.total, 2)
  assert.equal(groups[0].pending, 1)
  const filtered = groupComplianceLocations(rows, rows.filter(r => r.score === 100))
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].rows.length, 1)
  assert.equal(filtered[0].summary.percent, 50, 'status filters cannot inflate site percentage')
  assert.match(complianceCsv(rows, 'daily', '2026-11-30T15:00Z'), /Fictional 20/)
})

test('mixed historical/new weekly periods retain historical completion and authoritative late zero', () => {
  const input = { locations: [site('1')], submissions: [], weekly_periods: [{ location_id: '1', period_date: '2026-11-23', weekly_timing: timing('overdue'), score: 0 }] }
  for (const key of ['weekly', 'weekly_pm']) input.submissions.push(occurrence('1', key, '2026-11-16'))
  input.submissions.push(occurrence('1', 'weekly', '2026-11-23', 'submitted', timing('submitted_on_time')), occurrence('1', 'weekly_pm', '2026-11-23', 'submitted', timing('completed_late')))
  const rows = selectedComplianceRows(input, 'weekly', { start: '2026-11-16', end: '2026-11-29' })
  assert.deepEqual(rows.map(r => r.score), [100, 0])
  assert.equal(compliancePeriodLabel(rows[1]), 'Completed Late')
  assert.equal(groupComplianceLocations(rows)[0].summary.percent, 50)
  assert.match(complianceCsv(rows, 'weekly', '2026-11-30T15:00Z'), /Completed Late/)
  input.weekly_periods[0].score = 100
  input.submissions.at(-1).weekly_timing = timing('submitted_on_time')
  assert.equal(groupComplianceLocations(selectedComplianceRows(input, 'weekly', { start: '2026-11-16', end: '2026-11-29' }))[0].summary.percent, 100)
})

test('Pending, overdue, completed-late and future presentation does not change eligibility or scores', () => {
  const input = { locations: [site('1')], submissions: [], weekly_periods: [{ location_id: '1', period_date: '2026-11-23', weekly_timing: timing('not_started'), score: 0 }] }
  let rows = selectedComplianceRows(input, 'weekly', { start: '2026-11-23', end: '2026-12-06' })
  assert.equal(compliancePeriodLabel(rows[0]), 'Pending')
  assert.equal(groupComplianceLocations(rows)[0].summary.total, 2)
  input.weekly_periods[0].weekly_timing = timing('overdue')
  rows = selectedComplianceRows(input, 'weekly', { start: '2026-11-23', end: '2026-12-13' })
  assert.equal(compliancePeriodLabel(rows[0]), 'Overdue')
  assert.equal(compliancePeriodLabel(rows.at(-1)), 'Future')
  assert.equal(groupComplianceLocations(rows)[0].summary.total, 2)
})
