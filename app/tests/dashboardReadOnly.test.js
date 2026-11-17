// Exercise the actual Dashboard composition and actual PreviewReadOnly component.
// Form bodies are small fixtures so this test isolates their parent safety boundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {locationHelpHarness} from './helpers/locationHelpHarness.js'
import {entryLocationOptions,resolveEntryLocation} from '../src/utils/locationAccess.js'
const sites=['A','B'].map(id=>({id,name:`Fictional ${id}`,timezone:'America/New_York',show_budget_tracking:true,show_ownership_tools:true}))
const widgets=Object.fromEntries(['DailyLogTable','BudgetTrackingSection','OwnershipLogSection'].map(name=>[name,function FixtureForm(){return React.createElement('section',{'data-form':name},React.createElement('input',{'aria-label':name+' field'}),React.createElement('button',null,name+' save'))}]))
function dashboard(role='admin',managerPreview=false){
 const auth={profile:{id:'fictional',role:managerPreview?'store':role,location_id:managerPreview?'B':'A'},locations:managerPreview?[sites[1]]:role==='store'?[sites[0]]:sites,managerPreview,previewSiteId:managerPreview?'B':'A'}
 const storage=new Map([['tm_selected_location','A'],['tm_active_tab','budget']]);const Boundary=({children})=>locationHelpHarness('components/PreviewReadOnly',{useAuth:()=>auth},{children}).render()
 const h=locationHelpHarness('pages/Dashboard',{
 useAuth:()=>auth,PreviewReadOnly:Boundary,...widgets,
 localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 loadSavedDateRange:()=>({start:'2026-11-01',end:'2026-11-30'}),saveDateRange(){},fmtDateRange:()=>'',
 entryLocationOptions,resolveEntryLocation,shopTotals:()=>null,morningEntryStatus:()=>null,isDayComplete:()=>false,
 supabase:{from(){return{select(){return this},eq(){return this},maybeSingle:async()=>({data:null})}}},setInterval:()=>1,clearInterval(){},
 NavBar:()=>null,LocationRepair:()=>null,DateSelector:()=>null,LocationSelector:()=>null,MonthlyRollup:()=>null,DailySnapshot:()=>null,EmployeeSummary:()=>null,
 });return{h,auth,storage,Boundary}
}
function ancestors(node,target,path=[]){if(!node||typeof node!=='object')return null;if(node.type===target)return path;for(const child of React.Children.toArray(node.props?.children)){const found=ancestors(child,target,[...path,node]);if(found)return found}return null}
test('Manager View places all three real Site Entry component slots inside disabled boundaries, including arrow callbacks',async()=>{
 const {h,Boundary,storage}=dashboard('admin',true);try{
  await h.flush();const tree=h.render();for(const [name,Widget] of Object.entries(widgets)){
   assert.ok(ancestors(tree,Widget)?.some(n=>n.type===Boundary),name+' must be inside PreviewReadOnly')
   const element=h.find(n=>n.type===Widget);assert.equal(name==='DailyLogTable'?element.props.locationId:element.props.locations[0].id,'B')
  }
  const html=renderToStaticMarkup(tree);assert.equal((html.match(/<fieldset disabled=""/g)||[]).length,3)
  assert.equal((html.match(/data-form=/g)||[]).length,3)
  assert.equal(typeof h.find(n=>n.type===widgets.DailyLogTable).props.onRowsChange,'function')
  for(const Widget of [widgets.BudgetTrackingSection,widgets.OwnershipLogSection])assert.equal(typeof h.find(n=>n.type===Widget).props.onSaved,'function')
  assert.equal(storage.get('tm_selected_location'),'A','preview must not overwrite normal Admin site preference')
 }finally{h.unmount()}
})
for(const role of ['admin','store'])test(role+' keeps the same editable Site Entry forms and callbacks',async()=>{
 const {h}=dashboard(role,false);try{await h.flush();const html=renderToStaticMarkup(h.render());assert.equal((html.match(/<fieldset disabled/g)||[]).length,0);assert.equal((html.match(/data-form=/g)||[]).length,3);assert.equal(h.find(n=>n.type===widgets.DailyLogTable).props.canEdit,true)}finally{h.unmount()}
})
