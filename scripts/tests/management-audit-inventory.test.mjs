// Source inventory checks only. No application migration, credentials or network requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const inventory = JSON.parse(readFileSync(new URL('../../docs/management-audits/pdf-question-inventory.json', import.meta.url)))
const monthly = inventory.monthly_site_assessment, quarterly = inventory.quarterly_safety_audit
const listed = audit => audit.items.filter(item => !item.source_condition)
const followups = audit => audit.items.filter(item => item.source_condition)
test('monthly PDF has 75 listed questions and three additional follow-ups', () => {
 assert.equal(listed(monthly).length,75);assert.equal(followups(monthly).length,3);assert.equal(monthly.items.length,78)
})
test('quarterly PDF has 42 listed questions and one additional follow-up', () => {
 assert.equal(listed(quarterly).length,42);assert.equal(followups(quarterly).length,1);assert.equal(quarterly.items.length,43)
})
test('monthly section counts reconcile, including the separately numbered standards comment', () => {
 const counts=Object.fromEntries([...new Set(listed(monthly).map(i=>i.section))].map(section=>[section,listed(monthly).filter(i=>i.section===section).length]))
 assert.deepEqual(counts,{'Site Administration':14,'Site Standards / Exterior':9,'Site Standards / Interior':5,'Site Standards / Vacuum Area':6,'Site Standards / Other':8,'Site Standards':1,'Tunnel and Equipment':17,'Safety':7,'Customer Journey':8})
 assert.equal(listed(monthly).find(i=>i.section==='Site Standards').number,5)
})
test('response choices and general comment fields match the PDFs', () => {
 for(const [audit,pf,yesno,comments] of [[monthly,69,1,5],[quarterly,41,0,1]]) {
  assert.equal(listed(audit).filter(i=>i.type==='passfail').length,pf)
  assert.equal(listed(audit).filter(i=>i.type==='yesno').length,yesno)
  assert.equal(listed(audit).filter(i=>i.is_general_comment).length,comments)
  for(const i of audit.items)assert.deepEqual(i.options,i.type==='passfail'?['Passed','Failed']:i.type==='yesno'?['Yes','No']:[])
 }
})
test('four ambiguous source follow-ups preserve Passed pending the owner decision', () => {
 assert.deepEqual(followups(monthly).map(i=>monthly.items.find(p=>p.id===i.source_condition.item_id).number),[2,3,6])
 assert.equal(quarterly.items.find(p=>p.id===followups(quarterly)[0].source_condition.item_id).number,3)
 for(const audit of [monthly,quarterly])for(const i of followups(audit)) {
  assert.equal(i.source_condition.value,'Passed');assert.equal(i.type,'text')
  const parent=audit.items.find(p=>p.id===i.source_condition.item_id);assert.ok(parent);assert.equal(parent.section,i.section)
 }
})
test('source-specific photo instruction and final auditor signatures are retained', () => {
 const photos=monthly.items.filter(i=>i.photo_required_by_source);assert.equal(photos.length,1)
 assert.equal(photos[0].section,'Site Standards / Other');assert.equal(photos[0].number,1);assert.match(photos[0].text,/Attach photo or screenshot for verification\./)
 assert.equal(quarterly.items.filter(i=>i.photo_required_by_source).length,0)
 assert.deepEqual(monthly.auditor_signatures,[{label:'Auditor Signature',page:16}]);assert.deepEqual(quarterly.auditor_signatures,[{label:'Auditor Signature',page:9}])
})
test('all response fields have unique IDs, wording and source page references', () => {
 for(const audit of [monthly,quarterly]) {
  assert.equal(new Set(audit.items.map(i=>i.id)).size,audit.items.length)
  for(const i of audit.items){assert.ok(i.text.trim());assert.ok(i.section);assert.ok(Number.isInteger(i.number));assert.ok(i.source_pages.length);assert.ok(i.source_pages.every(p=>p>=2&&p<audit.pages))}
 }
})
test('all shaded source instructions are captured without adding response options', () => {
 assert.equal(monthly.items.filter(i=>i.instruction).length,9);assert.equal(quarterly.items.filter(i=>i.instruction).length,11)
 assert.match(monthly.items.find(i=>i.section==='Tunnel and Equipment'&&i.number===12).instruction,/100' tunnel - 120 CPH.*120' tunnel - 150 CPH.*150' tunnel - 170 CPH/)
 assert.match(quarterly.items.find(i=>i.number===3&&!i.source_condition).instruction,/Allison\.lewis@acceleratedbrands\.com/)
})
