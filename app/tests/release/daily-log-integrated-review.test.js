// Integrated Daily Log regressions. The original 18 review cases retain their
// failure assertions; additional cases cover ordering and concurrency safeguards.
import test from 'node:test'
import assert from 'node:assert/strict'
import {locationHelpHarness} from '../helpers/locationHelpHarness.js'
import * as membership from '../../src/utils/dailyMemberships.js'
import * as employeeHelpers from '../../src/utils/dailyLogEmployees.js'
import {netMemberStyle,netMembersCls} from '../../src/utils/netMemberColors.js'
import {shopTotals} from '../../src/utils/logMath.js'
import {employeeNameKey} from '../../src/utils/employeeIdentity.js'
import {fmtNum} from '../../src/utils/format.js'
const Picker=()=>null
const LossInput=()=>null
const row=(extra={})=>({id:'original',location_id:'a',log_date:'2025-01-15',time_slot:'08:00:00',split_index:0,employee_id:null,employee_name:null,google_reviews:0,total_washes:0,member_washes:0,basic:0,good:0,better:0,best:0,reactivations:0,memberships_sold:0,opportunities:0,net_members:0,...extra})
function open(initial=[],view='table',formula='simple') {
 const db=structuredClone(initial),writes=[],errors=[],timers=new Map();let live,keyHandler,next=1,hold
 const active=[{id:'cam',location_id:'a',name:'Cam',is_active:true}]
 const client={from(table){let action='select',body,filters=[];let query
 const matches=r=>filters.every(([k,v])=>r[k]===v)
 const execute=async()=>{
  if(action==='select')return {data:structuredClone(table==='employees'?active:db.filter(matches)),count:table==='employees'?active.length:db.length,error:null}
  const write={action,table,body:structuredClone(body),filters:structuredClone(filters)};writes.push(write)
  if(hold){const gate=hold;hold=null;gate.started();await gate.promise}
  if(action==='delete'){const removed=db.filter(matches);for(let i=db.length-1;i>=0;i--)if(matches(db[i]))db.splice(i,1);return {data:structuredClone(removed),error:null}}
  let record
  if(action==='update')record=db.find(matches)
  else {
   record=db.find(r=>r.location_id===body.location_id&&r.log_date===body.log_date&&r.time_slot===body.time_slot&&r.split_index===body.split_index)
   if(action==='insert'&&record){errors.push('23505');return {data:null,error:{code:'23505',message:'duplicate checkpoint unique key'}}}
   if(!record){record=row({id:`created-${next++}`});db.push(record)}
  }
  if(record)Object.assign(record,body)
  return {data:record?structuredClone(record):null,error:null}
 }
 query={select(){return query},eq(k,v){filters.push([k,v]);return query},is(k,v){filters.push([k,v]);return query},or(){return query},order(){return query},range(){return Promise.resolve({data:active,count:active.length,error:null})},
 update(v){action='update';body=v;return query},insert(v){action='insert';body=v;return query},upsert(v){action='upsert';body=v;return query},delete(){action='delete';return query},
 async maybeSingle(){const r=await execute();return {...r,data:Array.isArray(r.data)?r.data[0]??null:r.data}},single:execute,then(resolve,reject){return execute().then(resolve,reject)}};return query}}
 const h=locationHelpHarness(`components/${process.env.REVIEW_COMPONENT||'DailyLogTable'}`,{
 ...membership,...employeeHelpers,employeeNameKey,createEmployeeIfMissing:async()=>({created:false,matches:[]}),netMemberStyle,netMembersCls,shopTotals,fmtNum,supabase:client,
 useCallback:f=>f,useAuth:()=>({updateProfileSettings(){}}),EmployeeSelect:Picker,PlansLostInput:LossInput,TmLoader:()=>null,DowntimeModal:()=>null,
 pmixCls:()=>'',convCls:()=>'',pmixTotalsCls:()=>'',convTotalsCls:()=>'',localStorage:{getItem:()=>view,setItem(){}},
 window:{addEventListener(type,fn){if(type==='keydown')keyHandler=fn},removeEventListener(){}},clearTimeout(id){timers.delete(id)},setTimeout(fn,ms){const id=next++;timers.set(id,{fn,ms});return id},
 },{locationId:'a',selectedDate:'2025-01-15',canEdit:true,opportunitiesFormula:formula,profile:{role:'store'},onRowsChange:r=>{live=r}})
 function button(text){return h.find(n=>n.type==='button'&&n.props.children===text)}
 return Object.assign(h,{db,writes,errors,live:()=>live,client,
 async ready(){h.render();await h.flush();if(view==='card'){h.find(n=>n.type==='select').props.onChange({target:{value:'08:00:00'}});await h.flush()}},
 metric(index,value){const input=h.all(n=>n.type==='input'&&n.props.type==='number'&&n.props.min===0&&!n.props.disabled).find(n=>view==='card'||n.props['data-row']===index);input.props.onChange({target:{value}});h.render()},
 name(index,value){h.all(n=>n.type===Picker)[index].props.onChange(value);h.render()},
 async save(){const entry=[...timers].filter(([,v])=>v.ms===2500).at(-1);if(entry){timers.delete(entry[0]);await entry[1].fn();await h.flush()}},
 async loss(value){await h.find(n=>n.type===LossInput).props.onChange(value);await h.flush()},
 undo(){keyHandler({ctrlKey:true,key:'z',target:{closest:()=>false},preventDefault(){}});h.render()},
 split(){button('+').props.onClick();h.render()},remove(){button('×').props.onClick();h.render()},
 paste(text){button('⎗ Paste Data').props.onClick();h.render();return h.find(n=>n.props.onApply).props.onApply(text)},
 hold(){let release,started;const promise=new Promise(r=>release=r),ready=new Promise(r=>started=r);hold={promise,started};return{release,ready}},
 })
}
for(const view of ['table','card'])for(const formula of ['simple','detailed'])test(`existing populated blank-name checkpoint remains editable: ${view}/${formula}`,async()=>{
 const h=open([row({basic:2,total_washes:20})],view,formula);await h.ready();h.metric(0,'3');await h.save()
 assert.equal(h.db.length,1);assert.equal(h.db[0].employee_name,null);assert.equal(h.db[0].id,'original');assert.equal(h.db[0].google_reviews,3)
 assert.ok(h.writes.every(w=>!('employee_id' in (w.body||{}))&&!('employee_name' in (w.body||{}))))
})
test('existing blank-name all-zero checkpoint retains its ID and can save without unique conflict',async()=>{
 const h=open([row()]);await h.ready();h.metric(0,'3');await h.save()
 assert.equal(h.db[0].google_reviews,3,'existing zero checkpoint must PATCH, not collide on INSERT')
 assert.equal(h.errors.length,0)
})
test('rapid edits during pending first INSERT serialize and retain the latest values',async()=>{
 const h=open();await h.ready();h.metric(0,'1');const gate=h.hold(),first=h.save();await gate.ready
 h.metric(0,'4');const second=h.save();gate.release();await Promise.all([first,second]);await h.flush()
 assert.equal(h.db.length,1);assert.equal(h.db[0].google_reviews,4);assert.equal(h.writes.filter(w=>w.action==='insert').length,1)
})
test('saved split removal followed by undo restores the checkpoint',async()=>{
 const h=open([row({id:'split',split_index:1,employee_name:'Cam',basic:2})]);await h.ready();h.remove();await h.save();assert.equal(h.db.length,0)
 h.undo();await h.save();assert.equal(h.db.length,1,'undo must restore deleted split')
 assert.equal(h.db[0].employee_name,'Cam');assert.equal(h.db[0].basic,2)
})
test('undo removing a split while its INSERT is pending must not leave an orphan record',async()=>{
 const h=open();await h.ready();h.split();h.name(1,'Cam');const gate=h.hold(),save=h.save();await gate.ready
 h.undo();h.undo();gate.release();await save;await h.save();await h.flush()
 assert.equal(h.db.length,0,'cancelled split must not remain in database')
})
test('numeric clear/delete followed by undo restores a blank-name checkpoint',async()=>{
 const h=open([row({google_reviews:2})]);await h.ready();h.metric(0,'');await h.save();assert.equal(h.db.length,0)
 h.undo();await h.save();assert.equal(h.db.length,1,'undo must restore deleted checkpoint')
 assert.equal(h.db[0].employee_name,null);assert.equal(h.db[0].google_reviews,2)
})
test('new numeric checkpoint can undo a later name selection back to its originally blank name',async()=>{
 const h=open();await h.ready();h.metric(0,'2');await h.save();h.name(0,'Cam');await h.save();h.undo();await h.save()
 assert.equal(h.db[0].employee_name,null,'blank names are valid when restoring an originally blank checkpoint')
 assert.equal(h.db[0].google_reviews,2)
})
test('paste without names preserves historical names and split rows',async()=>{
 const h=open([row({employee_name:'Nickname',basic:1}),row({id:'split',split_index:1,employee_name:'Inactive',basic:2})]);await h.ready()
 h.paste('Time\tGoogle Reviews\n8:00 AM\t4');await h.save()
 assert.equal(h.db[0].google_reviews,4);assert.equal(h.db[0].employee_name,'Nickname');assert.equal(h.db[1].employee_name,'Inactive');assert.equal(h.db[1].basic,2)
})
test('invalid pasted name rejects the whole batch before any mutation',async()=>{
 const h=open([row({employee_name:'Nickname',google_reviews:1})]);await h.ready();const before=structuredClone(h.live())
 const result=h.paste('Time\tName\tGoogle Reviews\n8:00 AM\tCam\t3\n9:00 AM\tUnknown\t4')
 assert.match(result.error,/active roster/);assert.deepEqual(h.live(),before);assert.equal(h.writes.length,0)
})
test('undo paste preserves a concurrent recorded name and restores metrics only',async()=>{
 const h=open([row({employee_name:'Nickname',google_reviews:1})]);await h.ready();h.db[0].employee_name='Other session'
 h.paste('Time\tGoogle Reviews\n8:00 AM\t4');await h.save();h.undo();await h.save()
 assert.equal(h.db[0].employee_name,'Other session');assert.equal(h.db[0].google_reviews,1)
})
test('external deletion rejects a later edit rather than silently recreating history',async()=>{
 const h=open([row({employee_name:'Nickname',basic:1})]);await h.ready();h.db.splice(0);h.metric(0,'4');await h.save()
 assert.equal(h.db.length,0);assert.ok(h.find(n=>typeof n.props.children==='string'&&n.props.children.includes('Checkpoint not saved')))
})

test('entering Plans Lost Today first must not block the first 8AM checkpoint save',async()=>{
 const h=open();await h.ready();await h.loss('3');assert.equal(h.db.length,1)
 h.metric(0,'2');await h.save()
 assert.equal(h.db.length,1);assert.equal(h.db[0].plans_lost_today,3)
 assert.equal(h.db[0].google_reviews,2,'hourly save must reuse its own existing loss anchor')
 assert.equal(h.errors.length,0)
})
test('two rapid undos after a saved new split must delete the persisted checkpoint',async()=>{
 const h=open();await h.ready();h.split();h.name(1,'Cam');await h.save();assert.equal(h.db.length,1)
 h.undo();h.undo();await h.save();await h.flush()
 assert.equal(h.db.length,0,'dropped-row DELETE must actually execute, not remain an unawaited lazy request')
})
test('valid name paste and undo preserve the exact historical spelling and existing record ID',async()=>{
 const h=open([row({employee_name:'  Old Nick  ',google_reviews:1})]);await h.ready()
 h.paste('Time\tName\tGoogle Reviews\n8:00 AM\tCam\t4');await h.save();assert.equal(h.db[0].employee_name,'Cam')
 h.undo();await h.save();assert.equal(h.db[0].employee_name,'  Old Nick  ');assert.equal(h.db[0].google_reviews,1);assert.equal(h.db[0].id,'original')
})
test('blank name paste keeps an unmatched historical name and does not assign employee IDs',async()=>{
 const h=open([row({employee_name:'Inactive Nick',google_reviews:1})]);await h.ready()
 h.paste('Time\tName\tGoogle Reviews\n8:00 AM\t\t4');await h.save()
 assert.equal(h.db[0].employee_name,'Inactive Nick');assert.equal(h.db[0].google_reviews,4)
 assert.ok(h.writes.every(w=>!('employee_id' in(w.body||{}))))
})

test('concurrent numeric update between read and PATCH is reported, never overwritten',async()=>{
 const h=open([row({google_reviews:1})]);await h.ready();h.metric(0,'3');const gate=h.hold(),pending=h.save();await gate.ready
 h.db[0].google_reviews=8;gate.release();await pending
 assert.equal(h.db[0].google_reviews,8)
 assert.ok(h.find(n=>typeof n.props.children==='string'&&n.props.children.includes('Checkpoint not saved')))
})
test('concurrent checkpoint change prevents DELETE and retains activity',async()=>{
 const h=open([row({google_reviews:1})]);await h.ready();h.metric(0,'');const gate=h.hold(),pending=h.save();await gate.ready
 h.db[0].basic=5;gate.release();await pending
 assert.equal(h.db.length,1);assert.equal(h.db[0].basic,5)
 assert.ok(h.find(n=>typeof n.props.children==='string'&&n.props.children.includes('Checkpoint not saved')))
})
test('Undo while DELETE is in flight restores its original ID, historical name and employee ID',async()=>{
 const original=row({id:'historical-split',split_index:1,employee_id:'existing-id',employee_name:'Old Nick',basic:2})
 const h=open([original]);await h.ready();h.remove();const gate=h.hold(),pending=h.save();await gate.ready
 h.undo();gate.release();await pending;await h.save()
 assert.deepEqual(h.db,[original])
})
test('navigation flushes captured backdated edits without waiting for the debounce',async()=>{
 const h=open([row({google_reviews:1})]);await h.ready();h.metric(0,'4');h.unmount()
 await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(h.db[0].google_reviews,4);assert.equal(h.db[0].log_date,'2025-01-15');assert.equal(h.db[0].location_id,'a')
})
test('repeated Undo cannot leave a saved split hidden after rapid activity changes',async()=>{
 const h=open();await h.ready();h.split();h.name(1,'Cam');await h.save();h.name(1,'Cam');h.undo();h.undo();h.undo();await h.save()
 assert.equal(h.db.length,0)
})
test('Undo preserves an originally empty string distinctly from NULL',async()=>{
 const h=open([row({employee_name:'',google_reviews:1})]);await h.ready();h.name(0,'Cam');await h.save();h.undo();await h.save()
 assert.equal(h.db[0].employee_name,'')
})
test('Undo cannot overwrite another session checkpoint created after our deletion',async()=>{
 const h=open([row({google_reviews:2})]);await h.ready();h.metric(0,'');await h.save();h.db.push(row({id:'foreign',google_reviews:9}))
 h.undo();await h.save();assert.equal(h.db.length,1);assert.equal(h.db[0].id,'foreign');assert.equal(h.db[0].google_reviews,9)
 assert.ok(h.find(n=>typeof n.props.children==='string'&&n.props.children.includes('Checkpoint not saved')))
})

test('Plans Lost cannot adopt a checkpoint inserted by another session after loading',async()=>{
 const h=open();await h.ready();h.db.push(row({id:'foreign',basic:5}));await h.loss('3')
 assert.equal(h.db[0].basic,5);assert.equal(h.db[0].plans_lost_today,undefined)
 assert.ok(h.find(n=>n.type===LossInput).props.error.includes('another session'))
})
test('Plans Lost preserves another session activity while a local hourly edit is staged',async()=>{
 const h=open([row({google_reviews:1,basic:2})]);await h.ready();h.metric(0,'3');h.db[0].basic=7
 await h.loss('3');await h.save();assert.equal(h.db[0].basic,7)
})

test('lost INSERT response reconciles only its own UUID, then cancels an undone split',async()=>{
 const h=open();await h.ready();const original=h.client.from.bind(h.client);let fail=true
 h.client.from=table=>{const q=original(table),insert=q.insert.bind(q);q.insert=body=>{const request=insert(body),single=request.maybeSingle.bind(request);request.maybeSingle=async()=>{const result=await single();if(fail){fail=false;throw Error('Lost response')};return result};return request};return q}
 h.split();h.name(1,'Cam');const gate=h.hold(),pending=h.save();await gate.ready;h.undo();h.undo();gate.release();await pending;await h.save()
 assert.equal(h.db.length,0);assert.equal(h.errors.length,0)
})
test('full Undo restoration preserves historical NULL counters and manual derived fields',async()=>{
 const original=row({id:'nullable-split',split_index:1,employee_name:'Old Nick',google_reviews:null,basic:2,memberships_sold:9,opportunities:33,net_members:-2,net_members_legacy:true})
 const h=open([original]);await h.ready();h.remove();await h.save();h.undo();await h.save();assert.deepEqual(h.db,[original])
})

test('pasting another hour never deletes an untouched all-zero checkpoint',async()=>{
 const h=open([row()]);await h.ready();h.paste('Time\tGoogle Reviews\n9:00 AM\t4');await h.save()
 assert.ok(h.db.some(r=>r.id==='original'));assert.equal(h.db.find(r=>r.time_slot==='09:00:00').google_reviews,4)
})
