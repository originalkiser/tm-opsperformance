import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeDeltasByDay } from '../src/utils/logMath.js'
import { buildEmployeePerformance, inspectEmployeeDay, sortEmployeeRows, employeeRankLabel, fetchEmployeeLogs } from '../src/utils/employeePerformance.js'

const dateRange = { start: '2026-10-01', end: '2026-10-22' }
const sites = [{ id: 's', name: 'Simple Site', opportunities_formula: 'simple' }, { id: 'd', name: 'Detailed Site', opportunities_formula: 'detailed' }]
const row = (employee_name, time_slot, total_washes, best, extra = {}) => ({ location_id: 's', log_date: '2026-10-20', employee_name, time_slot, split_index: 0, total_washes, member_washes: 0, basic: 0, good: 0, better: 0, best, google_reviews: 0, ...extra })
const fixture = () => [row('Alex','08:00:00',200,20),row('Blair','09:00:00',400,40),row('Casey','10:00:00',600,50)]
const build = (data, locations = sites, range = dateRange) => buildEmployeePerformance(data, locations, range)
const independent = values => values.map(([name,ms,opp],i)=>row(name,'08:00:00',opp,ms,{log_date:`2026-10-${String(i+1).padStart(2,'0')}`}))

test('uncapped points are sales plus displayed conversion and P-Mix percentages without benchmarks',()=>{
  const report=build(fixture()),[alex,blair,casey]=report.rows
  assert.equal(alex.score,130);assert.deepEqual(alex.contributions,{sales:20,conversion:10,pmix:100})
  assert.equal(blair.score,130);assert.equal(casey.score,115)
  for(const r of report.rows) assert.equal(r.score,Math.round((r.ms+parseFloat(r.conversion)+parseFloat(r.p_mix))*10)/10)
  assert.deepEqual(report.rows.map(r=>r.rank),[1,1,3]);assert.equal(employeeRankLabel(casey),'3')
  assert.equal(employeeRankLabel(alex),'1')
  assert.equal(report.cutoffs.sales,20);assert.equal(report.cutoffs.opportunities,200)
})

test('one unified ranking preserves each site opportunity formula and combines ratios after aggregation',()=>{
  const report=build([row('Simple','08:00:00',200,20),row('Detailed','08:00:00',200,100,{location_id:'d'})])
  const [simple,detailed]=report.rows
  assert.equal(simple.opp,200);assert.equal(detailed.opp,300)
  assert.equal(simple.score,130);assert.equal(detailed.score,233.3)
  assert.equal(simple.qualified,false);assert.equal(detailed.rank,1)
  const repeat=build([row('Alex','08:00:00',10,1),row('Alex','08:00:00',90,18,{log_date:'2026-10-21'})]).rows[0]
  assert.equal(repeat.ms,19);assert.equal(repeat.opp,100);assert.equal(repeat.convN,19);assert.equal(repeat.score,138)
})

test('qualification uses OR, odd populations round up, and both metric cutoff ties are included',()=>{
  const report=build(independent([['Sales',50,10],['Opportunity',1,1000],['Sales tie A',20,50],['Sales tie B',20,40],['Low',0,0]]))
  assert.equal(report.qualificationSize,3);assert.deepEqual(report.cutoffs,{sales:20,opportunities:40})
  assert.deepEqual(report.rows.filter(r=>r.qualified).map(r=>r.name),['Sales','Opportunity','Sales tie A','Sales tie B'])
  assert.equal(report.rows.at(-1).rank,null)
  const even=build(independent([['A',10,100],['B',5,50],['C',5,50],['D',1,10]]))
  assert.equal(even.qualificationSize,2);assert.equal(even.rows.filter(r=>r.qualified).length,3)
})

test('ranking uses total points and competition ties across formulas, without rank for nonqualifiers',()=>{
  const data=independent([['A',20,200],['B',20,200],['C',10,200],['D',1,1]])
  const report=build(data)
  assert.deepEqual(report.rows.map(r=>[r.score,r.rank]),[[130,1],[130,1],[115,3],[201,null]])
  assert.equal(employeeRankLabel(report.rows[3]),'Not Qualified')
  const mixed=build([row('A','08:00:00',200,20),row('B','08:00:00',180,20,{location_id:'d'})])
  assert.deepEqual(mixed.rows.map(r=>r.rank),[1,1])
})

test('all explicit-zero ties qualify and rank with finite zero points and visible zero rates',()=>{
  const report=build(independent([['A',0,0],['B',0,0],['C',0,0]]))
  for(const r of report.rows){assert.equal(r.score,0);assert.equal(r.rank,1);assert.equal(r.conversion,'0.0%');assert.equal(r.p_mix,'0.0%')}
  const zero=build([row('Zero','08:00:00',100,0)]).rows[0]
  assert.deepEqual(zero.contributions,{sales:0,conversion:0,pmix:0});assert.equal(zero.score,0)
})

test('genuinely missing opportunities remain missing even with known sales and qualification',()=>{
  const report=build([row('Alex','08:00:00',null,20)])
  const r=report.rows[0]
  assert.equal(r.ms,20);assert.equal(r.opp,null);assert.equal(r.conversion,'—');assert.equal(r.score,null)
  assert.equal(r.qualified,true);assert.equal(r.rank,null);assert.equal(employeeRankLabel(r),'Qualified · Incomplete data')
  assert.deepEqual(r.contributions,{sales:20,conversion:null,pmix:100})
  assert.match(report.attributionNotes[0].issues.join(' '),/Missing cumulative/)
})

test('missing sales are never invented zeros and unknown values cannot establish qualification',()=>{
  const r=build([row('Unknown','08:00:00',null,null,{member_washes:null,basic:null,good:null,better:null})]).rows[0]
  assert.equal(r.ms,null);assert.equal(r.opp,null);assert.equal(r.score,null);assert.equal(r.qualified,false)
  assert.equal(r.p_mix,'—');assert.equal(employeeRankLabel(r),'Not Qualified')
  const zero=build([row('Zero sales','08:00:00',null,0)]).rows[0]
  assert.equal(zero.contributions.sales,0);assert.equal(zero.contributions.pmix,0);assert.equal(zero.contributions.conversion,null)
})

test('positive sales without opportunities are undefined rather than infinite or fabricated conversion',()=>{
  const r=build([row('Sales','08:00:00',0,2)]).rows[0]
  assert.equal(r.opp,0);assert.equal(r.rate,null);assert.equal(r.score,null)
  assert.match(r.issues.join(' '),/conversion is undefined/)
})

test('missing checkpoints withhold the spanning attribution without inflating another employee',()=>{
  const report=build([row('A','08:00:00',20,2),row('B','09:00:00',null,null),row('C','10:00:00',60,6),row('D','11:00:00',80,8)])
  const [a,b,c,d]=report.rows
  assert.equal(a.ms,2);assert.equal(a.opp,20)
  assert.equal(b.ms,null);assert.equal(b.opp,null);assert.equal(c.ms,null);assert.equal(c.opp,null)
  assert.equal(d.ms,2);assert.equal(d.opp,20);assert.equal(d.score,112)
})

test('cumulative corrections withhold only affected previous contributors, never charge the entering employee',()=>{
  const report=build([row('Alex','08:00:00',200,20),row('Corrector','09:00:00',180,18),row('Blair','13:00:00',200,20)])
  const [alex,corrector,blair]=report.rows
  assert.equal(alex.ms,null);assert.equal(alex.score,null)
  assert.equal(corrector.ms,0);assert.equal(corrector.score,0)
  assert.equal(blair.ms,2);assert.equal(blair.opp,20);assert.equal(blair.score,112)
  assert.ok(report.rows.reduce((n,r)=>n+(r.ms??0),0)<=20)
})

test('tier corrections do not inflate P-Mix or suppress unrelated counters or employees',()=>{
  const report=build([row('Alex','08:00:00',200,10,{basic:10}),row('Blair','09:00:00',400,9,{basic:21})])
  const [alex,blair]=report.rows
  assert.equal(alex.ms,null);assert.equal(alex.mix,null);assert.equal(alex.opp,200)
  assert.equal(blair.ms,11);assert.equal(blair.mix,0);assert.equal(blair.score,16.5)
})

test('unknown formulas keep known sales and mix but cannot fabricate opportunities or total points',()=>{
  const r=build(fixture(),[{...sites[0],opportunities_formula:'unknown'}]).rows[0]
  assert.equal(r.opp,null);assert.equal(r.score,null);assert.equal(r.contributions.sales,20)
  assert.ok(r.issues.includes('Unknown opportunity formula'))
})

test('employee identities accumulate across days and split hours, case-insensitively within site only',()=>{
  const data=[row(' Alex ','08:00:00',200,20),row('Blair','08:00:00',400,40,{split_index:1}),row('aLEX','09:00:00',600,60),
    row('ALEX','08:00:00',100,10,{log_date:'2026-10-21'}),row('Alex','08:00:00',100,10,{location_id:'d'})]
  const before=JSON.stringify(data),report=build(data)
  assert.equal(JSON.stringify(data),before);assert.equal(report.rows.length,3)
  const alex=report.rows.find(r=>r.name==='Alex'&&r.locationId==='s')
  assert.equal(alex.ms,50);assert.equal(alex.opp,500)
  const other=report.rows.find(r=>r.locationId==='d');assert.equal(other.ms,10);assert.equal(other.opp,110)
  assert.notEqual(alex.key,other.key)
})

test('identical duplicate IDs are counted once; ambiguous checkpoints and conflicting copies cannot be ranked',()=>{
  const original=row('Alex','08:00:00',100,10,{id:'id1'})
  assert.deepEqual(build([original,{...original}]),build([original]))
  const conflict=build([original,{...original,best:20}]).rows[0]
  assert.equal(conflict.ms,null);assert.equal(conflict.score,null);assert.equal(conflict.rank,null)
  const duplicate=build([row('A','08:00:00',100,10),row('B','08:00:00',200,20)])
  assert.ok(duplicate.rows.every(r=>r.score===null));assert.match(duplicate.attributionNotes[0].issues.join(' '),/Duplicate checkpoint/)
})

test('selected dates/sites determine eligibility while unknown sites, old days and unnamed activity do not create employees',()=>{
  const data=[...fixture(),row('Other','08:00:00',10,1,{location_id:'d'}),row('Old','08:00:00',10,1,{log_date:'2026-09-30'})]
  const report=build(data,[sites[0]])
  assert.equal(report.population,3);assert.equal(report.qualificationSize,2)
  assert.ok(report.rows.every(r=>r.locationId==='s'&&r.name!=='Old'))
  const unnamed=build([row('','08:00:00',10,1),row('Alex','14:00:00',20,2)])
  assert.equal(unnamed.population,1);assert.equal(unnamed.rows[0].ms,1);assert.equal(unnamed.rows[0].opp,10)
  assert.match(unnamed.attributionNotes[0].issues.join(' '),/no employee name/)
})

test('missing shifts retain existing cumulative ending-checkpoint totals without attendance assumptions',()=>{
  const data=[row('Alex','08:00:00',20,2),row('Blair','14:00:00',50,5),row('Alex','17:00:00',60,6)]
  const report=build(data),expected=employeeDeltasByDay(data)
  for(const r of report.rows){assert.equal(r.ms,expected[r.name].best);assert.equal(r.opp,expected[r.name].total_washes)}
  assert.equal(inspectEmployeeDay(data).reliable,true)
})

test('reviews, stored opportunities and stored sales do not replace the legitimate cumulative sources',()=>{
  const data=fixture(),before=build(data).rows
  const after=build(data.map(r=>({...r,google_reviews:99999,opportunities:999999,memberships_sold:99999}))).rows
  assert.deepEqual(after.map(r=>[r.score,r.rank,r.contributions]),before.map(r=>[r.score,r.rank,r.contributions]))
})

test('sorting is numeric, leaves missing values last both ways, and never recomputes ranks',()=>{
  const rows=build([...fixture(),row('Missing','08:00:00',null,3,{location_id:'d'})]).rows
  for(const dir of ['asc','desc'])assert.equal(sortEmployeeRows(rows,{col:'score',dir}).at(-1).name,'Missing')
  assert.equal(sortEmployeeRows(rows,{col:'opp',dir:'asc'})[0].opp,200)
  const before=rows.map(r=>r.rank);sortEmployeeRows(rows,{col:'name',dir:'desc'});assert.deepEqual(rows.map(r=>r.rank),before)
  assert.equal(sortEmployeeRows(rows,{col:'rank',dir:'asc'})[0].rank,1)
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

test('conflicting record IDs across dates cannot create separate scored activity',()=>{
  const data=[row('Alex','08:00:00',100,10,{id:'same'}),row('Alex','08:00:00',200,20,{id:'same',log_date:'2026-10-21'})]
  const r=build(data).rows[0];assert.equal(r.score,null);assert.equal(r.ms,null)
})

test('displayed one-decimal percentage points add exactly and equal displayed totals share ranks',()=>{
  const r=build([row('Mix','08:00:00',200,8,{basic:2})]).rows[0]
  assert.equal(r.conversion,'5.0%');assert.equal(r.p_mix,'80.0%');assert.equal(r.score,95)
  const fractional=build(independent([['A',1,3],['B',1,3]])).rows
  assert.ok(fractional.every(r=>r.score===134.3&&r.rank===1))
})

test('when fewer than half have known totals, missing totals never become zero qualification evidence',()=>{
  const unknown=name=>row(name,'08:00:00',null,null,{member_washes:null,basic:null,good:null,better:null,log_date:'2026-10-'+({B:'02',C:'03',D:'04'}[name])})
  const report=build([row('A','08:00:00',10,1),unknown('B'),unknown('C'),unknown('D')])
  assert.equal(report.qualificationSize,2);assert.equal(report.rows[0].qualified,true)
  assert.ok(report.rows.slice(1).every(r=>!r.qualified&&r.score===null&&r.rank===null))
  assert.deepEqual(report.cutoffs,{sales:1,opportunities:10})
})

test('repeated corrections stay restricted to prior contributors of the corrected counter',()=>{
  const report=build([row('Basic seller','08:00:00',20,0,{basic:2}),row('Premium seller','10:00:00',40,2,{basic:2}),row('Basic seller','12:00:00',60,2,{basic:1}),row('Later seller','14:00:00',80,3,{basic:1}),row('Corrector','16:00:00',100,3,{basic:0})])
  assert.equal(report.rows.find(r=>r.name==='Basic seller').score,null)
  for(const name of ['Premium seller','Later seller','Corrector'])assert.notEqual(report.rows.find(r=>r.name===name).score,null)
  assert.ok(report.rows.reduce((sum,r)=>sum+(r.ms??0),0)<=3)
})
