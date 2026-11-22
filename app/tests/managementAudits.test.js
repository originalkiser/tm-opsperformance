import { managementAudits, managementAuditUrl, managementAuditScore, managementAuditScoreText } from '../src/utils/managementAudits.js'
import { legacyWeeklyPeriods } from './helpers/weeklyDeadlineFixture.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { checklistTemplates } from '../src/utils/checklistTemplates.js'
import { checklistPeriod, validateChecklist, isChecklistItemActive, checklistTimestamp, validateEvidence } from '../src/utils/checklistRules.js'
const sql=readFileSync(new URL('../supabase/migrations/20261112222936_management_audits.sql',import.meta.url),'utf8')
const audits=[...sql.matchAll(/values \('([^']+)','([^']+)','([^']+)',\$audit\$(.*?)\$audit\$::jsonb\)/gs)].map(m=>({key:m[1],name:m[2],cadence:m[3],definition:JSON.parse(m[4])}))
const text=n=>Array.isArray(n)?n.map(text).join(''):typeof n==='object'&&n?n.props?text(n.props.children):'':String(n??'')
const fill=t=>Object.fromEntries(t.definition.filter(i=>i.required!==false&&!i.condition).map(i=>[i.id,{value:i.type==='text'?'Fictional response':i.options[0]}]))
const evidence=t=>[{id:'signature',kind:'signature',item_id:null},...t.definition.filter(i=>i.photo_required).map(i=>({id:i.id,kind:'photo',item_id:i.id}))]
test('monthly/quarterly browser periods normalize calendar dates and reject invalid dates',()=>{
 for(const [date,month,quarter]of [['2026-11-12','2026-11-01','2026-10-01'],['2026-01-01','2026-01-01','2026-01-01'],['2026-04-30','2026-04-01','2026-04-01'],['2028-02-29','2028-02-01','2028-01-01'],['2026-12-31','2026-12-01','2026-10-01']]){
 assert.equal(checklistPeriod(audits[0],date),month);assert.equal(checklistPeriod(audits[1],date),quarter)
 }
 assert.throws(()=>checklistPeriod(audits[0],'2026-02-30'),/Invalid checklist date/)
})
test('approved optional comments do not block submission; Failed activates required source follow-ups without extra explanations',()=>{
 assert.equal(audits.length,2)
 for(const t of audits){const answers=fill(t),files=evidence(t);assert.deepEqual(validateChecklist(t.definition,answers,files,'Fictional Auditor',true),{})
 for(const follow of t.definition.filter(i=>i.condition)){
 assert.equal(isChecklistItemActive(follow,answers),false);answers[follow.condition.item_id]={value:'Failed'};assert.equal(isChecklistItemActive(follow,answers),true)
 const errors=validateChecklist(t.definition,answers,files,'Fictional Auditor',true);assert.ok(errors[follow.id]);assert.equal(errors[follow.condition.item_id],undefined)
 answers[follow.id]={value:'Fictional corrective issue'}
 }
 assert.deepEqual(validateChecklist(t.definition,answers,files,'Fictional Auditor',true),{})
 assert.ok(validateChecklist(t.definition,answers,[], 'Fictional Auditor',true)._signature)
 assert.equal(validateChecklist(t.definition,answers,files,'',true)._name,'Enter your full auditor name.')
 }
})
function page(excluded=false){
 const calls=[],records=audits.map(t=>({id:t.key,template_key:t.key,location_id:'site',period_date:checklistPeriod(t,'2026-11-12'),status:'draft',template_snapshot:{...t,timezone:'America/New_York'},manager_name:'Fictional',updated_at:'2026-11-12T12:00:00Z'}))
 const templates=[...checklistTemplates,{key:'weekly_pm',name:'Weekly Preventive Maintenance Checklist',cadence:'weekly'},...audits]
 const client={from(name){const q={name,keys:null,start:null};calls.push(q);return {select(){return this},in(k,v){q.keys=v;return this},gte(k,v){q.start=v;return this},lte(){return this},eq(){return this},order(){return this},then(resolve){return Promise.resolve({data:name==='checklist_templates'?templates:records.filter(r=>q.keys?.includes(r.template_key))}).then(resolve)}}},async rpc(name,args){if(name==='checklist_weekly_periods')return {data:legacyWeeklyPeriods(args)};assert.equal(name,'configuration_capabilities','Page must not auto-create audits');return {data:{can_edit_templates:false}}}}
 const h=locationHelpHarness('pages/ManagerChecklists',{useAuth:()=>({user:{id:'auditor'},profile:{role:'admin',is_active:true},locations:[{id:'site',site_code:'QA Fictional',timezone:'America/New_York',exclude_from_reporting:excluded}]}),supabase:client,checklistPeriod,completionStatus:()=> 'Available',localChecklistDate:()=> '2026-11-12',checklistTimestamp,NavBar:()=>null,Link:()=>null,ChecklistAccessForm:()=>null,ChecklistQrAdmin:()=>null,ChecklistOpenWork:()=>null,ChecklistAdmin:()=>null})
 return {...h,calls}
}
test('authenticated audits have their own group and query period; original three daily/two weekly cards remain separate',async()=>{
 const h=page();await h.flush()
 const groups=h.all(n=>n.props?.role==='group');assert.deepEqual(groups.map(g=>g.props['aria-label']),['Daily checklists','Weekly checklists','Management Audits'])
 assert.equal((text(groups[0]).match(/Checklist/g)||[]).length,3);assert.ok(text(groups[1]).includes('Weekly Manager Administrative Checklist'));assert.ok(text(groups[1]).includes('Weekly Preventive Maintenance Checklist'))
 assert.ok(text(groups[2]).includes('Monthly Site Assessment'));assert.ok(text(groups[2]).includes('Quarterly Safety Audit'))
 assert.ok(h.calls.some(q=>q.keys?.includes('monthly_site_assessment')&&q.start==='2026-10-01'))
 assert.ok(h.calls.some(q=>q.keys?.includes('opening')&&q.start==='2026-11-09'))
 assert.equal(h.all(n=>n.props?.['aria-label']==='Management audit submission review').length,1);h.unmount()
})
test('excluded location has no management-audit start cards',async()=>{const h=page(true);await h.flush();assert.equal(h.all(n=>n.props?.['aria-label']==='Management Audits').length,0);h.unmount()})
test('audit form preserves sections/wording, labels optional comments and uses an auditor signature/name',async()=>{
 for(const template of audits){const row={id:template.key,template_key:template.key,created_by:'auditor',status:'draft',revision:1,updated_at:'2026-11-12T12:00:00Z',answers:fill(template),manager_name:'Fictional Auditor',period_date:checklistPeriod(template,'2026-11-12'),template_snapshot:{...template,timezone:'America/New_York'}}
 const capabilities={can_edit:true,can_upload:true},transport={async load(){return {row,capabilities,evidence:evidence(template)}}}
 const h=locationHelpHarness('components/ChecklistForm',{supabase:{},validateChecklist,validateEvidence,checklistTimestamp,isChecklistItemActive,ChecklistSignature:()=>null,sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{history:{state:{}},location:{href:'https://fictional.invalid/#/checklists'},addEventListener(){},removeEventListener(){},confirm(){return true}},document:{addEventListener(){},removeEventListener(){}},AbortController,setTimeout,clearTimeout,URL},{initial:row,user:{id:'auditor'},transport,onClose(){},onSaved(){}})
 await h.flush();assert.ok(h.find(n=>n.props?.['aria-label']==='Auditor full name'));assert.ok(h.find(n=>n.props?.label==='Auditor handwritten signature'))
 assert.equal(h.all(n=>n.type==='legend'&&text(n).includes('(optional)')).length,template.definition.filter(i=>i.required===false).length)
 const first=template.definition.find(i=>i.condition);assert.equal(h.find(n=>n.props?.['aria-label']===`Written response ${first.id}`),undefined)
 h.find(n=>n.type==='input'&&n.props.name===first.condition.item_id&&n.props.value==='Failed').props.onChange();await h.flush();assert.ok(h.find(n=>n.props?.['aria-label']===`Written response ${first.id}`));h.unmount()
 }
})
test('optional comments still reject invalid types and over-limit blank input',()=>{
 const t=audits[0],comment=t.definition.find(i=>i.required===false),answers=fill(t),files=evidence(t)
 for(const value of [123,null,' '.repeat(4001)]){answers[comment.id]={value};assert.ok(validateChecklist(t.definition,answers,files,'Fictional',true)[comment.id])}
 answers[comment.id]={value:'   '};assert.deepEqual(validateChecklist(t.definition,answers,files,'Fictional',true),{})
})
test('audit template preview states only source-required evidence without claiming unprinted failure explanations',async()=>{
 const h=locationHelpHarness('components/ChecklistTemplatePreview',{}, {name:audits[0].name,definition:audits[0].definition})
 await h.flush()
 const copy=h.all(n=>n.type==='p').map(text).join('\n');assert.ok(copy.includes('All conditional follow-ups'));assert.equal(copy.includes('Failed/incomplete answers always require explanations.'),false);h.unmount()
})

test('audit N/A is optional only when enabled; Failed still requires its follow-up and signature', () => {
 const choice = { id: 'q', type: 'passfail', options: ['Passed', 'Failed'], na_allowed: true, failure_values: ['Failed'], critical: true, photo_required: true }
 const followup = { id: 'follow', type: 'text', failure_values: [], condition: { item_id: 'q', value: 'Failed' } }
 const na = { q: { value: 'N/A' } }
 const files = [{ id: 'signature', kind: 'signature', item_id: null }, { id: 'photo', kind: 'photo', item_id: 'q' }]
 assert.deepEqual(validateChecklist([choice, followup], na, files, 'Auditor', true), {})
 assert.match(validateChecklist([choice], na, files, 'Auditor')[choice.id], /explanation/)
 assert.match(validateChecklist([{ ...choice, na_allowed: false }], na, files, 'Auditor', true)[choice.id], /Choose/)
 assert.match(validateChecklist([choice, followup], na, [], 'Auditor', true)[choice.id], /photo/)
 const failed = validateChecklist([choice, followup], { q: { value: 'Failed' } }, [], 'Auditor', true)
 assert.match(failed.q, /explanation/)
 assert.ok(failed.follow && failed._signature)
})

test('audit scores use immutable saved choices and ignore unanswered, inactive, and written responses', () => {
 const item = id => ({ id, type: 'passfail', options: ['Passed', 'Failed'], na_allowed: true })
 const row = {
  status: 'submitted', template_key: 'monthly_site_assessment',
  template_snapshot: { definition: ['pass', 'fail', 'na', 'blank'].map(item).concat(
   { ...item('inactive'), condition: { item_id: 'pass', value: 'Failed' } },
   { id: 'comment', type: 'text', options: [] }) },
  answers: { pass: { value: 'Passed' }, fail: { value: 'Failed' }, na: { value: 'N/A' },
   inactive: { value: 'Passed' }, comment: { value: 'Passed' }, removed: { value: 'Passed' } },
 }
 assert.deepEqual(managementAuditScore(row), { passed: 1, failed: 1, na: 1, percentage: '50.0' })
 assert.deepEqual(managementAuditScore({ ...row, answers: { na: row.answers.na } }), { passed: 0, failed: 0, na: 1, percentage: null })
 assert.equal(managementAuditScore({ ...row, template_key: 'weekly' }), null)
 assert.equal(managementAuditScore({ ...row, working_copy_id: 'correction' }), null)
 assert.equal(managementAuditScore({ ...row, status: 'draft' }), null)
 assert.match(managementAuditScoreText({ ...row, answers: {} }), /Audit score: N\/A/)
})

test('QR destinations are signed-in audit routes with no store grant, location or guest token', () => {
 for (const audit of managementAudits) {
  const url = managementAuditUrl('https://app.invalid/repo/?old=value#/guest-checklists?token=fictional', audit)
  assert.equal(url, 'https://app.invalid/repo/#' + audit.path)
 }
})

test('the audit QR workflow waits for an authorized location and opens only its own audit', async () => {
 for (const audit of managementAudits) {
  const template = audits.find(t => t.key === audit.key)
  const sites = [{ id: 'allowed', site_code: '100', timezone: 'UTC' }, { id: 'excluded', site_code: '200', exclude_from_reporting: true }]
  const calls = [], Form = () => null
  const supabase = {
   from(table) {
    assert.ok(['checklist_templates', 'checklist_submissions'].includes(table))
    const query = { select() { return this }, eq(key, value) { calls.push([table, key, value]); return this },
     async maybeSingle() { return { data: template } },
     then(resolve) { return Promise.resolve({ data: [] }).then(resolve) } }
    return query
   },
   async rpc(name, args) {
    calls.push([name, args])
    return { data: { id: 'draft', template_key: audit.key, location_id: 'allowed' } }
   },
  }
  const binding = role => ({ useAuth: () => ({ user: role ? { id: 'auditor' } : null, profile: { role, is_active: true }, locations: sites }),
   supabase, checklistPeriod, completionStatus: () => 'Available', localChecklistDate: timezone => timezone ? '2026-11-12' : '',
   Link: () => null, NavBar: () => null, ChecklistAccessForm: Form })
  const h = locationHelpHarness('pages/ManagerChecklists', binding('store'), { audit })
  await h.flush()
  const select = () => h.find(n => n.props['aria-label'] === 'Checklist location')
  const start = () => h.find(n => n.type === 'button' && n.props.children === 'Start audit')
  assert.equal(select().props.value, '')
  assert.equal(h.find(n => n.type === 'option' && n.props.value === 'excluded'), undefined)
  assert.deepEqual(calls, [])
  select().props.onChange({ target: { value: 'excluded' } }); await h.flush()
  assert.equal(start(), undefined)
  assert.deepEqual(calls, [])
  select().props.onChange({ target: { value: 'allowed' } }); await h.flush()
  assert.ok(calls.some(([table, key, value]) => table === 'checklist_submissions' && key === 'template_key' && value === audit.key))
  assert.ok(calls.some(([table, key, value]) => table === 'checklist_submissions' && key === 'location_id' && value === 'allowed'))
  assert.ok(!calls.some(([name]) => name === 'save_checklist'))
  await start().props.onClick(); await h.flush()
  assert.deepEqual(calls.at(-1), ['save_checklist', { p_template: audit.key, p_location: 'allowed', p_date: checklistPeriod(template, '2026-11-12') }])
  assert.equal(h.find(n => n.type === Form).props.initial.template_key, audit.key)
  h.unmount()

  calls.length = 0
  const guest = locationHelpHarness('pages/ManagerChecklists', binding(null), { audit })
  await guest.flush()
  assert.ok(guest.find(n => n.props.role === 'alert'))
  assert.deepEqual(calls, [])
  guest.unmount()
 }
})
