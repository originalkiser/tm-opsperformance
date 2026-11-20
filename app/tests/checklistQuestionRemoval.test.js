import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { questionRemovalReason, newChecklistQuestion,photoBudget,moveChecklistSection,questionPresets } from '../src/utils/checklistTemplateEditor.js'
const question = id => ({...newChecklistQuestion('completion','Fictional section',()=>id),id,text:`Fictional ${id}`})
const first=question('one'),second=question('two')
const button=(h,label)=>h.find(n=>n.props?.['aria-label']===label||n.type==='button'&&n.props.children===label)
function fixture({definition=[first,second],key='midday',confirm=true}={}){
 const original=structuredClone(definition),calls=[],confirmations=[];let allowed=confirm,state={published:{key,name:'Fictional checklist',version:1,definition:original},draft:null,versions:[]}
 const h=locationHelpHarness('components/ChecklistAdmin',{
  supabase:{},newChecklistQuestion,photoBudget,moveChecklistSection,questionPresets,questionRemovalReason,ChecklistTemplatePreview:()=>null,
  window:{confirm:message=>{confirmations.push(message);return allowed},addEventListener(){},removeEventListener(){}},
  templateEditorAction:async(_client,action,_key,previous,extra)=>{
   calls.push({action,previous,extra})
   if(action==='save')state={...state,draft:{revision:(state.draft?.revision||0)+1,editing:true,definition:structuredClone(extra.p_definition)}}
   if(action==='preview')return {name:'Fictional preview',definition:state.draft.definition}
   if(action==='publish')state={...state,published:{...state.published,version:2,definition:state.draft.definition},draft:{editing:false,revision:2}}
   return structuredClone(state)
  },
 },{templates:[state.published],reload:async()=>{}})
 return {...h,calls,confirmations,original,allow:value=>{allowed=value},state:()=>state}
}
test('cancel keeps question and unsaved wording; confirmed removal is local until explicit save/preview/publish',async()=>{
 const h=fixture({confirm:false});button(h,'Fictional checklist').props.onClick();await h.flush()
 h.find(n=>n.props?.['aria-label']==='Question 2').props.onChange({target:{value:'Keep unsaved wording'}})
 button(h,'Remove question 1').props.onClick();assert.ok(button(h,'Remove question 2'));assert.deepEqual(h.calls.map(c=>c.action),['read'])
 assert.match(h.confirmations[0],/unpublished template draft/);h.allow(true);button(h,'Remove question 1').props.onClick()
 assert.equal(button(h,'Remove question 2'),undefined);assert.equal(h.find(n=>n.props?.['aria-label']==='Question 1').props.value,'Keep unsaved wording')
 assert.deepEqual(h.original,[first,second]);assert.equal(h.state().published.definition.length,2)
 assert.equal(button(h,'Preview complete checklist').props.disabled,true);assert.equal(button(h,'Publish new version').props.disabled,true)
 h.find(n=>n.props?.['aria-label']==='Revision / publication note').props.onChange({target:{value:'Fictional removal'}})
 await button(h,'Save unpublished draft').props.onClick();await h.flush()
 assert.deepEqual(h.calls.find(c=>c.action==='save').extra.p_definition.map(i=>i.id),['two'])
 assert.equal(h.state().published.definition.length,2)
 await button(h,'Preview complete checklist').props.onClick();await h.flush()
 await button(h,'Publish new version').props.onClick();await h.flush()
 assert.deepEqual(h.state().published.definition.map(i=>i.id),['two']);assert.equal(h.state().published.version,2);h.unmount()
})
test('protected removal buttons are disabled with explanations, including both ends of conditional chains',async()=>{
 const def=[first,{...second,signature_required:true},{...question('follow'),condition:{item_id:'one',value:'Not Completed'}},question('weekly-9')]
 const h=fixture({definition:def,key:'weekly'});button(h,'Fictional checklist').props.onClick();await h.flush()
 for(let n=1;n<=4;n++){const b=button(h,`Remove question ${n}`);assert.equal(b.props.disabled,true);assert.ok(h.find(node=>node.props?.id===b.props['aria-describedby']))}
 button(h,'Remove question 2').props.onClick();assert.equal(h.confirmations.length,0);assert.ok(h.find(n=>n.props?.role==='alert'));h.unmount()
})
test('last question cannot be removed and missing metadata does not mutate questions',()=>{
 assert.match(questionRemovalReason('midday',first,[first]),/at least one/)
 assert.equal(questionRemovalReason('midday',first,[first,second]),'')
 const sig={...first,signature_required:true};assert.match(questionRemovalReason('midday',first,[first,second],[sig,second]),/signature/)
})
