import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
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
function table(data=fixture(),dataComplete=true,locs=locations) {
  let spec
  const h=locationHelpHarness('components/TeamSalesTable',{
    ...scoring,...colors,thCls,fmtNum,EmployeeScoreDetails:mod.exports.default,
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
  return h
}

test('unified leaderboard shows requested columns, visible points arithmetic, accessible sorting and themes',()=>{
  const h=table(),html=h.html()
  for(const label of ['Rank','Employee','Site','Total Sales','Total Opportunities','Conversion %','P-Mix %','Total Points'])assert.ok(html.includes(label))
  assert.match(html,/130\.0/);assert.match(html,/20 \+ 10\.0 \+ 100\.0/)
  assert.doesNotMatch(html,/Simple #|Detailed #|33\.33|Score details|Google Reviews/)
  assert.match(html,/scope="col"/);assert.match(html,/aria-sort="ascending"/);assert.match(html,/dark:/);assert.match(html,/overflow-x-auto/)
  h.sort('Total Points');assert.equal(h.csv().rows[0][1],'Alex')
  h.sort('Total Points');assert.equal(h.csv().rows[0][1],'Casey')
  h.unmount()
})

test('By Site is a presentation change, retaining unified rank/qualification and aligned exports',()=>{
  const locs=[...locations,{id:'d',name:'Detailed',opportunities_formula:'detailed'}]
  const h=table([...fixture(),{...row('Other','08:00:00',100,10),location_id:'d'}],true,locs),before=h.csv()
  h.find(n=>n.type==='button'&&n.props.children==='By Site').props.onClick()
  const html=h.html();assert.match(html,/Detailed/);assert.doesNotMatch(html,/Simple #|Detailed #/)
  assert.deepEqual(h.csv().rows,before.rows)
  assert.equal(before.columns.length,9);assert.ok(before.rows.every(r=>r.length===9));assert.equal(before.totalsRow.length,9)
  assert.deepEqual(before.columns.map(c=>c.label),['Rank','Employee','Site','Total Sales','Total Opportunities','Conversion %','P-Mix %','Total Points','Data status'])
  h.unmount()
})

test('nonqualifiers stay visible with their computed points and no official rank',()=>{
  const h=table([row('A','08:00:00',200,20),row('B','09:00:00',400,40),row('Low','10:00:00',410,41)])
  assert.match(h.html(),/Not Qualified/)
  const low=h.csv().rows.find(r=>r[1]==='Low');assert.equal(low[0],'Not Qualified');assert.equal(low[7],111)
  h.sort('Rank');assert.equal(h.csv().rows.at(-1)[0],'Not Qualified')
  h.unmount()
})

test('missing opportunities retain known sales, missing indicators and incomplete status in UI/export',()=>{
  const h=table([row('Alex','08:00:00',null,20)]),html=h.html(),spec=h.csv()
  assert.match(html,/Qualified · Incomplete data/);assert.match(html,/Missing cumulative/)
  assert.match(html,/Known attributed subtotal/);assert.doesNotMatch(html,/NaN|Infinity/)
  assert.equal(spec.rows[0][3],20);assert.equal(spec.rows[0][4],'');assert.equal(spec.rows[0][5],'—');assert.equal(spec.rows[0][7],'')
  assert.equal(spec.totalsRow[5],'—');assert.equal(spec.totalsRow[6],'100.0%')
  h.unmount()
})

test('zero sales and zero opportunities are visible zero rates, points and unified rank',()=>{
  const h=table([row('Zero','08:00:00',0,0)]),html=h.html(),r=h.csv().rows[0]
  assert.deepEqual(r.slice(0,8),['1','Zero','Site',0,0,'0.0%','0.0%',0])
  assert.match(html,/0\.0%/);assert.doesNotMatch(html,/NaN|Infinity|Not Qualified|Incomplete data/)
  assert.equal(h.csv().totalsRow[5],'0.0%');h.unmount()
})

test('correction ambiguity does not fabricate totals or rank and unaffected employees retain raw points',()=>{
  const h=table([row('Alex','08:00:00',200,20),row('Corrector','09:00:00',180,18),row('Blair','10:00:00',200,20)])
  const spec=h.csv();assert.match(h.html(),/Cumulative counts decreased/)
  assert.equal(spec.rows.find(r=>r[1]==='Alex')[7],'')
  assert.equal(spec.rows.find(r=>r[1]==='Blair')[7],112)
  assert.equal(spec.totalsRow[1],'Known attributed subtotal')
  h.unmount()
})

test('all export buttons use the same aligned table specification and selected reporting period',()=>{
  const h=table(),spec=h.csv()
  assert.equal(spec.filename,'team-member-sales_2026-10-01_to_2026-10-22')
  assert.match(spec.subtitle,/cutoff ties included/)
  assert.equal(h.find(n=>n.type===Export).props.items.length,3)
  assert.deepEqual(h.export(0),spec);assert.deepEqual(h.export(1),spec)
  assert.ok(spec.rows.every(r=>r.length===spec.columns.length));assert.equal(spec.totalsRow.length,spec.columns.length)
  h.unmount()
})

test('incomplete reads withhold rankings and unnamed activity remains visible as a limitation',()=>{
  const failed=table(fixture(),false)
  assert.match(failed.html(),/role="alert"/);assert.match(failed.html(),/data is incomplete/)
  assert.doesNotMatch(failed.html(),/130\.0/);failed.unmount()
  const unnamed=table([row('','08:00:00',200,20)])
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
