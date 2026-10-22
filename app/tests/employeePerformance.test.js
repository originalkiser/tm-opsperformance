import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeDeltasByDay } from '../src/utils/logMath.js'
import { buildEmployeePerformance, inspectEmployeeDay, sortEmployeeRows, employeeRankLabel, EMPLOYEE_WEIGHTS, fetchEmployeeLogs } from '../src/utils/employeePerformance.js'

const dateRange = { start: '2026-10-01', end: '2026-10-22' }
const sites = [{ id: 's', name: 'Simple Site', opportunities_formula: 'simple' }, { id: 'd', name: 'Detailed Site', opportunities_formula: 'detailed' }]
const row = (employee_name, time_slot, total_washes, best, extra = {}) => ({ location_id: 's', log_date: '2026-10-20', employee_name, time_slot, split_index: 0, total_washes, member_washes: 0, basic: 0, good: 0, better: 0, best, google_reviews: 0, ...extra })
const fixture = () => [row('Alex','08:00:00',200,20),row('Blair','09:00:00',400,40),row('Casey','10:00:00',600,50)]
const build = (data, locations = sites, range = dateRange) => buildEmployeePerformance(data, locations, range)

test('three exact weights produce a 100-point score and contributions sum to the displayed score', () => {
  const report = build(fixture())
  assert.equal(Object.values(EMPLOYEE_WEIGHTS).reduce((a,b)=>a+b),100)
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

test('negative corrections withhold only ambiguous prior contributors, not later employees', () => {
  const data=[row('Alex','08:00:00',200,20),row('Correction entered by Blair','09:00:00',180,18),row('Blair','13:00:00',200,20)]
  const report=build(data),alex=report.rows.find(r=>r.name==='Alex'),blair=report.rows.find(r=>r.name==='Blair')
  assert.equal(report.attributionNotes.length,1)
  assert.equal(alex.ms,null);assert.equal(alex.score,null);assert.equal(alex.rank,null)
  assert.equal(blair.ms,2);assert.equal(blair.opp,20);assert.equal(blair.score,100);assert.equal(blair.rank,1)
  assert.equal(report.rows.find(r=>r.name==='Correction entered by Blair').ms,0)
  assert.ok(report.rows.reduce((s,r)=>s+(r.ms||0),0)<=20)
})

test('a correction does not suppress unrelated employees on the same day or elsewhere in the period', () => {
  const data=[...fixture(),row('Alex','08:00:00',200,20,{log_date:'2026-10-21'}),row('Correction','09:00:00',190,19,{log_date:'2026-10-21'})]
  const report=build(data)
  assert.equal(report.rows.find(r=>r.name==='Alex').score,null)
  for(const name of ['Blair','Casey','Correction']) {
    const r=report.rows.find(r=>r.name===name);assert.notEqual(r.score,null);assert.notEqual(r.rank,null);assert.equal(r.partial,false)
  }
  assert.ok(report.rows.reduce((s,r)=>s+(r.ms||0),0)<=50+19)
})

test('tier correction does not inflate P-Mix or charge the correction to its entering employee', () => {
  const report=build([row('Alex','08:00:00',200,10,{basic:10}),row('Blair','09:00:00',400,9,{basic:21})])
  const [alex,blair]=report.rows
  assert.equal(alex.ms,null);assert.equal(alex.mix,null);assert.equal(alex.score,null)
  assert.equal(blair.ms,11);assert.equal(blair.mix,0);assert.equal(blair.contributions.pmix,0)
  assert.equal(blair.rank,1);assert.ok(blair.ms<=30)
})

test('known sales still set the sales benchmark when only that employee wash attribution is unresolved', () => {
  const report=build([row('Alex','08:00:00',200,20),row('Blair','14:00:00',180,22)])
  const [alex,blair]=report.rows
  assert.equal(alex.ms,20);assert.equal(alex.opp,null);assert.equal(alex.score,null)
  assert.equal(report.highestSales,20)
  assert.equal(blair.ms,2);assert.equal(blair.opp,0)
  assert.equal(blair.contributions.sales,3.33);assert.equal(blair.contributions.conversion,0)
  assert.equal(blair.rank,1)
})

test('there are no opportunity, sales or workday minimums; zero activity has finite zero points and a rank', () => {
  const data=[row('Full','08:00:00',200,20),row('Part time','08:00:00',9,1,{location_id:'low'}),row('Zero','08:00:00',0,0,{location_id:'zero'})]
  const report=build(data,[...sites,{id:'low',name:'Low',opportunities_formula:'simple'},{id:'zero',name:'Zero',opportunities_formula:'simple'}])
  assert.equal(report.highestSales,20)
  const part=report.rows.find(r=>r.name==='Part time'),zero=report.rows.find(r=>r.name==='Zero')
  assert.ok(part.score>0);assert.notEqual(part.rank,null);assert.equal(part.opp,9)
  assert.deepEqual(zero.contributions,{sales:0,conversion:0,pmix:0});assert.equal(zero.score,0);assert.notEqual(zero.rank,null)
  const allZero=build([row('A','08:00:00',0,0),row('B','14:00:00',0,0)]).rows
  assert.deepEqual(allZero.map(r=>[r.score,r.rank]),[[0,1],[0,1]])
  const noOpp=build([row('Sales without opportunities','08:00:00',0,2)]).rows[0]
  assert.equal(noOpp.contributions.conversion,0);assert.equal(noOpp.score,66.67)
})

test('part-time employees and missing hourly checkpoints use the existing Team Sales employee totals', () => {
  const data=[row('Alex','08:00:00',20,2),row('Blair','14:00:00',50,5),row('Alex','17:00:00',60,6),row('Casey','12:00:00',12,1,{log_date:'2026-10-22'})]
  const report=build(data),expected=employeeDeltasByDay(data.slice(0,3))
  assert.equal(report.attributionNotes.length,0)
  for(const r of report.rows) {
    assert.notEqual(r.score,null);assert.notEqual(r.rank,null);assert.deepEqual(r.issues,[])
    if(expected[r.name]) {
      assert.equal(r.ms,expected[r.name].best);assert.equal(r.opp,expected[r.name].total_washes)
      assert.equal(r.rate,r.ms/r.opp);assert.equal(r.mix,1)
    }
  }
  assert.equal(report.rows.find(r=>r.name==='Casey').ms,1)
})

test('unnamed activity does not disqualify named staff and missing fields are not zero resets', () => {
  const report=build([row('','08:00:00',10,1),row('Alex','14:00:00',20,2),row('Blair','17:00:00',40,4,{basic:null})])
  assert.match(report.attributionNotes[0].issues.join(' '),/no employee name/)
  assert.ok(report.rows.every(r=>r.score!=null&&r.rank!=null))
  assert.deepEqual(report.rows.map(r=>r.ms),[1,2])
  const missing=build([row('Alex','08:00:00',20,2),row('Alex','14:00:00',30,null),row('Blair','17:00:00',40,4)])
  assert.equal(missing.attributionNotes.length,0)
  assert.equal(missing.rows.reduce((sum,r)=>sum+r.ms,0),4)
})

test('corrections only affect contributors to the corrected counter, across repeated corrections', () => {
  const data=[row('Basic seller','08:00:00',20,0,{basic:2}),row('Premium seller','10:00:00',40,2,{basic:2}),row('Basic seller','12:00:00',60,2,{basic:1}),row('Later seller','14:00:00',80,3,{basic:1}),row('Corrector','16:00:00',100,3,{basic:0})]
  const report=build(data)
  assert.equal(report.rows.find(r=>r.name==='Basic seller').score,null)
  for(const name of ['Premium seller','Later seller','Corrector']) assert.notEqual(report.rows.find(r=>r.name===name).score,null)
  assert.ok(report.rows.reduce((sum,r)=>sum+(r.ms||0),0)<=3)
})

test('more sales, conversion or P-Mix increases score with the other metrics and benchmarks held fixed', () => {
  const metricScore=(total,basic,best)=>build([row('Anchor','08:00:00',200,100,{location_id:'d'}),row('Subject','08:00:00',total,best,{location_id:'s',basic}),row('Simple anchor','08:00:00',200,100,{location_id:'anchor'})],[...sites,{id:'anchor',name:'Anchor',opportunities_formula:'simple'}]).rows.find(r=>r.name==='Subject').score
  assert.ok(metricScore(40,2,2)>metricScore(20,1,1)) // same conversion and P-Mix, more sales
  assert.ok(metricScore(20,2,2)>metricScore(40,2,2)) // same sales/P-Mix, higher conversion
  assert.ok(metricScore(40,0,4)>metricScore(40,2,2)) // same sales/conversion, higher P-Mix
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
  assert.equal(report.attributionNotes.length,0)
  assert.equal(report.rows.length,3)
  assert.ok(report.rows.every(r=>r.eligible))
})

test('unknown opportunity formulas cannot enter official scoring', () => {
  const report=build(fixture(),[{...sites[0],opportunities_formula:'unknown'}])
  assert.ok(report.rows.every(r=>r.score===null))
  assert.ok(report.rows.every(r=>r.issues.includes('Unknown opportunity formula')))
})

test('Score and Rank sort numerically with unranked rows last in either direction', () => {
  const data=[...fixture(),row('Low','08:00:00',10,1,{location_id:'d'})]
  const rows=build(data,[sites[0],{...sites[1],opportunities_formula:'unknown'}]).rows
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
