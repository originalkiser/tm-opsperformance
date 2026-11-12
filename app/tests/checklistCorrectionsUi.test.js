import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { checklistTemplates } from '../src/utils/checklistTemplates.js'
import { validateChecklist, validateEvidence, checklistTimestamp, isChecklistItemActive } from '../src/utils/checklistRules.js'
const template=checklistTemplates.find(t=>t.key==='midday')
const base={id:'submission',created_by:'account',location_id:'site',template_key:'midday',period_date:'2026-11-09',status:'submitted',revision:7,answers:{'midday-1':{value:'No',explanation:'Original'}},manager_name:'Original Manager',submitted_at:'2026-11-12T12:00:00Z',updated_at:'2026-11-12T12:00:00Z',template_snapshot:{...template,timezone:'America/New_York'}}
const caps={can_edit:false,can_begin_edit:true,can_upload:false,can_discard:false,edit_deadline_at:'2026-11-13T05:00:00Z',server_now:'2026-11-12T12:00:00Z'}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):''
const button=(h,label)=>h.find(n=>n.type==='button'&&text(n)===label)
function form({row=base,capabilities=caps,confirm=true}={}) {
 let state={row:structuredClone(row),capabilities:{...capabilities},evidence:[]},deny=false,paused,saveResolve,readPaused=false,readResolve
 const calls=[],saved=[],timers=[],events=new Map(),cache=new Map()
 const transport={guest:true,recoveryKey:'guest-tab',
  async load(){calls.push('read');const captured=structuredClone(state);if(readPaused)await new Promise(resolve=>{readResolve=resolve});if(deny){const e=new Error('Revoked');e.status=403;throw e}return captured},
  async beginCorrection(){calls.push('begin');state={row:{...state.row,working_copy_id:'work',base_revision:7,revision:1},capabilities:{...caps,can_edit:true,can_begin_edit:false,can_upload:true},evidence:[]};return structuredClone(state)},
  async save(row,values){calls.push(['save',row,values]);if(paused)await new Promise(resolve=>{saveResolve=resolve});state={...state,row:{...row,answers:values.answers,manager_name:values.name,revision:row.revision+1}};return structuredClone(state)},
  async upload(){calls.push('upload');return structuredClone(state)},
  async download(row,file){calls.push(['download',file.id]);return new Blob(['fictional'],{type:'image/png'})},
  async history(){return {versions:[{revision:9,recorded_at:'2026-11-12T14:00:00Z',answers:{},manager_name:'Correction',evidence:[]},{revision:7,recorded_at:'2026-11-12T12:00:00Z',answers:base.answers,manager_name:'Original',evidence:[{id:'original-photo',kind:'photo',item_id:'midday-1'}]}]}}
 }
 const h=locationHelpHarness('components/ChecklistForm',{
  supabase:{from(){throw Error('Guest must not read tables')},functions:{invoke(){throw Error('Guest must not discard')}}},validateChecklist,validateEvidence,checklistTimestamp,isChecklistItemActive,ChecklistSignature:()=>null,
  sessionStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},
  window:{confirm:()=>confirm,history:{state:{idx:1}},location:{href:'https://example.invalid/#/guest-checklists'},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)},
  document:{addEventListener(){},removeEventListener(){}},URL:{createObjectURL:()=> 'blob:fictional',revokeObjectURL(){}},AbortController,
  setTimeout:callback=>{timers.push(callback);return timers.length},clearTimeout(){},
 },{initial:row,transport,initialCapabilities:capabilities,locationLabel:'Fictional',onSaved:s=>saved.push(s),onClose(){calls.push('close')}})
 return {...h,calls,saved,timers,events,cache,deny:()=>{deny=true},state:v=>{state=v},pause:()=>{paused=true},finishSave:()=>saveResolve?.(),pauseRead:()=>{readPaused=true},finishRead:()=>{readPaused=false;readResolve?.()}}
}
test('guest can begin correction on account record without fake user; preserves submitted status and disables discard',async()=>{
 const h=form();await h.flush();assert.ok(button(h,'Make same-day correction'));assert.equal(button(h,'Save Draft'),undefined)
 await button(h,'Make same-day correction').props.onClick();await h.flush()
 assert.ok(button(h,'Save Draft'));assert.equal(button(h,'Discard Draft'),undefined)
 assert.ok(h.find(n=>n.props?.role==='status'&&text(n).includes('last submitted version remains official')))
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'Corrected explanation'}});await h.flush()
 assert.ok([...h.cache.keys()].some(key=>key.endsWith('_work')))
 await button(h,'Save Draft').props.onClick();await h.flush()
 const save=h.calls.find(c=>Array.isArray(c)&&c[0]==='save');assert.equal(save[1].status,'submitted');assert.equal(save[1].working_copy_id,'work');assert.equal(save[1].revision,1)
 assert.equal(save[2].submit,false);h.unmount()
})
test('server deadline locks form on midnight refresh; no week-long edit extension',async()=>{
 const h=form();await h.flush();await button(h,'Make same-day correction').props.onClick();await h.flush()
 h.state({row:base,capabilities:{...caps,can_begin_edit:false},evidence:[]})
 h.timers.at(-1)();await h.flush()
 assert.equal(button(h,'Save Draft'),undefined);assert.equal(button(h,'Make same-day correction'),undefined)
 assert.ok(h.all(n=>n.type==='fieldset').every(n=>n.props.disabled));h.unmount()
})
test('refresh of dirty answers requires confirmation and revocation on focus locks all controls',async()=>{
 const row={...base,status:'draft',submitted_at:null},capabilities={...caps,can_edit:true,can_begin_edit:false,can_upload:true,edit_deadline_at:null}
 const h=form({row,capabilities,confirm:false});await h.flush()
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'Unsaved local edit'}});h.render()
 const count=h.calls.length;button(h,'Refresh saved checklist').props.onClick();await h.flush();assert.equal(h.calls.length,count)
 assert.equal(h.find(n=>n.type==='textarea').props.value,'Unsaved local edit')
 h.deny();await h.events.get('focus')();await h.flush();assert.equal(button(h,'Save Draft'),undefined)
 assert.ok(h.find(n=>n.props?.role==='alert'&&text(n).includes('Revoked')));h.unmount()
})
test('history uses true revision and timestamp and can open original evidence after correction',async()=>{
 const h=form();await h.flush();await button(h,'View submission history').props.onClick();await h.flush()
 const summaries=h.all(n=>n.type==='summary').map(text);assert.ok(summaries[0].startsWith('Version 9'));assert.ok(summaries[1].startsWith('Version 7'))
 assert.ok(summaries[1].includes('2026'))
 await h.find(n=>n.props?.files?.some(f=>f.id==='original-photo')).props.onOpen({id:'original-photo',kind:'photo'})
 assert.ok(h.calls.some(c=>Array.isArray(c)&&c[0]==='download'&&c[1]==='original-photo'));h.unmount()
})
test('leaving while a save completes does not update another store form or start its pending upload',async()=>{
 const row={...base,status:'draft'},capabilities={...caps,can_edit:true,can_begin_edit:false,can_upload:true,edit_deadline_at:null}
 const h=form({row,capabilities});await h.flush();h.pause()
 const saving=button(h,'Save Draft').props.onClick();await h.flush();h.unmount();h.finishSave();await saving
 assert.equal(h.saved.length,0)
})

test('a delayed focus read cannot overwrite typing or a newer save; dirty changes do not restart deadline',async()=>{
 const h=form();await h.flush();await button(h,'Make same-day correction').props.onClick();await h.flush()
 const timers=h.timers.length
 h.pauseRead();const reading=h.events.get('focus')();await h.flush()
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'New local answer'}});await h.flush()
 assert.equal(h.timers.length,timers)
 await button(h,'Save Draft').props.onClick();await h.flush()
 h.finishRead();await reading;await h.flush()
 assert.equal(h.find(n=>n.type==='textarea').props.value,'New local answer')
 await button(h,'Save Draft').props.onClick();await h.flush()
 const saves=h.calls.filter(c=>Array.isArray(c)&&c[0]==='save');assert.equal(saves.at(-1)[1].revision,2)
 h.unmount()
})
test('dirty correction at midnight is replaced by official submission while preserving recovery',async()=>{
 const h=form();await h.flush();await button(h,'Make same-day correction').props.onClick();await h.flush()
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'Not submitted'}});await h.flush()
 assert.ok([...h.cache.values()].some(value=>value.includes('Not submitted')))
 h.state({row:base,capabilities:{...caps,can_begin_edit:false},evidence:[]})
 h.timers.at(-1)();await h.flush()
 assert.equal(h.find(n=>n.type==='textarea').props.value,'Original')
 assert.ok(h.find(n=>n.props?.role==='status'&&text(n).includes('unfinished corrections were not submitted')))
 assert.ok([...h.cache.values()].some(value=>value.includes('Not submitted')))
 h.unmount()
})
