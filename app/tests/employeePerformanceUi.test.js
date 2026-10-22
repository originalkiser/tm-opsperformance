import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as scoring from '../src/utils/employeePerformance.js'
import * as colors from '../src/utils/metricColors.js'
import { pct, thCls } from '../src/utils/insightsHelpers.js'
import { fmtNum } from '../src/utils/format.js'

const dateRange={start:'2026-10-01',end:'2026-10-22'},locations=[{id:'s',name:'Site',opportunities_formula:'simple'}]
const row=(name,time,total,best)=>({location_id:'s',log_date:'2026-10-20',employee_name:name,time_slot:time,split_index:0,total_washes:total,member_washes:0,basic:0,good:0,better:0,best,google_reviews:2})
const fixture=()=>[row('Alex','08:00:00',200,20),row('Blair','09:00:00',400,40),row('Casey','10:00:00',600,50)]
const source=readFileSync(new URL('../src/components/EmployeeScoreDetails.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
const mod={exports:{}}
new Function('module','exports','React','EMPLOYEE_WEIGHTS',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,scoring.EMPLOYEE_WEIGHTS)
const Export=()=>null
function table(data=fixture(),dataComplete=true) {
  let spec
  const h=locationHelpHarness('components/TeamSalesTable',{
    ...scoring,...colors,pct,thCls,fmtNum,EmployeeScoreDetails:mod.exports.default,
    ExportMenu:Export,fmtDateRange:()=> 'October',exportCsv:value=>{spec=value},
  },{data,locations,dateRange,dataComplete})
  h.csv=()=>{h.find(n=>n.type===Export).props.items[2].run();return spec}
  h.html=()=>renderToStaticMarkup(h.render())
  h.sort=label=>{
    const head=h.find(n=>n.type?.name==='TableHead')
    const tree=head.type(head.props)
    const walk=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(walk)]
    walk(tree).find(n=>n.type==='button'&&n.props.children?.[0]===label).props.onClick()
  }
  return h
}
test('Team Sales retains informational columns and adds accessible sortable score/rank with three contributions',()=>{
  const h=table(),html=h.html()
  for(const label of ['Memberships','Google Reviews','P-Mix','Conversion','Score','Rank'])assert.ok(html.includes(label))
  assert.match(html,/100\.00/);assert.match(html,/Simple #1/);assert.match(html,/Sales: 33\.33/)
  assert.match(html,/Conversion: 33\.33/);assert.match(html,/P-Mix: 33\.34/)
  assert.match(html,/Google Reviews do not affect scoring/);assert.match(html,/scope="col"/)
  h.sort('Score');assert.equal(h.csv().rows[0][0],'Alex')
  h.sort('Score');assert.equal(h.csv().rows[0][0],'Casey')
  h.unmount()
})
test('By Site mode preserves formula-cohort rank labels and exports contain score/rank/attribution status',()=>{
  const h=table(),before=h.csv()
  h.find(n=>n.type==='button'&&n.props.children==='By Site').props.onClick()
  assert.match(h.html(),/Simple #3/)
  const after=h.csv();assert.deepEqual(after.rows,before.rows)
  assert.equal(after.columns.length,9);assert.ok(after.rows.every(r=>r.length===9));assert.equal(after.totalsRow.length,9)
  h.unmount()
})
test('corrected days show partial attribution and withheld scores rather than inflated employee figures',()=>{
  const data=[row('Alex','08:00:00',200,20),row('Alex','09:00:00',180,18),row('Blair','10:00:00',200,20)]
  const h=table(data),html=h.html(),spec=h.csv()
  assert.match(html,/Cumulative counts decreased/);assert.match(html,/Partial · unreliable days excluded/)
  assert.match(html,/Unavailable/);assert.match(html,/Unranked/);assert.match(html,/Known-day subtotal/)
  assert.ok(spec.rows.every(r=>r[2]===''&&r[6]===''&&r[7]==='Unranked'))
  assert.equal(spec.totalsRow[0],'Known-day subtotal')
  h.unmount()
})
test('zero opportunities and an incomplete data read never render an official score',()=>{
  const zero=table([row('Zero','08:00:00',0,0)]),html=zero.html()
  assert.match(html,/Minimum 100/);assert.match(html,/Unavailable/);assert.doesNotMatch(html,/NaN|Infinity/)
  zero.unmount()
  const failed=table(fixture(),false),failure=failed.html()
  assert.match(failure,/role="alert"/);assert.match(failure,/data is incomplete/)
  assert.doesNotMatch(failure,/100\.00|Simple #1/);failed.unmount()
})
test('entirely unnamed activity is surfaced as unreliable rather than hidden behind an empty employee table',()=>{
  const h=table([row('','08:00:00',200,20)]),html=h.html()
  assert.match(html,/no employee name/);assert.match(html,/No reliably attributed employee data/)
  h.unmount()
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
