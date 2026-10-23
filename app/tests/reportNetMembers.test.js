import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { shiftDate } from '../src/utils/budgetRevenue.js'
import * as membership from '../src/utils/dashboardNetMembers.js'

function harness(globals, locations, range, mtd = true) {
  const hooks = []; let cursor, queued, dirty, result
  const useState = initial => {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = initial
    return [hooks[index], value => { hooks[index] = value; dirty = true }]
  }
  const useEffect = (effect, deps) => {
    const index = cursor++, old = hooks[index]
    if (!old || deps.some((v,i) => v !== old.deps[i])) queued.push(() => {old?.cleanup?.();hooks[index]={deps,cleanup:effect()}})
  }
  const bindings = { useState, useEffect, shiftDate, ...membership, watchBudgetReport: () => () => {}, supabase: {}, ...globals }
  const mod = { exports: {} }
  const source=readFileSync(new URL('../src/hooks/useReportNetMembers.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  new Function('module','exports',...Object.keys(bindings),transformSync(source,{format:'cjs'}).code)(mod,mod.exports,...Object.values(bindings))
  const render=()=>{do{dirty=false;cursor=0;queued=[];result=mod.exports.default(locations,range,mtd);queued.forEach(f=>f())}while(dirty);return result}
  return { render, async flush(){for(let i=0;i<12;i++){await Promise.resolve();render()}return result}, change(next){range=next;return render()} }
}
const locations=[{id:'a',show_budget_tracking:true,opportunities_formula:'simple',timezone:'America/New_York'}]
const range={start:'2026-10-01',end:'2026-10-23'}

test('Reports MTD uses prior-day coverage, passes selected morning cutoff, and resets on range changes',async()=>{
 const requests=[],pending=[]
 const h=harness({
  loadPerformanceLogs(client,locs,r){requests.push(r);return new Promise(resolve=>pending.push(resolve))},
  async loadMembershipSnapshots(client,locs,r,cutoff){assert.equal(cutoff,shiftDate(r.end,1));return [{location_id:'a',starting_members:100,active_members:100,covered_through:r.end}]},
 },locations,range)
 h.render()
 assert.deepEqual(requests,[{start:'2026-10-01',end:'2026-10-22'}])
 assert.deepEqual(h.change({...range,end:'2026-10-21'}).values,{})
 pending[1]([]);let current=await h.flush()
 assert.equal(current.values.a.through,'2026-10-20');assert.equal(current.values.a.value,0)
 pending[0]([]);current=await h.flush()
 assert.equal(current.values.a.through,'2026-10-20','late old cutoff cannot replace current result')
})

test('Reports daily fallback reads prior history but respects selected cutoff; read errors show no invented value',async()=>{
 const h=harness({async loadDailyNetHistory(client,locs,r){assert.equal(r,'2026-10-23');return [{location_id:'a',log_date:'2026-10-21',time_slot:'08:00:00',plans_lost_today:0,basic:0}]}},locations,range,false)
 h.render();const current=await h.flush()
 assert.equal(current.values.a.value,0);assert.equal(current.values.a.through,'2026-10-21')
 const bad=harness({async loadPerformanceLogs(){throw new Error('Read denied')}},locations,range)
 bad.render();const failed=await bad.flush()
 assert.deepEqual(failed.values,{});assert.match(failed.error,/Read denied/)
})

test('Network Day View renders dated daily zero and signed values with the existing colors', async () => {
 const React = (await import('react')).default
 const { renderToStaticMarkup } = await import('react-dom/server')
 const { netMembersCls } = await import('../src/utils/netMemberColors.js')
 const source=readFileSync(new URL('../src/components/NetworkDayView.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')+'\nexport { ShopCard }'
 const mod={exports:{}}
 new Function('module','exports','React','netMembersCls','fmtNum','pmixTextCls','convTextCls',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,netMembersCls,()=> '',()=> '',()=> '')
 for (const [value,color] of [[0,'yellow'],[-2,'red'],[3,'green']]) {
  const html=renderToStaticMarkup(React.createElement(mod.exports.ShopCard,{location:locations[0],rows:[],net:{value,through:'2026-10-21'}}))
  assert.match(html,new RegExp(`Daily Net Members: ${value}`))
  assert.match(html,/Last entry: Oct 21, 2026/)
  assert.match(html,new RegExp(`bg-${color}-100`))
 }
 const empty=renderToStaticMarkup(React.createElement(mod.exports.ShopCard,{location:locations[0],rows:[],net:{value:null,through:null}}))
 assert.match(empty,/Daily Net Members: —/)
 assert.doesNotMatch(empty,/Last entry:/)
})
