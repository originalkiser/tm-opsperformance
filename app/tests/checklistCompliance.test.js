import test from 'node:test'
import assert from 'node:assert/strict'
import { addChecklistDays, complianceRange, fetchChecklistCompliance, buildComplianceRows, summarizeCompliance, complianceCsv } from '../src/utils/checklistCompliance.js'

const range = { start: '2026-11-09', end: '2026-11-11' }
const site = { id: 'a', site_code: '1001', name: 'Fictional North', market: 'North', timezone: 'America/New_York', local_today: '2026-11-11' }
const data = () => ({ generated_at: '2026-11-11T15:00:00Z', range_start: range.start, range_end: range.end, locations: [site, { ...site, id: 'b', site_code: '1002', name: 'Fictional South' }], submissions: [] })
const submission = (template_key, status = 'submitted', period_date = range.start, location_id = 'a') => ({ location_id, template_key, status, period_date, is_pilot: false })

test('daily uses all-or-nothing 3/3 and includes every site/date with missing and progress labels', () => {
  const input = data()
  input.submissions = [submission('opening'), submission('midday'), submission('closing'), submission('opening', 'submitted', '2026-11-10'), submission('midday', 'draft', '2026-11-10'), submission('closing', 'discarding', '2026-11-10')]
  const rows = buildComplianceRows(input, 'daily', range)
  assert.equal(rows.length, 6)
  assert.deepEqual(rows.map(row => row.score), [100, 0, 0, 0, 0, 0])
  assert.deepEqual(rows[1].inProgress, ['Mid-Day', 'Closing'])
  assert.deepEqual(rows[2].missing, ['Opening', 'Mid-Day', 'Closing'])
  assert.equal(rows[2].current, true)
  assert.deepEqual(summarizeCompliance(rows), { total: 6, complete: 1, incomplete: 5, percent: 17, missing: 12, inProgress: 2, future: 0 })
})

test('weekly uses both checklists within Monday-Sunday and never grants partial credit', () => {
  const input = data(), week = complianceRange('weekly', '2026-11-15')
  input.submissions = [submission('weekly'), submission('weekly_pm', 'draft'), submission('weekly', 'submitted', range.start, 'b'), submission('weekly_pm', 'submitted', range.start, 'b')]
  assert.deepEqual(week, { start: '2026-11-09', end: '2026-11-15' })
  const rows = buildComplianceRows(input, 'weekly', week)
  assert.deepEqual(rows.map(row => row.score), [0, 100])
  assert.equal(rows[0].current, true)
  assert.deepEqual(rows[0].inProgress, ['Preventive Maintenance'])
  assert.equal(summarizeCompliance(rows).percent, 50)
})

test('site-local day rollover, future dates, DST and year boundaries do not use browser timezone', () => {
  const input = data()
  input.locations[0] = { ...site, local_today: '2026-11-10' }
  const rows = buildComplianceRows(input, 'daily', { start: '2026-11-11', end: '2026-11-11' })
  assert.equal(rows[0].score, null)
  assert.deepEqual(rows[0].missing, [])
  assert.equal(rows[1].score, 0)
  assert.equal(summarizeCompliance(rows).total, 1)
  assert.equal(summarizeCompliance(rows).future, 1)
  assert.equal(addChecklistDays('2026-03-08', 1), '2026-03-09')
  assert.equal(addChecklistDays('2026-11-01', 1), '2026-11-02')
  assert.deepEqual(complianceRange('weekly', '2027-01-01'), { start: '2026-12-28', end: '2027-01-03' })
})

test('range validation accepts 92 days inclusive and rejects invalid, reversed and longer ranges', () => {
  assert.deepEqual(complianceRange('daily', '2026-01-01', '2026-04-02'), { start: '2026-01-01', end: '2026-04-02' })
  for (const args of [['daily', '2026-01-01', '2026-04-03'], ['daily', '2026-02-30', '2026-03-01'], ['daily', '2026-11-11', '2026-11-10'], ['weekly', ''], ['monthly', range.start, range.end]]) assert.throws(() => complianceRange(...args))
})

test('RPC is the only read path and retains only the documented summary fields', async () => {
  const input = data(); input.submissions = [{ ...submission('opening'), answers: { private: true }, manager_name: 'Must not retain', created_by: 'hidden' }]
  const calls = [], client = { async rpc(name, args) { calls.push({ name, args }); return { data: input } }, from() { throw Error('Raw fallback attempted') } }
  const result = await fetchChecklistCompliance(client, range)
  assert.deepEqual(calls, [{ name: 'get_checklist_compliance', args: { p_start: range.start, p_end: range.end } }])
  assert.deepEqual(Object.keys(result.submissions[0]).sort(), ['is_pilot', 'location_id', 'period_date', 'status', 'template_key'])
  assert.doesNotMatch(JSON.stringify(result), /Must not retain|answers|created_by/)
  await assert.rejects(fetchChecklistCompliance({ ...client, async rpc() { return { error: { code: '42501' } } } }, range), /could not be loaded/)
})

test('malformed or partial responses fail closed instead of fabricating missing checklists', async () => {
  const mutations = [input => { delete input.locations }, input => { input.range_end = '2026-11-10' }, input => { input.locations.push(site) }, input => { input.locations[0].timezone = 'Not/A_Zone' }, input => { input.locations[0].local_today = '2026-11-10' }, input => { input.submissions = [submission('opening'), submission('opening')] }, input => { input.submissions = [submission('other')] }, input => { input.submissions = [submission('weekly', 'submitted', '2026-11-10')] }, input => { input.submissions = [submission('opening', 'submitted', '2026-11-08')] }, input => { input.submissions = [submission('opening', 'unknown')] }, input => { input.submissions = [submission('opening', 'submitted', range.start, 'foreign')] }]
  for (const mutate of mutations) {
    const input = structuredClone(data()); mutate(input)
    await assert.rejects(fetchChecklistCompliance({ rpc: async () => ({ data: input }) }, range))
  }
})

test('daily request includes valid weekly lead-in without counting it toward daily completion', async () => {
  const requested = { start: '2026-11-11', end: '2026-11-11' }, input = data()
  input.range_start = requested.start; input.range_end = requested.end
  input.submissions = [submission('weekly'), submission('weekly_pm')]
  const result = await fetchChecklistCompliance({ rpc: async () => ({ data: input }) }, requested)
  assert.equal(buildComplianceRows(result, 'daily', requested)[0].score, 0)
})

test('CSV exports visible status rows, pilot context, notices and no private payload; formula cells are escaped', () => {
  const input = data()
  input.locations[0] = { ...site, site_code: '=1+1', name: '@evil,"quoted"\nname' }
  input.submissions = [{ ...submission('opening'), is_pilot: true }]
  const rows = buildComplianceRows(input, 'daily', range).filter(row => row.site.id === 'a')
  const csv = complianceCsv(rows, 'daily', input.generated_at)
  assert.match(csv, /"'=1\+1"/)
  assert.match(csv, /"'@evil,""quoted""\nname"/)
  assert.match(csv, /Optional checklist completion; not a retroactive policy finding/)
  assert.match(csv, /Historical pilot records/)
  assert.doesNotMatch(csv, /Fictional South|answers|signature|created_by/)
  assert.equal(rows[0].isPilot, true)
})

test('empty scope is N/A, never 0 or 100 percent', () => {
  const rows = buildComplianceRows({ locations: [], submissions: [] }, 'daily', range)
  assert.deepEqual(rows, [])
  assert.equal(summarizeCompliance(rows).percent, null)
})

test('known invalid-site timezone failure has an actionable message without fallback', async () => {
  const client = { rpc: async () => ({ error: { code: '22023', message: 'Valid site time zone required for every reporting location' } }) }
  await assert.rejects(fetchChecklistCompliance(client, range), /missing or invalid time zone/)
})
