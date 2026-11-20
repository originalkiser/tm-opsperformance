import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { newChecklistQuestion,photoBudget,moveChecklistSection,questionPresets } from '../src/utils/checklistTemplateEditor.js'
import { validateChecklist,requiredChecklistPhotos } from '../src/utils/checklistRules.js'
const q={...newChecklistQuestion('completion','Fictional section',()=> '12345678-1234-4234-8234-123456789012'),critical:true,photo_required:true,photo_min_count:2,signature_required:true}
const photo=n=>({id:'p'+n,item_id:q.id,kind:'photo'}),signature={id:'signature',item_id:null,kind:'signature'},itemSignature={id:'item-sig',item_id:q.id,kind:'signature'}
test('N/A requires a reason for Critical and noncritical choice questions; disabled N/A is rejected',()=>{
 for(const critical of [true,false]){
  const item={...q,critical,na_allowed:true},evidence=[photo(1),photo(2),signature,itemSignature]
  assert.match(validateChecklist([item],{[q.id]:{value:'N/A'}},evidence,'Fictional')[q.id],/explanation/)
  assert.deepEqual(validateChecklist([item],{[q.id]:{value:'N/A',explanation:'Not applicable because of fictional equipment'}},evidence,'Fictional'),{})
  assert.match(validateChecklist([{...item,na_allowed:false}],{[q.id]:{value:'N/A',explanation:'Reason'}},evidence,'Fictional')[q.id],/Choose a response/)
 }
})
test('N/A preserves minimum photos, per-question signatures and final signature; failure-only triggers are unchanged',()=>{
 const item={...q,na_allowed:true},answers={[q.id]:{value:'N/A',explanation:'Fictional reason'}}
 assert.equal(requiredChecklistPhotos(item,answers[q.id]),2)
 assert.match(validateChecklist([item],answers,[photo(1),signature,itemSignature],'Fictional')[q.id],/photos missing/)
 assert.match(validateChecklist([item],answers,[photo(1),photo(2),signature],'Fictional')[q.id],/signature missing/)
 assert.ok(validateChecklist([item],answers,[photo(1),photo(2),itemSignature],'Fictional')._signature)
 const conditional={...q,id:'follow-up',condition:{item_id:q.id,value:'Not Completed'}}
 assert.deepEqual(validateChecklist([item,conditional],answers,[photo(1),photo(2),signature,itemSignature],'Fictional'),{})
 const failureOnly={...q,photo_required:false,photo_min_count:0,photo_on_failure:true}
 assert.equal(requiredChecklistPhotos(failureOnly,{value:'Not Completed'}),1)
 assert.equal(requiredChecklistPhotos(failureOnly,{value:'N/A'}),0)
})
test('Super Admin editor toggles only na_allowed and carries it through save, preview and publish',async()=>{
 const source=structuredClone(q),calls=[]
 let state={published:{key:'fictional',name:'Fictional',version:1,definition:[source]},draft:null,versions:[]}
 const h=locationHelpHarness('components/ChecklistAdmin',{
  supabase:{},newChecklistQuestion,photoBudget,moveChecklistSection,questionPresets,
  ChecklistTemplatePreview:()=>null,window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
  templateEditorAction:async(client,action,key,previous,extra)=>{
   calls.push({action,extra})
   if(action==='save')state={...state,draft:{revision:1,editing:true,definition:structuredClone(extra.p_definition)}}
   if(action==='preview')return {name:'Fictional preview',definition:state.draft.definition}
   if(action==='publish')state={...state,published:{...state.published,version:2,definition:state.draft.definition},draft:{editing:false,revision:2}}
   return structuredClone(state)
  },
 },{templates:[state.published],reload:async()=>{}})
 h.find(n=>n.type==='button'&&n.props.children==='Fictional').props.onClick();await h.flush()
 h.find(n=>n.props?.['aria-label']==='Allow N/A 1').props.onChange({target:{checked:true}})
 h.find(n=>n.props?.['aria-label']==='Revision / publication note').props.onChange({target:{value:'Fictional revision'}})
 await h.find(n=>n.type==='button'&&n.props.children==='Save unpublished draft').props.onClick();await h.flush()
 const saved=calls.find(c=>c.action==='save').extra.p_definition[0]
 assert.deepEqual(saved,{...source,na_allowed:true});assert.equal(source.na_allowed,false)
 await h.find(n=>n.type==='button'&&n.props.children==='Preview complete checklist').props.onClick();await h.flush()
 await h.find(n=>n.type==='button'&&n.props.children==='Publish new version').props.onClick();await h.flush()
 assert.equal(state.published.definition[0].na_allowed,true);assert.equal(state.published.version,2)
 h.unmount()
})
