import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { checklistTimestamp } from '../src/utils/checklistRules.js'
const locations = [{ id:'a',site_code:'1001',name:'Fictional North' },{ id:'b',site_code:'1002',name:'Fictional South' }]
const record = (id,location_id,status) => ({ id,location_id,status,period_date:'2026-11-16',manager_name:status==='submitted'?'Fictional Manager':'',updated_at:'2026-11-17T12:00:00Z',template_snapshot:{name:'Weekly PM',timezone:'America/New_York'} })
const records = [record('b1','b','draft'),record('a1','a','submitted'),record('b2','b','submitted'),record('a2','a','discarding')]
const text = node => Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):String(node??'')
const buttons = h => h.all(n=>n.type==='button')
function fixture(props={}) { const opened=[]; const h=locationHelpHarness('components/ChecklistSubmissionReview',{checklistTimestamp},{label:'Operational checklist submissions',records,locations,busy:false,onOpen:r=>opened.push(r),...props});return {...h,opened} }
test('one collapsed row per encountered location; totals count only submitted status',()=>{
 const h=fixture();const summaries=buttons(h).filter(n=>'aria-expanded'in n.props)
 assert.equal(summaries.length,2);assert.ok(summaries.every(n=>n.props['aria-expanded']===false))
 assert.match(text(summaries[0]),/1002 · Fictional South.*2 records · 1 submitted/)
 assert.match(text(summaries[1]),/1001 · Fictional North.*2 records · 1 submitted/)
 assert.equal(h.all(n=>n.type==='li').length,0);h.unmount()
})
test('expand preserves source order and original records, timestamps, pilot metadata and action',()=>{
 const pilot={...records[2],is_pilot:true};const h=fixture({records:[records[0],records[1],pilot]})
 buttons(h).find(n=>text(n).includes('1002')).props.onClick();h.render()
 const items=h.all(n=>n.type==='li');assert.deepEqual(items.map(n=>n.key.replace(/^\.\$/, '')),['b1','b2'])
 assert.match(text(items[0]),/Unnamed draft/);assert.match(text(items[1]),/Historical pilot/)
 assert.ok(text(items[1]).includes(checklistTimestamp(pilot.updated_at,pilot.template_snapshot.timezone)))
 buttons(h).find(n=>text(n).startsWith('Review submitted')).props.onClick();assert.equal(h.opened[0],pilot)
 buttons(h).find(n=>text(n).includes('1002')&&'aria-expanded'in n.props).props.onClick();assert.equal(h.all(n=>n.type==='li').length,0);h.unmount()
})
test('expand/collapse all and busy state preserve records without writes',()=>{
 const h=fixture({busy:true});buttons(h).find(n=>text(n)==='Expand All').props.onClick();h.render()
 assert.equal(h.all(n=>n.type==='li').length,4);assert.ok(buttons(h).filter(n=>text(n).startsWith('Review ')).every(n=>n.props.disabled))
 buttons(h).find(n=>text(n)==='Collapse All').props.onClick();assert.equal(h.all(n=>n.type==='li').length,0);h.unmount()
})
test('empty result has no invented locations; unknown metadata retains accessible records',()=>{
 const empty=fixture({records:[]});assert.equal(buttons(empty).length,2);assert.ok(buttons(empty).every(n=>n.props.disabled));empty.unmount()
 const h=fixture({records:[record('x','unknown','submitted')]});assert.match(text(buttons(h).at(-1)),/Unknown site.*1 record · 1 submitted/);h.unmount()
})

test('page keeps operational/audit records separate and review UI Admin-only',async()=>{
 const {checklistPeriod,completionStatus}=await import('../src/utils/checklistRules.js')
 const {legacyWeeklyPeriods}=await import('./helpers/weeklyDeadlineFixture.js')
 for(const role of ['admin','store']){
  const saved=[{...record('op','a','submitted'),template_key:'opening',period_date:'2026-11-16'},{...record('audit','a','submitted'),template_key:'monthly_site_assessment',period_date:'2026-11-01'}]
  const calls=[];const client={async rpc(name,args){calls.push(name);return {data:name==='checklist_weekly_periods'?legacyWeeklyPeriods(args):{can_edit_templates:false}}},from(table){let keys=[];return {select(){return this},in(_key,value){keys=value;return this},gte(){return this},lte(){return this},eq(){return this},order(){return this},then(resolve){return Promise.resolve({data:table==='checklist_templates'?[]:saved.filter(row=>keys.includes(row.template_key))}).then(resolve)}}}}
  const h=locationHelpHarness('pages/ManagerChecklists',{useAuth:()=>({user:{id:'fictional'},profile:{role,is_active:true},locations:[{...locations[0],timezone:'America/New_York'}]}),supabase:client,checklistPeriod,completionStatus,localChecklistDate:()=> '2026-11-16',NavBar:()=>null,Link:()=>null,ChecklistOpenWork:()=>null,ChecklistAccessForm:()=>null})
  await h.flush();const sections=h.all(n=>['Operational checklist submissions','Management audit submissions'].includes(n.props?.label))
  assert.equal(sections.length,role==='admin'?2:0)
  if(role==='admin'){assert.deepEqual(sections[0].props.records.map(r=>r.id),['op']);assert.deepEqual(sections[1].props.records.map(r=>r.id),['audit']);await sections[0].props.onOpen(saved[0]);await h.flush();assert.equal(h.find(n=>n.props?.initial===saved[0])?.props.initial,saved[0])}
  assert.ok(calls.every(name=>['configuration_capabilities','checklist_weekly_periods'].includes(name)));h.unmount()
 }
})
