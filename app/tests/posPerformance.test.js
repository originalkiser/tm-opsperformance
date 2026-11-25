import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPosReportMetrics } from '../src/utils/posMetrics.js'
import { buildPosPerformance, posPeriod, readPosTargets } from '../src/utils/posPerformance.js'
import { commitPosWorkbook, preparePosWorkbook, processPosFiles, fileDigest } from '../src/utils/posImportStorage.js'

const line = (category, label, quantity, amount = 0) => ({ category, label, quantity, amount })
test('Micrologic recognizes reactivations and one item-level membership refund', () => {
  const source = [
    line('unlimited signup','Basic Signup',2,10000), line('unlimited recurring','Recurring',1,4000),
    line('unlimited reactivation','Better Wash Unlimited ReActivation',1,3600),
    line('unlimited reactivation','Unlimited Reactivation Total',1,3600),
    line('refunded','-- Basic Wash Unlimited',-1,-58), line('uwc downgrades','-- refund: basic wash unlimited',-1,-58),
    line('refunded','-- Tax Refund',-1), line('wash sales','Better Wash',1), line('wash sales','Basic Wash',3),
    line('wash sales','zBest Wash',1), line('unlimited redemption','Best Wash Unlimited',4),
  ]
  const metrics = { revenue: 30000, memberships: 2, recharges: 1, redemptions: 4, overrides: 1 }
  const report = buildPosReportMetrics('Micrologic', source, metrics)
  assert.deepEqual([report.memberRevenue, report.retailRevenue, report.premiumRetail, report.eligibleRetail], [17542,12458,1,4])
  assert.equal(report.sources.member.filter(row => row.amount === -58).length, 1)
  assert.equal(report.redeem.best, 4)
  assert.equal(metrics.memberships, 2)
  const ambiguous = buildPosReportMetrics('Micrologic', [...source,line('refunded','Unl Unknown',-1,-100)], metrics)
  assert.equal(ambiguous.memberRevenue, null)
  assert.equal(ambiguous.retailRevenue, null)
})

test('DRB counts premium packages once, allocates signed discounts to membership and holds unknown tiers', () => {
  const source = [
    line('basic washes','Package Wash',4), line('basic washes','Basic Wash',2),
    line('wash packages','Better Wash',1), line('wash packages','Best Wash',3),
    line('wash packages','ARM Membercross Wash',6), line('wash packages','GhostWash-',2),
    line('arm plans sold','Best signup',2,10000), line('arm plans recharged','Recharge',4,20000),
    line('arm plans terminated','Unl. Best Rfnd',1,-700),
    line('wash lpm discounts','Unl Best 2m Disc',1,-2000),
    line('arm plans redeemed','Unl. Best Rdmd',4,-2000),
    line('arm plans redeemed','Unl. Ultimate Rdmd',1,-200),
  ]
  const report = buildPosReportMetrics('DRB', source, { revenue: 40000, redemptions: 5 })
  assert.deepEqual([report.memberRevenue, report.retailRevenue, report.premiumRetail, report.eligibleRetail], [27300,12700,4,6])
  assert.equal(report.retailComplete, true)
  assert.equal(report.redeem.unclassified, 1)
  assert.equal(report.redeem.best, 4)
  assert.equal(buildPosReportMetrics('DRB', source.slice(1), { revenue: 40000, redemptions: 5 }).retailComplete, false)
})

test('periods use Sunday starts and completed-day cutoffs across month boundaries', () => {
  assert.deepEqual(posPeriod('Today','2026-12-01'), { start:'2026-12-01',end:'2026-12-01',empty:false })
  assert.deepEqual(posPeriod('Yesterday','2026-12-01'), { start:'2026-11-30',end:'2026-11-30',empty:false })
  assert.deepEqual(posPeriod('LW','2026-12-01'), { start:'2026-11-22',end:'2026-11-28',empty:false })
  assert.deepEqual(posPeriod('WTD','2026-12-01'), { start:'2026-11-29',end:'2026-11-30',empty:false })
  assert.equal(posPeriod('WTD','2026-11-22').empty, true)
  assert.equal(posPeriod('MTD','2026-12-01').empty, true)
  assert.equal(posPeriod('MTD','2026-12-04').end, '2026-12-03')
  assert.ok(posPeriod('Selected Date Range','2026-12-04','2026-11-31','2026-12-04').error)
})

const locations = [{ id:'a' },{ id:'b' }]
const start = '2026-11-23', end = '2026-11-24'
const record = (id, date, n, metrics = {}, status = {}) => ({
  location_id: id, business_date: date, financial_status: 'reconciled', validation: 'validated',
  document: { sources: {}, metrics: {
    total: 10000*n, member: 6000*n, retail: 4000*n, washes: 10*n, opportunities: 8*n, redemptions: 2*n,
    memberships: 2, premiumSold: 1, unclassifiedSold: 0, eligibleRetail: 6*n, premiumRetail: 2,
    premiumRedeemed: 1, unclassifiedRedeemed: 0, ...metrics,
  } }, ...status,
})
const records = [record('a',start,1),record('a',end,2),record('b',start,3),record('b',end,4)]
const goals = locations.flatMap(({id}) => [start,end].map((business_date,index) => ({location_id:id,business_date,total:index ? '199.0000000001' : '100.0000000001'})))

test('network and period mix and conversion use underlying weighted counts and exact daily targets', () => {
  const { rows, network } = buildPosPerformance(locations, records, goals, start, end)
  assert.equal(network.target, 598.0000000004)
  assert.equal(network.total, 100000)
  assert.equal(network.retail + network.member, network.total)
  assert.equal(network.retailMix, 8/60)
  assert.equal(network.redeemMix, 4/20)
  assert.equal(network.soldMix, 4/8)
  assert.equal(network.conversion, 8/80)
  assert.equal(rows[0].conversion, 4/24)
  assert.equal(network.comparison, (1000-network.target)/network.target)
})

test('missing and provisional results leave targets intact and flagged rather than creating verified comparisons', () => {
  const input = [records[0],record('b',start,3,{ unclassifiedRedeemed:1 },{ financial_status:'provisional',validation:'incomplete' }),records[3]]
  const { rows, network } = buildPosPerformance(locations,input,goals,start,end)
  assert.deepEqual(rows[0].missing,[end])
  assert.equal(network.imported,3)
  assert.equal(network.expected,4)
  assert.equal(network.total,50000)
  assert.equal(network.totalPartial,true)
  assert.equal(network.target,598.0000000004)
  assert.equal(network.targetPartial,false)
  assert.equal(network.comparison,null)
  assert.equal(network.redeemMix,null)
  assert.equal(rows[1].redeemMix,null)
  assert.equal(network.provisional,1)
  const noGoals = buildPosPerformance(locations,records,goals.slice(1),start,end).network
  assert.equal(noGoals.targetPartial,true)
  assert.equal(noGoals.comparison,null)
})

test('goals are read across selected business dates, independent of import coverage', async () => {
  const calls = []
  const client = { from(table) { calls.push(table); return {
    select() { return this }, in() { return this }, gte(...args) { calls.push(args); return this },
    lte(...args) { calls.push(args); return this }, order() { return this }, range() { return Promise.resolve({data:goals}) },
  } } }
  assert.deepEqual(await readPosTargets(client,locations,'2026-11-29','2026-12-03'),goals)
  assert.deepEqual(calls,['budget_daily_revenue_goals',['business_date','2026-11-29'],['business_date','2026-12-03']])
})

test('48-file historical previews proceed sequentially and failed files can be retried independently', async () => {
  const files = Array.from({length:48},(_,id) => ({id}))
  const results = []
  let active = 0
  const process = async file => {
    assert.equal(++active,1)
    await Promise.resolve()
    active--
    if (file.id === 12 && !results.some(value => value.error)) throw new Error('Temporary fixture failure')
    return file.id
  }
  const progress = (file,outcome,done,total) => results.push({file:file.id,...outcome,done,total})
  await processPosFiles(files.reverse(),process,progress)
  assert.equal(results.length,48)
  assert.equal(results.filter(r => r.error).length,1)
  assert.equal(results.at(-1).done,48)
  await processPosFiles([{id:12}],process,progress)
  assert.equal(results.at(-1).result,12)
})

test('file hashing is exact and save payload excludes workbook bytes and requires explicit correction', async () => {
  assert.equal(await fileDigest(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  await assert.rejects(preparePosWorkbook({}, {name:'wrong.csv',size:1},[]), /XLSX/)
  const calls = []
  const client = { rpc(name,args) {calls.push([name,args]);return Promise.resolve({data:{replaced:1}})} }
  const workbook = { name:'fixture.xlsx',sha:'a'.repeat(64),system:'DRB',day:start,issues:[],
    bytes:new Uint8Array([1]), candidates:[{sourceId:'1518-Greenwood',locationId:'a',expectedRevision:1,document:{example:true},change:'correction'}] }
  await assert.rejects(commitPosWorkbook(client,workbook,''),/approve/)
  assert.deepEqual(await commitPosWorkbook(client,workbook,'Approved fixture'),{replaced:1})
  assert.equal(calls[0][0],'pos_daily_commit')
  assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_day','p_file_name','p_parser','p_rows','p_sha','p_system'])
  assert.equal(calls[0][1].p_rows[0].reason,'Approved fixture')
})

test('network conversion uses weighted revised opportunities and treats a zero denominator as unavailable', () => {
  const a = record('a', start, 1, { washes: 10, opportunities: 7, memberships: 2 })
  const b = record('b', start, 2, { washes: 20, opportunities: 17, memberships: 1 })
  const report = buildPosPerformance(locations, [a, b], goals, start, start)
  assert.equal(report.network.washes, 30)
  assert.equal(report.network.opportunities, 24)
  assert.equal(report.network.conversion, 3 / 24)
  const secondDay = record('a', end, 1, { washes: 10, opportunities: 0, memberships: 0 })
  const period = buildPosPerformance([locations[0]], [a, secondDay], goals, start, end)
  assert.equal(period.network.conversion, 2 / 7)
  assert.equal(buildPosPerformance([locations[0]], [secondDay], goals, end, end).network.conversion, null)
})
