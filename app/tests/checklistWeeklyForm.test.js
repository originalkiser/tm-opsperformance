import test from 'node:test'
import assert from 'node:assert/strict'
import {locationHelpHarness} from './helpers/locationHelpHarness.js'
import {validateChecklist,validateEvidence,checklistTimestamp,isChecklistItemActive} from '../src/utils/checklistRules.js'
test('crossing the weekly due instant refreshes server timing without locking late drafts or replacing unsaved answers',async()=>{
 const timers=[],events=new Map();let past=false
 const row={id:'fictional',template_key:'weekly',period_date:'2026-11-23',created_by:'fictional-user',status:'draft',revision:0,answers:{},manager_name:'',updated_at:'2026-11-30T23:59:59Z',template_snapshot:{name:'Fictional weekly',timezone:'America/New_York',definition:[]}}
 const capabilities=()=>({can_edit:true,can_upload:true,server_now:past?'2026-12-01T05:00:00Z':'2026-12-01T04:59:59Z',edit_deadline_at:null,weekly_timing:{due_at:'2026-12-01T05:00:00Z',due_date:'2026-11-30',phase:past?'overdue':'in_progress'}})
 const h=locationHelpHarness('components/ChecklistForm',{supabase:{},validateChecklist,validateEvidence,checklistTimestamp,isChecklistItemActive,ChecklistSignature:()=>null,sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{history:{state:{}},location:{href:'http://fictional.invalid'},addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)},document:{addEventListener(){},removeEventListener(){}},AbortController,setTimeout:fn=>{timers.push(fn);return 1},clearTimeout(){},URL},{initial:row,initialCapabilities:capabilities(),transport:{async load(){return {row,capabilities:capabilities(),evidence:[]}}},user:{id:'fictional-user'},onClose(){},onSaved(){}})
 await h.flush()
 h.find(n=>n.props?.['aria-label']==='Manager full name').props.onChange({target:{value:'Unsaved fictional name'}});h.render()
 past=true;assert.ok(timers.length);timers.at(-1)();await h.flush()
 assert.equal(h.find(n=>n.props?.['aria-label']==='Manager full name').props.value,'Unsaved fictional name')
 assert.equal(h.find(n=>n.type==='button'&&n.props.children==='Save Draft').props.disabled,false)
 assert.equal(h.find(n=>n.props?.timing).props.timing.phase,'overdue');h.unmount()
})
