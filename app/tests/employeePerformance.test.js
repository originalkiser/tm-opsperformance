import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEmployeePerformance, inspectEmployeeDay, sortEmployeeRows, employeeRankLabel, EMPLOYEE_WEIGHTS, MIN_EMPLOYEE_OPPORTUNITIES, fetchEmployeeLogs } from '../src/utils/employeePerformance.js'

const dateRange = { start: '2026-10-01', end: '2026-10-22' }
const sites = [{ id: 's', name: 'Simple Site', opportunities_formula: 'simple' }, { id: 'd', name: 'Detailed Site', opportunities_formula: 'detailed' }]
const row = (employee_name, time_slot, total_washes, best, extra = {}) => ({ location_id: 's', log_date: '2026-10-20', employee_name, time_slot, split_index: 0, total_washes, member_washes: 0, basic: 0, good: 0, better: 0, best, google_reviews: 0, ...extra })
const fixture = () => [row('Alex','08:00:00',200,20),row('Blair','09:00:00',400,40),row('Casey','10:00:00',600,50)]
const build = (data, locations = sites, range = dateRange) => buildEmployeePerformance(data, locations, range)

test('three exact weights produce a 100-point score and contributions sum to the displayed score', () => {
  const report = build(fixture())
  assert.equal(Object.values(EMPLOYEE_WEIGHTS).reduce((a,b)=>a+b),100)
  assert.equal(MIN_EMPLOYEE_OPPORTUNITIES,100)
  for (const r of report.rows) {
    assert.ok(r.score >= 0 && r.score <= 100)
    assert.equal(Math.round(Object.values(r.contributions).reduce((a,b)=>a+b)*100)/100,r.score)
  }
  assert.equal(report.rows[0].score,100)
  assert.deepEqual(report.rows[0].contributions,{sales:33.33,conversion:33.33,pmix:33.34})
})

test('equal displayed scores share competition ranks, with the following position skipped', () => {
  const rows=build(fixture()).rows
  assert.deepEqual(rows.map(r=>r.rank),[1,1,3])
  assert.equal(employeeRankLabel(rows[0]),'Simple #1')
  assert.equal(rows[2].score,66.68)
})

test('sales benchmark is global among eligible employee/site rows; conversion and ranks remain formula-specific', () => {
  const data=[row('Simple','08:00:00',200,20),row('Detailed','08:00:00',200,100,{location_id:'d'})]
  const report=build(data),simple=report.rows.find(r=>r.formula==='simple'),detailed=report.rows.find(r=>r.formula==='detailed')
  assert.equal(simple.denominators.sales,100)
  assert.equal(simple.contributions.sales,6.67)
  assert.equal(simple.contributions.conversion,33.33)
  assert.equal(detailed.contributions.conversion,33.33)
  assert.equal(simple.rate,.1);assert.equal(detailed.rate,1/3)
  assert.equal(simple.rank,1);assert.equal(detailed.rank,1)
  assert.equal(employeeRankLabel(detailed),'Detailed #1')
})

test('P-Mix is directly relative to 100%, never relative to the best employee', () => {
  const r=build([row('Half mix','08:00:00',200,10,{basic:10})]).rows[0]
  assert.equal(r.mix,.5);assert.equal(r.contributions.pmix,16.67)
  assert.equal(r.score,83.33)
})

test('Google Reviews and stored cumulative opportunities/memberships never influence scores', () => {
  const data=fixture(),before=build(data).rows
  const after=build(data.map(r=>({...r,google_reviews:99999,opportunities:999999,memberships_sold:99999}))).rows
  assert.deepEqual(after.map(r=>[r.score,r.rank,r.contributions]),before.map(r=>[r.score,r.rank,r.contributions]))
})

test('negative corrections never inflate employee sales; no arbitrary correction recipient is chosen', () => {
  const data=[row('Alex','08:00:00',200,20),row('Alex','09:00:00',180,18),row('Blair','10:00:00',200,20)]
  const report=build(data)
  assert.equal(report.excludedDays.length,1)
  assert.equal(report.rows.reduce((s,r)=>s+(r.ms||0),0),0)
  assert.ok(report.rows.every(r=>r.score===null&&r.rank===null&&r.ms===null&&r.partial))
  assert.match(report.excludedDays[0].issues.join(' '),/decreased/)
})

test('clean days remain informational subtotals but a correction day withholds every score in that site-period', () => {
  const data=[...fixture(),row('Alex','08:00:00',200,20,{log_date:'2026-10-21'}),row('Unknown correction','09:00:00',190,19,{log_date:'2026-10-21'})]
  const report=build(data)
  assert.equal(report.rows.reduce((s,r)=>s+(r.ms||0),0),50)
  assert.ok(report.rows.every(r=>r.score===null&&r.partial))
  assert.equal(report.rows.find(r=>r.name==='Alex').ms,20)
  assert.equal(report.rows.find(r=>r.name==='Unknown correction').ms,null)
  assert.ok(report.rows.reduce((s,r)=>s+(r.ms||0),0)<=50+19)
})

test('correction to one tier cannot inflate P-Mix by discarding its negative delta', () => {
  const report=build([row('Alex','08:00:00',200,10,{basic:10}),row('Blair','09:00:00',400,9,{basic:21})])
  assert.equal(report.excludedDays.length,1)
  assert.ok(report.rows.every(r=>r.score===null&&r.mix===null))
})

test('low samples and zero opportunities stay unranked and cannot set normalization maxima', () => {
  const data=[row('Eligible','08:00:00',200,20),row('Low sample','08:00:00',99,90,{location_id:'low'}),row('Zero','08:00:00',0,0,{location_id:'zero'})]
  const report=build(data,[...sites,{id:'low',name:'Low',opportunities_formula:'simple'},{id:'zero',name:'Zero',opportunities_formula:'simple'}])
  assert.equal(report.highestSales,20)
  assert.equal(report.rows.find(r=>r.name==='Eligible').score,100)
  for(const name of ['Low sample','Zero']) {const r=report.rows.find(r=>r.name===name);assert.equal(r.score,null);assert.equal(r.rank,null)}
  assert.equal(report.rows.find(r=>r.name==='Zero').rate,null)
})

test('unnamed activity, null counts, invalid counts, duplicates, gaps and impossible opportunities fail closed', () => {
  const cases=[
    [row('', '08:00:00',200,20)],
    [row('Alex','08:00:00',200,20,{basic:null})],
    [row('Alex','08:00:00',200,20,{best:-1})],
    [row('Alex','08:00:00',200,20),row('Blair','08:00:00',300,30)],
    [row('Alex','08:00:00',200,20),row('Blair','10:00:00',400,40)],
    [row('Alex','08:00:00',10,20)],
    [row('Alex','08:00:00',200,20,{member_washes:201})],
  ]
  for(const data of cases) {
    const report=build(data)
    assert.equal(report.excludedDays.length,1)
    assert.ok(report.rows.every(r=>r.score===null&&r.ms===null))
  }
})

test('valid split-hour checkpoints preserve attribution and final shop totals without mutating input', () => {
  const data=[row('Alex','08:00:00',200,20),row('Blair','08:00:00',400,40,{split_index:1}),row('aLEX','09:00:00',600,60)]
  const before=JSON.stringify(data),report=build(data)
  assert.equal(JSON.stringify(data),before)
  assert.equal(inspectEmployeeDay(data,'simple').reliable,true)
  assert.equal(report.rows.length,2)
  assert.equal(report.rows.find(r=>r.name==='Alex').ms,40)
  assert.equal(report.rows.reduce((s,r)=>s+r.ms,0),60)
  assert.equal(report.rows.reduce((s,r)=>s+r.total_washes,0),600)
})

test('existing site/date filters define the pool and exclude unrelated dates, sites and their defects', () => {
  const data=[...fixture(),row('Bad','08:00:00',10,20,{location_id:'d'}),row('Old','08:00:00',10,20,{log_date:'2026-09-30'})]
  const report=build(data,[sites[0]])
  assert.equal(report.excludedDays.length,0)
  assert.equal(report.rows.length,3)
  assert.ok(report.rows.every(r=>r.eligible))
})

test('unknown opportunity formulas cannot enter official scoring', () => {
  const report=build(fixture(),[{...sites[0],opportunities_formula:'unknown'}])
  assert.ok(report.rows.every(r=>r.score===null))
  assert.match(report.excludedDays[0].issues.join(' '),/Unknown opportunity formula/)
})

test('Score and Rank sort numerically with unranked rows last in either direction', () => {
  const data=[...fixture(),row('Low','08:00:00',10,1,{location_id:'d'})]
  const rows=build(data).rows
  for(const dir of ['asc','desc']) assert.equal(sortEmployeeRows(rows,{col:'score',dir}).at(-1).name,'Low')
  assert.equal(sortEmployeeRows(rows,{col:'score',dir:'asc'})[0].name,'Casey')
  const ranked=rows.filter(r=>r.rank!=null)
  assert.equal(sortEmployeeRows(ranked,{col:'rank',dir:'desc'})[0].rank,3)
})


function pages(responses) {
  const calls=[]
  return { calls, client: { from(table) {
    assert.equal(table,'daily_logs')
    return { select(fields,options) {assert.equal(fields,'*');assert.deepEqual(options,{count:'exact'});return this},
      in(key,ids) {assert.equal(key,'location_id');assert.deepEqual(ids,['s']);return this},
      gte(key,date) {assert.equal(key,'log_date');assert.equal(date,dateRange.start);return this},
      lte(key,date) {assert.equal(key,'log_date');assert.equal(date,dateRange.end);return this},
      order(key) {assert.equal(key,'id');return this},
      range(from,to) {calls.push([from,to]); const response=responses.shift();return response instanceof Error?Promise.reject(response):Promise.resolve(response)},
    }
  } } }
}
test('Team Sales reads all pages using actual server-capped page size and exact count',async()=>{
  const p=pages([{data:[{id:'a'},{id:'b'}],count:3},{data:[{id:'c'}],count:3}])
  assert.deepEqual((await fetchEmployeeLogs(p.client,['s'],dateRange)).map(r=>r.id),['a','b','c'])
  assert.deepEqual(p.calls,[[0,499],[2,501]])
})
test('failed pages, missing totals, duplicate identities and changing counts cannot produce ranked partial data',async()=>{
  const first={data:[{id:'a'}],count:2}
  for(const rest of [{data:null,error:new Error('denied')},{data:[],count:2},{data:[{id:'a'}],count:2},{data:[{id:'b'}],count:3},new Error('offline')]) {
    const p=pages([first,rest]);await assert.rejects(fetchEmployeeLogs(p.client,['s'],dateRange))
  }
  await assert.rejects(fetchEmployeeLogs(pages([{data:[],count:null}]).client,['s'],dateRange))
})
test('empty location list and verified zero-count result require no fabricated employee data',async()=>{
  const p=pages([]);assert.deepEqual(await fetchEmployeeLogs(p.client,[],dateRange),[]);assert.equal(p.calls.length,0)
  assert.deepEqual(await fetchEmployeeLogs(pages([{data:[],count:0}]).client,['s'],dateRange),[])
})
