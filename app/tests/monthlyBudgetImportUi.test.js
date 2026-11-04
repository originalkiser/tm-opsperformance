import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {computeMembershipGoal} from '../src/utils/budgetMath.js'
import {displayMoney} from '../src/utils/budgetDisplay.js'
import {laborBudget} from '../src/utils/laborBudget.js'
import {locationHelpHarness} from './helpers/locationHelpHarness.js'

function modal({existing=null,source=null,fail=false,drift=false}={}) {
 const row={site:'1512',existing,source_members:source,starting_members:existing?.starting_members??source,membership_goal:existing?.membership_goal??(source==null?null:source+58),membership_daily_growth:2,keep_membership:existing?.starting_members!=null,revenue_goal:'29.000000000000000029',hours:'100',hours_with_manager:'145',percentage:null}
 const workbook={month:'2028-02-01',totals:{total:'29.000000000000000029'},sites:[{site:'1512',daily:Array(29).fill({})}]}
 let values=[workbook,{fingerprint:'reviewed',state_fingerprint:'original-state',sites:[row]},{'1512':row.starting_members==null?'':String(row.starting_members)},{},false,false,''],cursor,refs=[],calls=[],saved=[]
 const useState=initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]}
 const useRef=initial=>{const i=cursor++;return refs[i]||=( {current:initial} )}
 const code=readFileSync(new URL('../src/components/MonthlyBudgetImport.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
 const mod={exports:{}},supabase={async rpc(name,args){calls.push({name,args});return args.p_confirm ? (fail?{error:{message:'Changed since preview'}}:{data:{sites:1,changed_sites:1,pending_membership:source==null?1:0}}) : {data:{fingerprint:'choices-reviewed',state_fingerprint:drift?'changed-state':'original-state',sites:[row]}}}}
 new Function('module','exports','React','useState','useRef','supabase','computeMembershipGoal','displayMoney',transformSync(code,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,useState,useRef,supabase,computeMembershipGoal,displayMoney)
 const render=()=>{cursor=0;return mod.exports.default({onClose(){},onSaved(...args){saved.push(args)}})}
 const nodes=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)]
 return {render,find:fn=>nodes(render()).find(fn),html:()=>renderToStaticMarkup(render()),calls,saved}
}
const button=(h,text)=>h.find(n=>n.type==='button'&&n.props.children===text)

test('missing baseline warns but revenue/labor can confirm; duplicate clicks are blocked',async()=>{
 const h=modal();assert.match(h.html(),/Membership baseline pending/)
 assert.equal(button(h,'Confirm Import').props.disabled,true)
 await h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}})
 const save=button(h,'Confirm Import');assert.equal(save.props.disabled,false)
 await Promise.all([save.props.onClick(),save.props.onClick()]);assert.equal(h.calls.length,2)
 assert.equal(h.calls.at(-1).args.p_sites[0].opening_members,null);assert.equal(h.calls.at(-1).args.p_expected,'choices-reviewed');assert.equal(h.saved.length,1)
})
test('approved baseline is disabled until explicit replacement and consent resets',async()=>{
 const h=modal({existing:{starting_members:100,membership_goal:158},source:999})
 assert.match(h.html(),/Historical count differs/)
 assert.equal(h.find(n=>n.props['aria-label']==='Opening members 1512').props.disabled,true)
 await h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}})
 const field=h.find(n=>n.props['aria-label']==='Opening members 1512');assert.equal(field.props.disabled,false)
 field.props.onChange({target:{value:'101'}})
 const checkboxes=[]; const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='input'&&n.props.type==='checkbox')checkboxes.push(n);React.Children.toArray(n.props?.children).forEach(walk)};walk(h.render())
 await checkboxes.at(-1).props.onChange({target:{checked:true}})
 await button(h,'Confirm Import').props.onClick();assert.equal(h.calls.at(-1).args.p_sites[0].replace_membership,true);assert.equal(h.calls.at(-1).args.p_sites[0].opening_members,'101')
})
test('failed import clears stale preview and never retries automatically',async()=>{
 const h=modal({fail:true,source:0});await h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}})
 await button(h,'Confirm Import').props.onClick();assert.equal(h.calls.length,2);assert.equal(h.saved.length,0)
 assert.match(h.html(),/No automatic retry/);assert.equal(button(h,'Confirm Import'),undefined)
})
test('import button exists only for Admin in existing targets table',()=>{
 for(const role of ['admin','store','area_manager']){
  const client={from(){return{select(){return this},in(){return this},eq(){return Promise.resolve({data:[]})}}}}
  const h=locationHelpHarness('components/BudgetTargetsTable',{supabase:client,laborBudget,TmLoader:()=>null,firstOfMonth:x=>x.slice(0,8)+'01',MonthlyBudgetImport:()=>null}, {locations:[{id:'a'}],profile:{role}})
  const found=h.find(n=>n.type==='button'&&n.props.children==='Import Monthly Budget')
  assert.equal(!!found,role==='admin');h.unmount()
 }
})

test('editing a pending target preserves NULL membership and imported decimal precision',async()=>{
 const calls=[];let index=0;const state=[]
 const useState=initial=>{const i=index++;state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>{state[i]=v}]}
 const source=readFileSync(new URL('../src/components/BudgetTargetsTable.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')+'\nexport { TargetModal };'
 const mod={exports:{}},saved=[]
 const supabase={from(){return{async upsert(row){calls.push(row);return{error:null}}}}}
 new Function('module','exports','React','useState','computeMembershipGoal','DEFAULT_MEMBERSHIP_DAILY_GROWTH','supabase','logEdit',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,useState,computeMembershipGoal,2,supabase,async()=>{})
 const tree=mod.exports.TargetModal({location:{id:'a',name:'A'},month:'2028-02-01',existing:{revenue_goal:'29.000000000000000029',labor_hours_non_salary:'100.000000000000000001',starting_members:null,membership_goal:null,membership_daily_growth:2},profile:{role:'admin'},onClose(){},onSaved(){saved.push(true)}})
 const nodes=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(nodes)]
 await nodes(tree).find(n=>n.type==='button'&&n.props.children==='Update Target').props.onClick()
 assert.equal(calls[0].membership_goal,null);assert.equal(calls[0].starting_members,null)
 assert.equal(calls[0].revenue_goal,'29.000000000000000029');assert.equal(calls[0].labor_hours_non_salary,'100.000000000000000001');assert.equal(saved.length,1)
})

test('targets month controls cross December/January without invalid month strings',()=>{
 for(const [today,buttonText,expected]of [['2028-01-15','‹','December 2027'],['2027-12-15','›','January 2028']]) {
  class Clock extends Date{constructor(...args){super(...(args.length?args:[today+'T12:00:00']))}}
  const client={from(){return{select(){return this},in(){return this},eq(){return Promise.resolve({data:[]})}}}}
  const firstOfMonth=x=>x.slice(0,8)+'01'
  const h=locationHelpHarness('components/BudgetTargetsTable',{Date:Clock,supabase:client,laborBudget,TmLoader:()=>null,firstOfMonth,MonthlyBudgetImport:()=>null},{locations:[{id:'a'}],profile:{role:'admin'}})
  h.find(n=>n.type==='button'&&n.props.children===buttonText).props.onClick()
  assert.match(renderToStaticMarkup(h.render()),new RegExp(expected));h.unmount()
 }
})

test('approval refresh binds exactly the final proposal and cannot silently accept database drift',async()=>{
 const h=modal({source:100})
 await h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}})
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_confirm,undefined)
 await button(h,'Confirm Import').props.onClick()
 assert.deepEqual(h.calls[0].args.p_sites,h.calls[1].args.p_sites)
 assert.equal(h.calls[1].args.p_expected,'choices-reviewed')
 const changed=modal({source:100,drift:true})
 await changed.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}})
 assert.equal(changed.calls.length,1);assert.equal(changed.saved.length,0)
 assert.match(changed.html(),/Database state changed since preview/)
 assert.equal(button(changed,'Confirm Import'),undefined)
})
test('editing a proposal after approval disables confirmation until reviewed again',async()=>{
 const h=modal({source:100})
 await h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}})
 assert.equal(button(h,'Confirm Import').props.disabled,false)
 h.find(n=>n.props['aria-label']==='Opening members 1512').props.onChange({target:{value:'101'}})
 assert.equal(button(h,'Confirm Import').props.disabled,true)
 assert.equal(h.calls.length,1)
})
