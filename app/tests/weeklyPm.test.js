import test from 'node:test'
import assert from 'node:assert/strict'
import { weeklyPmTemplate as pm } from '../src/utils/weeklyPmTemplate.js'
import { validateChecklist, isChecklistItemActive, checklistPeriod, completionStatus } from '../src/utils/checklistRules.js'
const items = pm.definition
const main = items.filter(i => !i.condition)
const followups = items.filter(i => i.condition)
const id = (section, number) => `weekly-pm-${section}-${number}`
const cleanAnswers = () => Object.fromEntries(main.map(i => [i.id, { value: i.options.find(v => !i.failure_values.includes(v)) }]))
const signatures = () => [...items.filter(i => i.signature_required).map(i => ({ kind: 'signature', item_id: i.id })), { kind: 'signature', item_id: null }]

test('PM source inventory: 62 main, 18 conditional, 36 critical; eight section labels include Trench/Pit', () => {
 assert.equal(main.length, 62); assert.equal(followups.length, 18); assert.equal(items.length, 80)
 assert.equal(new Set(items.map(i => i.id)).size, 80)
 assert.deepEqual([...new Set(items.map(i => i.section))], ['Carwash Controls', 'Conveyer and Track', 'Conveyer and Track / Trench/Pit', 'Prep Station', 'Tunnel Equipment', 'Air Compressor', 'Vacuums', 'Booster Pump Mesh Filter'])
 const expected = {controls:[], conveyer:[1,4,7,9,12], prep:[], tunnel:[1,2,3,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,26,27], air:[1,4,5], vacuums:[3,5], booster:[1]}
 for (const [section, nums] of Object.entries(expected)) assert.deepEqual(main.filter(i => i.id.startsWith(`weekly-pm-${section}-`) && i.critical).map(i => i.number), nums)
 assert.deepEqual(followups.filter(i => i.critical).map(i => i.id), [id('tunnel',7)+'-followup'])
 assert.equal(items.filter(i => i.critical).length,36)
 assert.equal(items.find(i => i.id === id('prep',6)).text, 'Check pump levels! If the level is low add')
 assert.equal(items.some(i => i.photo_required || i.photo_on_failure || i.na_allowed), false)
})
test('PM preserves section numbering, including Trench/Pit 14 and Tunnel 24 to 26 gap', () => {
 const expected = {controls:5,conveyer:14,prep:6,air:5,vacuums:5,booster:1}
 for (const [section,count] of Object.entries(expected)) assert.deepEqual(main.filter(i => i.id.startsWith(`weekly-pm-${section}-`)).map(i => i.number), Array.from({length:count},(_,n)=>n+1))
 assert.deepEqual(main.filter(i => i.section === 'Tunnel Equipment').map(i => i.number), [...Array.from({length:24},(_,n)=>n+1),26,27])
 assert.ok(followups.every(i => i.number === 1))
})
test('PM original response formats and safety instructions are retained', () => {
 assert.deepEqual(Object.fromEntries(['yesno','passfail','completion','text'].map(type => [type,items.filter(i => i.type===type).length])),{yesno:44,passfail:3,completion:16,text:17})
 for (const i of items) assert.deepEqual(i.options, {yesno:['Yes','No'],passfail:['Passed','Failed'],completion:['Completed','Not Completed'],text:[]}[i.type])
 assert.equal(items.find(i=>i.id===id('tunnel',1)).text,'Complete the lock out tag out for the wash!')
 assert.equal(items.find(i=>i.id===id('tunnel',8)).text,'Remove lock out tag after verifying no one is in the tunnel and turn on the wash!')
 assert.equal(items.find(i=>i.id===id('tunnel',8)).instruction,'This is the time to run a ghost wash and then an employee vehicle through the tunnel to verify the components below are operational.')
 assert.equal(items.find(i=>i.id===id('tunnel',3)).instruction,'If the water level is rising and it needs to be pumped, please reach out to your AM and notify them.')
})
test('all 18 conditional triggers require only their active follow-up; stale inactive responses do not block', () => {
 const expected = {tunnel:{2:'Yes',7:'Yes',10:'Yes',16:'No',17:'No',18:'No',19:'No',20:'No',21:'No',22:'No',23:'No',24:'No',26:'No'},air:{1:'No',4:'Yes',5:'No'},vacuums:{3:'No',5:'No'}}
 assert.deepEqual(followups.map(i=>i.condition),Object.entries(expected).flatMap(([section,nums])=>Object.entries(nums).map(([n,value])=>({item_id:id(section,n),value}))))
 const answers=cleanAnswers()
 assert.deepEqual(validateChecklist(items,answers,signatures(),'Fictional Manager'),{})
 for (const follow of followups) {
  const parent=items.find(i=>i.id===follow.condition.item_id)
  const a={...answers,[parent.id]:{value:follow.condition.value,explanation:'Fictional issue documented.'}}
  assert.ok(isChecklistItemActive(follow,a))
  assert.ok(validateChecklist(items,a,signatures(),'Fictional Manager')[follow.id])
  a[follow.id]={value:follow.type==='text'?'Issue details.':'Completed'}
  assert.deepEqual(validateChecklist(items,a,signatures(),'Fictional Manager'),{})
  if (follow.type==='text') {
   a[follow.id]={value:'   '};assert.ok(validateChecklist(items,a,signatures(),'Fictional Manager')[follow.id])
   a[follow.id]={value:'x'.repeat(4001)};assert.ok(validateChecklist(items,a,signatures(),'Fictional Manager')[follow.id])
  }
  a[parent.id]=answers[parent.id]
  assert.equal(isChecklistItemActive(follow,a),false)
  assert.deepEqual(validateChecklist(items,a,signatures(),'Fictional Manager'),{})
 }
})
test('three separately scoped signatures, name and documented failures; no score or critical failure block', () => {
 const a=cleanAnswers(), evidence=signatures()
 assert.deepEqual(items.filter(i=>i.signature_required).map(i=>i.id),[id('tunnel',27),id('booster',1)])
 for (const missing of evidence) {
  const errors=validateChecklist(items,a,evidence.filter(e=>e!==missing),'Fictional Manager')
  assert.ok(errors[missing.item_id || '_signature'])
 }
 assert.ok(validateChecklist(items,a,evidence,'')._name)
 a[id('conveyer',7)]={value:'Failed'}
 assert.match(validateChecklist(items,a,evidence,'Fictional Manager')[id('conveyer',7)],/explanation/)
 a[id('conveyer',7)].explanation='Issue documented for repair.'
 assert.deepEqual(validateChecklist(items,a,evidence,'Fictional Manager'),{})
 a[id('prep',6)]={value:'Not Completed',explanation:'Deferred pending clarification.'}
 assert.deepEqual(validateChecklist(items,a,evidence,'Fictional Manager'),{})
})
test('weekly PM is one Monday-keyed occurrence across the week without a deadline or overdue status', () => {
 for (let n=2;n<=8;n++) assert.equal(checklistPeriod(pm,`2026-11-0${n}`),'2026-11-02')
 assert.equal(checklistPeriod(pm,'2026-11-09'),'2026-11-09')
 assert.equal(completionStatus(pm,'2026-11-02',[],'2026-11-30'),'Available')
})
