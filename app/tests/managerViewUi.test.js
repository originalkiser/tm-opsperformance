import { legacyWeeklyPeriods } from './helpers/weeklyDeadlineFixture.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import React from 'react'
import {locationHelpHarness} from './helpers/locationHelpHarness.js'
import {checklistTemplates} from '../src/utils/checklistTemplates.js'
import {checklistPeriod,localChecklistDate,completionStatus,checklistTimestamp} from '../src/utils/checklistRules.js'
const user={id:'real-admin'},profile={id:'real-admin',role:'admin',is_active:true,name:'Real Admin'},sites=[{id:'a',name:'Fictional A',site_code:'A',timezone:'America/New_York'},{id:'b',name:'Fictional B',site_code:'B',timezone:'America/New_York'}]
test('display hook reuses Store branches without mutating actual identity or authorized sites',()=>{
 let auth={user,profile,locations:sites,managerPreview:true,previewSiteId:'b'}
 const source=readFileSync(new URL('../src/contexts/AuthContext.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
 const mod={exports:{}};new Function('module','exports','createContext','useContext','useMemo',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React.createContext,()=>auth,fn=>fn())
 const displayed=mod.exports.useDisplayAuth();assert.equal(displayed.profile.role,'store');assert.equal(displayed.profile.location_id,'b');assert.equal(displayed.user,user);assert.equal(profile.role,'admin');assert.equal(profile.location_id,undefined);assert.deepEqual(displayed.locations,[sites[1]]);assert.equal(auth.locations.length,2)
 auth={...auth,managerPreview:false};assert.equal(mod.exports.useDisplayAuth(),auth)
})
test('Admin-only toggle keeps return control and authorized site selector available',async()=>{
 const calls=[];const state={managerViewAllowed:true,managerPreview:true,previewSiteId:'b',actualLocations:sites,setManagerPreview:v=>calls.push(['mode',v]),setPreviewSite:v=>calls.push(['site',v])}
 const h=locationHelpHarness('components/ManagerViewSwitch',{useAuth:()=>state});await h.flush()
 assert.deepEqual(h.all(n=>n.type==='button').map(n=>n.props.children),['Admin View','Manager View'])
 h.find(n=>n.type==='button'&&n.props.children==='Admin View').props.onClick();h.find(n=>n.type==='select').props.onChange({target:{value:'a'}});assert.deepEqual(calls,[['mode',false],['site','a']])
 state.managerViewAllowed=false;assert.equal(h.render(),null);h.unmount()
})
test('read-only boundary keeps form children; normal Admin/Store do not get a disabled wrapper',()=>{
 const state={managerPreview:true};const child=React.createElement('input',{name:'data'});const h=locationHelpHarness('components/PreviewReadOnly',{useAuth:()=>state},{children:child});assert.equal(h.render().props.disabled,true);assert.equal(h.render().props.children,child);state.managerPreview=false;assert.equal(h.render(),child);h.unmount()
})
test('Opening template preview renders existing form without creating a database draft',async()=>{
 const calls=[],template=checklistTemplates[0];const h=locationHelpHarness('pages/ManagerChecklists',{
 useAuth:()=>({user,profile:{...profile,role:'store',location_id:'b'},locations:[sites[1]],managerPreview:true}),
 NavBar:()=>null,Link:()=>null,ChecklistAccessForm:()=>null,ChecklistQrAdmin:()=>null,ChecklistOpenWork:()=>null,ChecklistAdmin:()=>null,
 checklistPeriod,localChecklistDate,completionStatus,checklistTimestamp,
 supabase:{rpc(name,args){if(name==='checklist_weekly_periods')return {data:legacyWeeklyPeriods(args)};calls.push(name);throw Error('Preview must not create records')},from(name){return {select(){return this},in(){return this},gte(){return this},lte(){return this},eq(){return this},order(){return this},then(resolve){return Promise.resolve({data:name==='checklist_templates'?[template]:[]}).then(resolve)}}}},
 });await h.flush();const start=h.all(n=>n.type==='button').find(n=>n.props.children==='Start checklist');assert.ok(start);await start.props.onClick();await h.flush()
 const form=h.find(n=>n.props?.initial?.preview_only);assert.ok(form);assert.equal(form.props.previewReadOnly,true);assert.deepEqual(form.props.initial.template_snapshot.definition,template.definition);assert.equal(form.props.initial.location_id,'b');assert.deepEqual(calls,[]);h.unmount()
})
test('direct Admin routes are unavailable in preview and to Store/retired roles',()=>{
 const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');const body=source.slice(source.indexOf('function ManagerRoute('),source.indexOf('function VersionWatcher('));
 const make=auth=>{const mod={exports:{}};new Function('module','React','useAuth','Navigate',transformSync(body+'\nmodule.exports=ManagerRoute',{loader:'jsx',format:'cjs'}).code)(mod,React,()=>auth,()=>null);return mod.exports}

 for(const [role,managerPreview,allowed] of [['admin',false,true],['admin',true,false],['store',false,false],['area_manager',false,false]]){
  const result=make({profile:{role},managerPreview})({children:'allowed'});assert.equal(result==='allowed',allowed)
 }
})
