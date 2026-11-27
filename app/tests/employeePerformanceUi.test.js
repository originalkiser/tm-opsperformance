import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as posSales from '../src/utils/teamSalesPos.js'
import * as scoring from '../src/utils/employeePerformance.js'
import * as colors from '../src/utils/metricColors.js'
import { thCls } from '../src/utils/insightsHelpers.js'
import { fmtNum } from '../src/utils/format.js'

const dateRange={start:'2026-10-01',end:'2026-10-22'},locations=[{id:'s',name:'Site',opportunities_formula:'simple'}]
const row=(name,time,total,best)=>({location_id:'s',log_date:'2026-10-20',employee_name:name,time_slot:time,split_index:0,total_washes:total,member_washes:0,basic:0,good:0,better:0,best,google_reviews:2})
const fixture=()=>[row('Alex','08:00:00',200,20),row('Blair','09:00:00',400,40),row('Casey','10:00:00',600,50)]
const source=readFileSync(new URL('../src/components/EmployeeScoreDetails.jsx',import.meta.url),'utf8')
const mod={exports:{}}
new Function('module','exports','React',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React)
const Export=()=>null
const walk=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(walk)]
async function table(data=fixture(),dataComplete=true,locs=locations,overrides={}) {
  let spec
  const h=locationHelpHarness('components/TeamSalesTable',{
    supabase:{},readMappings:async()=>[],usePosMembershipReport:()=>null,useTeamSalesIdentities:()=>null,...overrides,
    ...scoring,...posSales,...colors,thCls,fmtNum,EmployeeScoreDetails:mod.exports.default,
    ExportMenu:Export,fmtDateRange:()=> 'October',exportCsv:value=>{spec=value},exportXlsx:value=>{spec=value},exportPdf:value=>{spec=value},
  },{data,locations:locs,dateRange,dataComplete})
  h.csv=()=>{h.find(n=>n.type===Export).props.items[2].run();return spec}
  h.html=()=>renderToStaticMarkup(h.render())
  h.export=index=>{h.find(n=>n.type===Export).props.items[index].run();return spec}
  h.sort=label=>{
    const t=h.find(n=>n.type?.name==='Table'),table=t.type(t.props)
    const head=walk(table).find(n=>n.type?.name==='TableHead'),tree=head.type(head.props)
    walk(tree).find(n=>n.type==='button'&&n.props.children?.[0]===label).props.onClick()
  }
  h.render();await h.flush();return h
}

test('unified leaderboard shows requested columns, visible points arithmetic, accessible sorting and themes',async()=>{
  const h=await table(),html=h.html()
  for(const label of ['Rank','Employee','Site','TM Ops Sales','POS Verified Sales','Difference','Total Opportunities','Conversion %','P-Mix %','Total Points'])assert.ok(html.includes(label))
  assert.match(html,/130\.0/);assert.match(html,/20 \+ 10\.0 \+ 100\.0/)
  assert.doesNotMatch(html,/Simple #|Detailed #|33\.33|Score details|Google Reviews/)
  assert.match(html,/scope="col"/);assert.match(html,/aria-sort="ascending"/);assert.match(html,/dark:/);assert.match(html,/overflow-x-auto/)
  h.sort('Total Points');assert.equal(h.csv().rows[0][1],'Alex')
  h.sort('Total Points');assert.equal(h.csv().rows[0][1],'Casey')
  h.unmount()
})

test('By Site is a presentation change, retaining unified rank/qualification and aligned exports',async()=>{
  const locs=[...locations,{id:'d',name:'Detailed',opportunities_formula:'detailed'}]
  const h=await table([...fixture(),{...row('Other','08:00:00',100,10),location_id:'d'}],true,locs),before=h.csv()
  h.find(n=>n.type==='button'&&n.props.children==='By Site').props.onClick()
  const html=h.html();assert.match(html,/Detailed/);assert.doesNotMatch(html,/Simple #|Detailed #/)
  assert.deepEqual(h.csv().rows,before.rows)
  assert.equal(before.columns.length,11);assert.ok(before.rows.every(r=>r.length===11));assert.equal(before.totalsRow.length,11)
  assert.deepEqual(before.columns.map(c=>c.label),['Rank','Employee','Site','TM Ops Sales','POS Verified Sales','Difference','Total Opportunities','Conversion %','P-Mix %','Total Points','Data status'])
  h.unmount()
})

test('low-volume employees receive their computed points and official rank',async()=>{
  const h=await table([row('A','08:00:00',200,20),row('B','09:00:00',400,40),row('Low','10:00:00',410,41)])
  assert.doesNotMatch(h.html(),/Not Qualified|Top 50%|cutoff ties|Top 2 cutoff/)
  const low=h.csv().rows.find(r=>r[1]==='Low');assert.equal(low[0],'3');assert.equal(low[9],111)
  h.sort('Rank');assert.equal(h.csv().rows[0][0],'3')
  h.unmount()
})

test('missing opportunities retain known sales, missing indicators and incomplete status in UI/export',async()=>{
  const h=await table([row('Alex','08:00:00',null,20)]),html=h.html(),spec=h.csv()
  assert.match(html,/Unranked · Incomplete or invalid data/);assert.match(html,/Missing cumulative/)
  assert.match(html,/Known attributed subtotal/);assert.doesNotMatch(html,/NaN|Infinity/)
  assert.equal(spec.rows[0][3],20);assert.equal(spec.rows[0][6],'');assert.equal(spec.rows[0][7],'—');assert.equal(spec.rows[0][9],'')
  assert.equal(spec.totalsRow[7],'—');assert.equal(spec.totalsRow[8],'100.0%')
  h.unmount()
})

test('zero sales and positive opportunities are visible zero rates, points and rank',async()=>{
  const h=await table([row('Zero','08:00:00',1,0)]),html=h.html(),r=h.csv().rows[0]
  assert.deepEqual(r.slice(0,10),['1','Zero','Site',0,'','',1,'0.0%','0.0%',0])
  assert.match(html,/0\.0%/);assert.doesNotMatch(html,/NaN|Infinity|Not Qualified|Incomplete data/)
  assert.equal(h.csv().totalsRow[7],'0.0%');h.unmount()
})

test('correction ambiguity does not fabricate totals or rank and unaffected employees retain raw points',async()=>{
  const h=await table([row('Alex','08:00:00',200,20),row('Corrector','09:00:00',180,18),row('Blair','10:00:00',200,20)])
  const spec=h.csv();assert.match(h.html(),/Cumulative counts decreased/)
  assert.equal(spec.rows.find(r=>r[1]==='Alex')[9],'')
  assert.equal(spec.rows.find(r=>r[1]==='Blair')[9],112)
  assert.equal(spec.totalsRow[1],'Known attributed subtotal')
  h.unmount()
})

test('all export buttons use the same aligned table specification and selected reporting period',async()=>{
  const h=await table(),spec=h.csv()
  assert.equal(spec.filename,'team-member-sales_2026-10-01_to_2026-10-22')
  assert.match(spec.subtitle,/All complete, valid employee data qualifies/)
  assert.equal(h.find(n=>n.type===Export).props.items.length,3)
  assert.deepEqual(h.export(0),spec);assert.deepEqual(h.export(1),spec)
  assert.ok(spec.rows.every(r=>r.length===spec.columns.length));assert.equal(spec.totalsRow.length,spec.columns.length)
  h.unmount()
})

test('incomplete reads withhold rankings and unnamed activity remains visible as a limitation',async()=>{
  const failed=await table(fixture(),false)
  assert.match(failed.html(),/role="alert"/);assert.match(failed.html(),/data is incomplete/)
  assert.doesNotMatch(failed.html(),/130\.0/);failed.unmount()
  const unnamed=await table([row('','08:00:00',200,20)])
  assert.match(unnamed.html(),/no employee name/);assert.match(unnamed.html(),/No named employee data/);unnamed.unmount()
})

test('Reports Team Sales integration scopes complete reads and rejects late or failed requests before ranking',async()=>{
  const source=readFileSync(new URL('../src/pages/Reports.jsx',import.meta.url),'utf8')
  const load=source.slice(source.indexOf('  const fetchLogs = async () => {'),source.indexOf('  const fetchDowntimeLogs = async () => {'))
  let state,loading
  const teamRequest={current:0},pending=[]
  function request(range) {
    const bindings={activeReport:'team',teamRequest,locations,dateRange:range,teamScope:`s:${range.start}:${range.end}`,
      supabaseClient:{},setLoading:v=>{loading=v},setTeamLogState:v=>{state=v},
      fetchEmployeeLogs:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
      setLogs:()=>assert.fail('Team reads must not replace other reports data'),
    }
    return new Function(...Object.keys(bindings),load+';return fetchLogs')(...Object.values(bindings))()
  }
  const first=request(dateRange),nextRange={...dateRange,end:'2026-10-21'},second=request(nextRange)
  pending[1].resolve(fixture());await second
  assert.equal(state.scope,'s:2026-10-01:2026-10-21');assert.equal(state.complete,true)
  pending[0].resolve([]);await first
  assert.equal(state.scope,'s:2026-10-01:2026-10-21');assert.equal(state.rows.length,3)
  const failed=request(dateRange);pending[2].reject(new Error('denied'));await failed
  assert.equal(state.complete,false);assert.deepEqual(state.rows,[]);assert.equal(loading,false)
  assert.match(source,/dataComplete=\{teamLogState\?\.scope === teamScope && teamLogState.complete\}/)
})

test('Insights uses verified scoped reads and cancellation prevents late results or failed reads from ranking',async()=>{
  const source=readFileSync(new URL('../src/pages/Insights.jsx',import.meta.url),'utf8')
  const effect=source.slice(source.indexOf('    let cancelled = false'),source.indexOf('  }, [teamScope])'))
  const pending=[],states=[]
  const start=()=>new Function('fetchEmployeeLogs','supabase','locations','dateRange','teamScope','setTeamLogState',effect)(
    ()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),{},locations,dateRange,'scope',v=>states.push(v))
  const cancel=start();assert.equal(states.at(-1).complete,false)
  cancel();const cleanup=start();pending[1].resolve(fixture());await Promise.resolve();await Promise.resolve()
  assert.equal(states.at(-1).complete,true);assert.equal(states.at(-1).rows.length,3)
  pending[0].resolve([]);await Promise.resolve();assert.equal(states.at(-1).rows.length,3)
  cleanup();start();pending[2].reject(new Error('denied'));await Promise.resolve();await Promise.resolve()
  assert.equal(states.at(-1).complete,false);assert.deepEqual(states.at(-1).rows,[])
  assert.match(source,/dataComplete=\{teamLogState\?\.scope === teamScope && teamLogState.complete\}/)
  assert.match(source,/fetchEmployeeLogs\(supabase, locations.map\(l => l.id\), dateRange\)/)
})

test('Team Sales displays and exports the same approved attribution, without combining pending aliases', async()=>{
  const logs=[row('Alex','08:00:00',200,20),row('Alias','09:00:00',400,40)]
  const mappings=['Alex','Alias'].map((original_name,i)=>({id:String(i),original_name,location_id:'s',employee_id:'one',employee_name:'Official',status:'approved'}))
  const h=await table(logs,true,locations,{readMappings:async()=>mappings})
  assert.equal(h.csv().rows.length,1)
  assert.equal(h.csv().rows[0][1],'Official')
  assert.equal(h.csv().rows[0][3],40)
  h.unmount()
})
test('mapping read failure or missing RPC withholds scores rather than hiding approved decisions',async()=>{
  const failed=await table(fixture(),true,locations,{readMappings:async()=>{throw new Error('offline')}})
  assert.match(failed.html(),/Historical mappings could not be verified/)
  assert.doesNotMatch(failed.html(),/130\.0/);failed.unmount()
  const absent=await table(fixture(),true,locations,{readMappings:async()=>{throw Object.assign(new Error('missing table'),{code:'42P01'})}})
  assert.match(absent.html(),/Historical mappings could not be verified/);absent.unmount()
})


test('zero and negative opportunities show unranked reasons and missing conversion in UI and exports',async()=>{
 for(const total of [0,-1]) {
  const data=total===0?[row('Invalid','08:00:00',0,0)]:[{...row('Invalid','08:00:00',1,0),member_washes:2}]
  const h=await table(data),spec=h.csv(),html=h.html()
  assert.match(html,/Unranked/);assert.match(html,/Opportunities must be positive/)
  assert.equal(spec.rows[0][7],'—');assert.equal(spec.rows[0][9],'')
  assert.match(spec.rows[0][10],/Opportunities must be positive/)
  assert.equal(spec.totalsRow[7],'—');assert.doesNotMatch(html,/NaN|Infinity/)
  h.unmount()
 }
})

test('POS columns join by verified site and employee, sort numerically, and preserve legacy rank and metrics',async()=>{
  const locs=[...locations,{id:'d',name:'Other site',opportunities_formula:'simple'}]
  const data=fixture().map((r,i)=>({...r,employee_id:['alex','blair','casey'][i]}))
  const report={
    people:[{location_id:'s',employee_id:'alex',name:'Canonical Alex',credited:25},{location_id:'s',employee_id:'new',name:'POS Only',credited:4},
      {location_id:'outside',employee_id:'casey',name:'Outside',credited:100}],
    coverage:[{loc:'s',imported:true,gsr:29,observed:29,unresolved:0},{loc:'d',imported:false,gsr:0,observed:0,unresolved:0}],
  }
  const baseline=await table(data,true,locs)
  const h=await table(data,true,locs,{usePosMembershipReport:(sites,start,end)=>{
    assert.deepEqual(sites,locs);assert.deepEqual({start,end},dateRange);return {result:report}
  }})
  const rows=h.csv().rows
  for(const r of baseline.csv().rows)assert.deepEqual(rows.find(j=>j[1]===r[1]).filter((_,i)=>[0,1,2,3,6,7,8,9].includes(i)),r.filter((_,i)=>[0,1,2,3,6,7,8,9].includes(i)))
  assert.deepEqual(rows.find(r=>r[1]==='Alex').slice(3,6),[20,25,-5])
  assert.deepEqual(rows.find(r=>r[1]==='Blair').slice(4,6),[0,20])
  assert.deepEqual(rows.find(r=>r[1]==='POS Only').slice(0,6),['—','POS Only','Site','',4,''])
  assert.ok(!rows.some(r=>r[1]==='Outside'))
  h.sort('POS Verified Sales');assert.equal(h.csv().rows[0][1],'Alex')
  h.sort('POS Verified Sales');assert.equal(h.csv().rows[0][1],'Blair')
  h.sort('Difference');assert.equal(h.csv().rows[0][1],'Blair')
  h.sort('Difference');assert.equal(h.csv().rows[0][1],'Alex')
  h.find(n=>n.type==='button'&&n.props.children==='By Site').props.onClick()
  assert.match(h.html(),/POS Only/)
  assert.deepEqual(h.export(0),h.export(1))
  baseline.unmount();h.unmount()
})

test('partial POS credits remain visible; unavailable counts and unverified identities stay blank in exports',async()=>{
  const data=[{...row('Alex','08:00:00',200,20),employee_id:'alex'},row('Unverified','09:00:00',250,22),
    {...row('Without credits','10:00:00',300,25),employee_id:'zero'}]
  const report={people:[{location_id:'s',employee_id:'alex',name:'Alex',credited:4}],
    coverage:[{loc:'s',imported:true,gsr:9,observed:7,unresolved:1}]}
  const h=await table(data,true,locations,{usePosMembershipReport:()=>({result:report})})
  assert.deepEqual(h.csv().rows.find(r=>r[1]==='Alex').slice(3,6),[20,4,16])
  assert.match(h.html(),/4 · Partial/)
  assert.match(h.csv().rows.find(r=>r[1]==='Alex')[10],/POS: Partial/)
  assert.deepEqual(h.csv().rows.find(r=>r[1]==='Without credits').slice(4,6),['',''])
  assert.match(h.csv().rows.find(r=>r[1]==='Unverified')[10],/identity unverified/)
  h.unmount()
})

test('approved historical aliases join to POS while identical names in other locations stay independent',async()=>{
  const locs=[...locations,{id:'d',name:'Other site',opportunities_formula:'simple'}]
  const logs=[row('Alex','08:00:00',100,7),{...row('Alex','08:00:00',100,3),location_id:'d',employee_id:'other'}]
  const report={people:[{location_id:'s',employee_id:'alex',name:'Alex',credited:5},{location_id:'d',employee_id:'other',name:'Alex',credited:1}],
    coverage:locs.map(({id})=>({loc:id,imported:true,gsr:5,observed:5,unresolved:0}))}
  const mappings=[{id:'mapping',original_name:'Alex',location_id:'s',employee_id:'alex',employee_name:'Alex',status:'approved',start_date:'2026-10-20',end_date:'2026-10-20'}]
  const h=await table(logs,true,locs,{readMappings:async()=>mappings,usePosMembershipReport:()=>({result:report})})
  assert.deepEqual(h.csv().rows.find(r=>r[2]==='Site').slice(3,6),[7,5,2])
  assert.deepEqual(h.csv().rows.find(r=>r[2]==='Other site').slice(3,6),[3,1,2])
  const posOnly=await table([],true,locs,{usePosMembershipReport:()=>({result:report})})
  assert.deepEqual(posOnly.csv().rows.map(r=>r.slice(3,6)).sort(),[['',1,''],['',5,'']])
  h.unmount();posOnly.unmount()
})

test('verified roster names resolve name-only logs without guessing between active names or duplicating split rows',async()=>{
  const data=[row('Kaden','08:00:00',100,7),row('Dasia','09:00:00',200,10),
    row('Ambiguous','10:00:00',300,12),row('Rylan','11:00:00',400,14),
    {...row('Rylan','12:00:00',100,3),log_date:'2026-10-21'},row('Old name','13:00:00',500,16)]
  const roster=[['k','Kaden',true],['d','Dasia',true],['di','Dasia',false],
    ['a','Ambiguous',true],['a2','Ambiguous',true],['r','Rylan',true],['old','Old name',false],['kept','Retained',true]]
    .map(([id,name,is_active])=>({id,name,is_active,location_id:'s'}))
  const audits=[{location_id:'s',retained_id:'kept',roster_before:[{id:'old'},{id:'kept'}]}]
  const report={people:[['k','Kaden',6],['d','Dasia',2],['a','Ambiguous',3],['r','Rylan',4],['kept','Retained',1]]
    .map(([employee_id,name,credited])=>({location_id:'s',employee_id,name,credited})),
    coverage:[{loc:'s',imported:true,gsr:16,observed:15,unresolved:0}]}
  const mappings=[{id:'one',location_id:'s',original_name:'Rylan',employee_name:'Rylan',employee_id:'r',status:'approved',end_date:'2026-10-20'}]
  const h=await table(data,true,locations,{readMappings:async()=>mappings,usePosMembershipReport:()=>({result:report}),
    useTeamSalesIdentities:()=>({sites:[{id:'s',roster,audits}]})})
  const rows=h.csv().rows
  assert.deepEqual(rows.find(r=>r[1]==='Kaden').slice(3,6),[7,6,1])
  assert.equal(rows.find(r=>r[1]==='Dasia')[4],2)
  assert.equal(rows.find(r=>r[1]==='Old name')[4],1)
  assert.equal(rows.find(r=>r[1]==='Ambiguous'&&r[3]!=='')[4],'')
  assert.equal(rows.find(r=>r[1]==='Ambiguous'&&r[3]==='')[4],3)
  assert.deepEqual(rows.filter(r=>r[1]==='Rylan').map(r=>[r[4],r[5]]),[['',''],[4,'']])
  assert.match(h.html(),/TM Ops sales span multiple rows/)
  h.unmount()
})
