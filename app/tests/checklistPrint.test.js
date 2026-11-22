import { managementAuditScoreText } from '../src/utils/managementAudits.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadOfficialChecklist, officialChecklistFingerprint, checklistPrintPeriod, printTimestamp, printableChecklistKeys } from '../src/utils/checklistPrint.js'
import { isChecklistItemActive, validateChecklist } from '../src/utils/checklistRules.js'
import { weeklyPmTemplate } from '../src/utils/weeklyPmTemplate.js'
const item={id:'q',section:'Inspection',text:'Original saved question',options:['Passed','Failed'],failure_values:['Failed'],type:'passfail',photo_required:true}
const row={id:'s',template_key:'weekly_pm',status:'submitted',period_date:'2026-11-09',submitted_at:'2026-11-17T03:00:00Z',updated_at:'2026-11-17T03:00:00Z',manager_name:'Recorded Auditor',revision:7,answers:{q:{value:'Failed',explanation:'Saved comment'}},template_snapshot:{name:'Original Checklist',cadence:'weekly',timezone:'America/Chicago',version:2,definition:[item]}}
const photo={id:'p',item_id:'q',kind:'photo',object_path:'PRIVATE_PATH'},signature={id:'sig',item_id:null,kind:'signature'}
const record={row,evidence:[photo,signature]}
const module={exports:{}}
const source=readFileSync(new URL('../src/components/ChecklistPrintDocument.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
new Function('module','exports','React','managementAuditScoreText','isChecklistItemActive','validateChecklist','checklistPrintPeriod','printTimestamp',transformSync(source,{loader:'jsx',format:'cjs'}).code)(module,module.exports,React,managementAuditScoreText,isChecklistItemActive,validateChecklist,checklistPrintPeriod,printTimestamp)
const render=record=>renderToStaticMarkup(React.createElement(module.exports.default,{record,images:new Map([['p','blob:photo'],['sig','blob:signature']]),locationLabel:'1001',locationName:'Fictional Site'}))

test('all seven checklists print from the authorized submitted snapshot, never the editable form',async()=>{
 for(const key of printableChecklistKeys){
  const saved={...record,row:{...row,template_key:key}}
  const result=await loadOfficialChecklist({load:async()=>saved},'s')
  assert.deepEqual(result,saved)
  const html = render(result)
  assert.match(html,/Original saved question/)
  if (key === 'monthly_site_assessment' || key === 'quarterly_safety_audit') assert.match(html, /Audit score: 0\.0% · Passed: 0 · Failed: 1 · N\/A: 0/)
  else assert.doesNotMatch(html, /Audit score:/)
 }
})
test('a saved or unsaved correction prints only its archived official base and evidence',async()=>{
 const correction={row:{...row,revision:2,base_revision:7,working_copy_id:'w',answers:{q:{value:'Passed',explanation:'UNSUBMITTED'}},manager_name:'UNSUBMITTED'},evidence:[{id:'wrong'}]}
 const transport={load:async()=>correction,history:async()=>({versions:[{revision:6,answers:{},template_snapshot:{definition:[]},evidence:[]},{revision:7,answers:row.answers,manager_name:row.manager_name,template_snapshot:row.template_snapshot,recorded_at:row.updated_at,evidence:record.evidence}]})}
 const official=await loadOfficialChecklist(transport,'s')
 assert.equal(official.row.revision,7);assert.equal(official.row.working_copy_id,null)
 assert.deepEqual(official.evidence,record.evidence)
 const html=render(official);assert.match(html,/Saved comment/);assert.doesNotMatch(html,/UNSUBMITTED/)
 transport.history=async()=>({versions:[]})
 await assert.rejects(loadOfficialChecklist(transport,'s'),/official submitted revision/)
})
test('drafts, preview records, mismatched IDs, denied access and QR audits fail closed',async()=>{
 for(const change of [{status:'draft'},{preview_only:true},{id:'other'},{template_key:'unknown'}])await assert.rejects(loadOfficialChecklist({load:async()=>({...record,row:{...row,...change}})},'s'))
 for(const key of ['monthly_site_assessment','quarterly_safety_audit'])await assert.rejects(loadOfficialChecklist({guest:true,load:async()=>({...record,row:{...row,template_key:key}})},'s'),/authenticated/)
 await assert.rejects(loadOfficialChecklist({load:async()=>{throw Error('revoked')}},'s'),/revoked/)
})
test('print content includes metadata, saved answers, failures, comments, evidence, optional blanks and conditional follow-ups',()=>{
 const more=[item,{...item,id:'optional',text:'Optional note',type:'text',required:false,photo_required:false},{...item,id:'follow',text:'Follow-up question',photo_required:false,condition:{item_id:'q',value:'Failed'}},{...item,id:'inactive',text:'Other follow-up',photo_required:false,condition:{item_id:'q',value:'Passed'}}]
 const html=render({...record,row:{...row,template_snapshot:{...row.template_snapshot,definition:more}}})
 for(const text of ['1001','Fictional Site','Original Checklist','2026-11-09','2026-11-15','Recorded Auditor','Saved comment','FAILED INSPECTION ITEM','INCOMPLETE','Not provided (optional)','follow-up not triggered','blob:photo','blob:signature','CST'])assert.ok(html.includes(text),text)
 assert.doesNotMatch(html,/PRIVATE_PATH|<input|<textarea|<button|<nav|storage\/v1|https:/)
 assert.equal((html.match(/<img /g)||[]).length,2)
})
test('reporting periods use calendar dates, including month/quarter ends and DST weeks',()=>{
 for(const [cadence,start,end] of [['weekly','2026-11-02','2026-11-08'],['monthly','2026-02-01','2026-02-28'],['quarterly','2026-10-01','2026-12-31']])assert.equal(checklistPrintPeriod({...row,period_date:start,template_snapshot:{cadence}}),`${start} – ${end}`)
 assert.equal(checklistPrintPeriod({...row,template_snapshot:{cadence:'daily'}}),'2026-11-09')
})
test('fingerprints detect official revisions, template snapshots, answers and evidence changes',()=>{
 const original=officialChecklistFingerprint(record)
 for(const change of [{revision:8},{manager_name:'Other'},{answers:{}},{template_snapshot:{...row.template_snapshot,version:3}}])assert.notEqual(officialChecklistFingerprint({...record,row:{...row,...change}}),original)
 assert.notEqual(officialChecklistFingerprint({...record,evidence:[]}),original)
})
test('multi-page Weekly PM includes every original saved question and print-safe photo styles',()=>{
 const html=render({...record,row:{...row,template_snapshot:{...weeklyPmTemplate,timezone:'America/Chicago'},answers:{}}})
 assert.equal((html.match(/class="item"/g)||[]).length,weeklyPmTemplate.definition.length)
 assert.match(html,/break-inside: avoid/);assert.match(html,/max-height: 175mm/);assert.match(html,/@page/)
})
