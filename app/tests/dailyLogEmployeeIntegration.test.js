import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as membership from '../src/utils/dailyMemberships.js'
import * as employeeHelpers from '../src/utils/dailyLogEmployees.js'
import { netMemberStyle,netMembersCls } from '../src/utils/netMemberColors.js'
import { shopTotals } from '../src/utils/logMath.js'
import { fmtNum } from '../src/utils/format.js'
const Picker=()=>null
function log(view='table',formula='simple') {
 let live,timer,id=0,keydown
 const db=[{id:'historic',location_id:'a',log_date:'2025-01-15',time_slot:'08:00:00',split_index:0,employee_id:'stable-identity',employee_name:'  Nickname  ',total_washes:20,member_washes:10,basic:2,reactivations:1}],writes=[]
 const active=[{id:'cam',location_id:'a',name:'Cam',is_active:true}]
 const client={from(table){let action,body,filters=[];const q={
  select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},or(){return q},order(){return q},range(){return Promise.resolve({data:active,count:1})},
  update(p){action='update';body=p;return q},insert(p){action='insert';body=p;return q},delete(){action='delete';return q},
  maybeSingle(){if(!action)return Promise.resolve({data:structuredClone(db.find(r=>filters.every(([k,v])=>r[k]===v)))??null,error:null});writes.push({action,body});let row
   if(action==='update')row=db.find(r=>filters.every(([k,v])=>r[k]===v))
   else {row={id:`new${++id}`};db.push(row)}
   if(row)Object.assign(row,body)
   return Promise.resolve({data:row?structuredClone(row):null,error:null})},
  then(resolve){return Promise.resolve({data:table==='daily_logs'?structuredClone(db):active,count:table==='employees'?active.length:undefined,error:null}).then(resolve)},
 };return q}}
 const h=locationHelpHarness('components/DailyLogTable',{
  ...membership,...employeeHelpers,netMemberStyle,netMembersCls,shopTotals,fmtNum,supabase:client,
  useCallback:f=>f,useAuth:()=>({updateProfileSettings(){}}),EmployeeSelect:Picker,PlansLostInput:()=>null,TmLoader:()=>null,DowntimeModal:()=>null,
  pmixCls:()=>'',convCls:()=>'',pmixTotalsCls:()=>'',convTotalsCls:()=>'',localStorage:{getItem:()=>view,setItem(){}},
  window:{addEventListener(type,fn){if(type==='keydown')keydown=fn},removeEventListener(){}},clearTimeout(){},setTimeout(fn,ms){if(ms===2500)timer=fn},
 },{locationId:'a',selectedDate:'2025-01-15',canEdit:true,opportunitiesFormula:formula,profile:{role:'store'},onRowsChange:r=>{live=r}})
 return Object.assign(h,{db,writes,undo(){keydown({ctrlKey:true,key:'z',target:{closest:()=>false},preventDefault(){}})},live:()=>live,async save(){await timer();await h.flush()},picker:()=>h.find(n=>n.type===Picker)})
}
for(const view of ['table','card'])for(const formula of ['simple','detailed'])test(`${view}/${formula}: backdated edits preserve historical name/ID and formulas; explicit replacement saves name only`,async()=>{
 const h=log(view,formula);h.render();await h.flush()
 if(view==='card'){h.find(n=>n.type==='select').props.onChange({target:{value:'08:00:00'}});await h.flush()}
 assert.equal(h.picker().props.value,'  Nickname  ')
 const number=h.find(n=>n.type==='input'&&n.props.type==='number'&&n.props.min===0&&!n.props.disabled)
 number.props.onChange({target:{value:'3'}});await h.save()
 assert.equal(h.db[0].employee_name,'  Nickname  ');assert.equal(h.db[0].employee_id,'stable-identity')
 assert.ok(!('employee_name' in h.writes[0].body));assert.ok(!('employee_id' in h.writes[0].body))
 assert.equal(h.db[0].memberships_sold,2)
 assert.equal(h.db[0].opportunities,formula==='simple'?10:12)
 h.picker().props.onChange('Cam');await h.save()
 assert.equal(h.db[0].employee_name,'Cam');assert.equal(h.db[0].employee_id,'stable-identity')
 assert.equal(h.writes.at(-1).body.employee_name,'Cam')
})
test('split-hour selection inserts at original location/date without employee ID; repeated saves PATCH',async()=>{
 const h=log();h.render();await h.flush()
 h.find(n=>n.type==='button'&&n.props.children==='+').props.onClick();await h.flush()
 const pickers=h.all(n=>n.type===Picker);assert.equal(pickers.length,14)
 pickers[1].props.onChange('Cam');await h.save();await h.save()
 const split=h.db.find(r=>r.split_index===1)
 assert.equal(split.employee_name,'Cam');assert.equal(split.location_id,'a');assert.equal(split.log_date,'2025-01-15')
 assert.ok(!('employee_id' in split));assert.equal(h.writes.filter(w=>w.action==='insert').length,1)
})

test('card hour selector addresses existing split checkpoints without changing their identity',async()=>{
 const h=log();h.render();await h.flush()
 h.find(n=>n.type==='button'&&n.props.children==='+').props.onClick();await h.flush()
 h.all(n=>n.type===Picker)[1].props.onChange('Cam');await h.save()
 h.find(n=>n.type==='button'&&String(n.props.children).includes('Switch to Card')).props.onClick();await h.flush()
 const hour=h.find(n=>n.type==='select')
 assert.ok(h.find(n=>n.type==='option'&&n.props.value==='08:00:00:1'))
 hour.props.onChange({target:{value:'08:00:00:1'}});await h.flush()
 assert.equal(h.picker().props.value,'Cam')
 assert.equal(h.live().find(r=>r.split_index===1).id,h.db.find(r=>r.split_index===1).id)
})

test('undoing unrelated metrics cannot restore an earlier name after a concurrent rename',async()=>{
 const h=log();h.render();await h.flush()
 h.db[0].employee_name='Concurrent recorded name'
 h.find(n=>n.type==='input'&&n.props.type==='number'&&n.props.min===0&&!n.props.disabled).props.onChange({target:{value:'3'}})
 await h.save();assert.equal(h.picker().props.value,'Concurrent recorded name')
 h.undo();await h.save()
 assert.equal(h.db[0].employee_name,'Concurrent recorded name')
 assert.ok(!('employee_name' in h.writes.at(-1).body))
})
