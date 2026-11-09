import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { checklistTemplates } from '../src/utils/checklistTemplates.js'
import { validateChecklist, validateEvidence, checklistTimestamp, checklistPeriod } from '../src/utils/checklistRules.js'
import { downloadChecklistEvidence, checklistUploadRejection } from '../src/utils/checklistEvidence.js'
import { resourceAccess } from '../src/utils/resourceLibrary.js'
const template=checklistTemplates.find(t=>t.key==='midday')
const actor='00000000-0000-0000-0000-000000000002'
function form({submitted=false,other=false,fail=false,slow=false,cached=null,cancelNavigation=false,templateData=template,uploadFail=false,attachFail=false,evidenceFiles=[],denied=false,slowEvidence=false,discardFail=false,slowDiscard=false,pending=false,admin=false,slowUpload=false,uploadError=null,saveError=null,attachError=null,liveStatus='draft',statusReadFail=false}={}) {
 const row={id:'draft',created_by:other?'another':actor,location_id:'site',template_key:templateData.key,period_date:'2026-11-02',status:submitted?'submitted':pending?'discarding':'draft',revision:1,answers:{},manager_name:'',submitted_at:'2026-11-02T12:00:00Z',updated_at:'2026-11-02T12:00:00Z',template_snapshot:{...templateData,timezone:'America/Los_Angeles'}}
 const storage=new Map(cached?[['tm_checklist_draft_'+actor+'_draft',JSON.stringify(cached)]]:[]),calls=[],events=new Map(),saved=[]
 const moves=[],revoked=[],urls=[]
 let evidenceAllowed=!denied,resolveEvidence
 const browser={confirm:()=>!cancelNavigation,history:{state:{idx:2},go:delta=>moves.push(delta),replaceState(){}},location:{href:'https://example.invalid/#/checklists'},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)}
 let unblock,finishDiscard,finishUpload
 const client={
  functions:{async invoke(name,args){calls.push({name,args});if(slowDiscard)await new Promise(resolve=>{finishDiscard=resolve});return discardFail?{error:{message:'Cleanup unavailable'}}:{data:{discarded:true,id:'draft'}}}},
  from(name){return {select(){return this},eq(){return this},setHeader(){return this},abortSignal(){return this},single(){return Promise.resolve(evidenceAllowed?{data:{object_path:evidenceFiles[0]?.object_path}}:{error:{message:'Access revoked'}})},order(){return Promise.resolve({data:evidenceFiles})},maybeSingle(){if(name==='checklist_submissions'){calls.push({name:'read_draft_status'});return Promise.resolve(statusReadFail?{error:{message:'Read unavailable'}}:{data:liveStatus===null?null:{status:liveStatus}})}return Promise.resolve({data:{name:'Test Store'}})}}},
  auth:{async getSession(){return {data:{session:{user:{id:actor}}}}}},
  async rpc(name,args){calls.push({name,args});if(name==='attach_checklist_evidence')return attachError?{error:attachError}:attachFail?{error:{message:'Attachment registration interrupted'}}:{data:{id:args.p_file,item_id:args.p_item,kind:args.p_kind,object_path:args.p_path}};if(slow)await new Promise(resolve=>{unblock=resolve});return saveError?{error:saveError}:fail?{error:{message:'Draft changed elsewhere'}}:{data:{...row,revision:2,answers:args.p_answers,manager_name:args.p_name,status:args.p_submit?'submitted':'draft'}}},
  storage:{from(){return {async upload(path,file,options){calls.push({name:'upload',path,file,options});if(slowUpload)await new Promise(resolve=>{finishUpload=resolve});return uploadError?{error:uploadError}:uploadFail?{error:{message:'Upload interrupted'}}:{data:{path}}},async download(path,options,parameters){calls.push({name:'download',path,options,parameters});if(slowEvidence)await new Promise(resolve=>{resolveEvidence=resolve});return evidenceAllowed?{data:new Blob(['fictional-image'],{type:'image/png'})}:{error:{message:'Access revoked'}}}}}},
 }
 const h=locationHelpHarness('components/ChecklistForm',{
  supabase:client,validateChecklist,validateEvidence,checklistTimestamp,downloadChecklistEvidence,checklistUploadRejection,URL:{createObjectURL:()=>{const url=`blob:local-${urls.length}`;urls.push(url);return url},revokeObjectURL:url=>revoked.push(url)},AbortController,crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000100'},ChecklistSignature:()=>null,
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  window:browser,
  document:{addEventListener(){},removeEventListener(){}},
 },{initial:row,user:{id:actor},admin,locationLabel:'1000-Fictional',onClose(){calls.push({name:'closed'})},onSaved:s=>saved.push(s)})
 return {...h,calls,saved,storage,events,browser,moves,revoked,urls,revoke:()=>{evidenceAllowed=false},finishEvidence:()=>resolveEvidence?.(),finishDiscard:()=>finishDiscard?.(),finishUpload:()=>finishUpload?.(),unblock:()=>unblock?.()}
}
const button=(h,label)=>h.find(n=>n.type==='button'&&n.props.children===label)
test('Admin and assigned managers see explicit checklist order regardless of returned template order',async()=>{
 for(const role of ['admin','store']){
  const templates=['closing','weekly','midday','opening'].map(key=>checklistTemplates.find(t=>t.key===key))
  const before=JSON.stringify(templates)
  const client={from(name){return {select(){return this},gte(){return this},lte(){return this},order(){return this},then(resolve){return Promise.resolve({data:name==='checklist_templates'?templates:name==='checklist_pilot_access'?[{location_id:'site',is_active:true,enabled_from:'2026-01-01'}]:[]}).then(resolve)}}}}
  const h=locationHelpHarness('pages/ManagerChecklists',{
   useAuth:()=>({user:{id:actor},profile:{role,is_active:true,deleted_at:null},locations:[{id:'site',site_code:'1512',timezone:'America/New_York'}]}),supabase:client,
   checklistPeriod,completionStatus:()=> 'Not submitted',localChecklistDate:()=> '2026-11-05',checklistTimestamp,
   NavBar:()=>null,ChecklistForm:()=>null,ChecklistAdmin:()=>null,
  })
  await h.flush()
  assert.deepEqual(h.all(n=>n.type==='h2').slice(0,4).map(n=>n.props.children),['Opening Checklist','Mid-Day Checklist','Closing Checklist','Weekly Manager Administrative Checklist'])
  assert.equal(JSON.stringify(templates),before)
  h.unmount()
 }
})
test('blank required items highlighted and final RPC blocked; draft may save incomplete progress',async()=>{
 const h=form();await h.flush()
 button(h,'Submit').props.onClick()
 assert.equal(h.calls.length,0)
 assert.ok(h.all(n=>n.props?.role==='alert').length>0)
 h.find(n=>n.type==='input'&&n.props.value==='No').props.onChange()
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'Debris cleared'}})
 await button(h,'Save Draft').props.onClick();await h.flush()
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_submit,false)
 assert.equal(h.calls[0].args.p_answers['midday-1'].explanation,'Debris cleared');assert.equal(h.saved.length,1)
 assert.equal(h.storage.size,0);h.unmount()
})
test('double save guarded and stale save failure never retried or marked saved',async()=>{
 const h=form({slow:true,fail:true});await h.flush()
 const save=button(h,'Save Draft').props.onClick
 const first=save();await save();assert.equal(h.calls.length,1)
 h.unblock();await first;await h.flush()
 assert.equal(h.saved.length,0);assert.equal(h.calls.length,1)
 assert.ok(h.find(n=>n.props?.role==='alert'&&String(n.props.children).includes('Nothing was retried')));h.unmount()
})
test('submitted and another owner drafts read-only, evidence controls stay separate; no save or submit actions',async()=>{
 for(const args of [{submitted:true},{other:true}]){
  const h=form(args);await h.flush()
  assert.equal(button(h,'Save Draft'),undefined);assert.equal(button(h,'Submit'),undefined)
  assert.ok(h.all(n=>n.type==='fieldset').every(n=>n.props.disabled));h.unmount()
 }
})
test('unsaved answers recover explicitly and are not overwritten on mount; unload warns',async()=>{
 const cached={revision:0,answers:{'midday-1':{value:'No',explanation:'Recovered issue'}},name:'Test Manager'}
 const h=form({cached});await h.flush()
 assert.deepEqual(JSON.parse([...h.storage.values()][0]),cached)
 button(h,'Restore unsaved answers').props.onClick();h.render()
 assert.equal(h.find(n=>n.type==='textarea').props.value,'Recovered issue')
 let prevented=false;h.events.get('beforeunload')({preventDefault(){prevented=true}});assert.equal(prevented,true)
 assert.equal(h.calls.length,0);h.unmount()
})
test('a new unsaved signature blocks final submission until captured signature is saved',async()=>{
 const h=form();await h.flush()
 const signature=h.find(n=>n.props?.onDirty)
 signature.props.onDirty(true);h.render()
 assert.equal(button(h,'Submit').props.disabled,true);h.unmount()
})
test('single native photo picker appears only for required photo evidence',async()=>{
 const source=readFileSync(new URL('../src/components/ChecklistForm.jsx',import.meta.url),'utf8')
 assert.doesNotMatch(source,/capture="environment"/);assert.match(source,/upsert: false/)
 const h=form();await h.flush();assert.equal(h.all(n=>n.type==='input'&&n.props.type==='file').length,0);h.unmount()
})
test('navigation follows the active assigned-account access decision',()=>{
 for(const allowed of [false,true]){
  const h=locationHelpHarness('components/NavBar',{
   useAuth:()=>({profile:{role:'store'},signOut(){}}),useNavigate:()=>()=>{},useLocation:()=>({pathname:'/'}),
   useDarkModeCtx:()=>[false,()=>{}],useChecklistAccess:()=>allowed,resourceAccess,Link:()=>null,tmLogo:'',SettingsModal:()=>null,TargetsBell:()=>null,HelpPanel:()=>null,
  })
  assert.equal(!!h.find(n=>n.props?.to==='/checklists'),allowed);h.unmount()
 }
})
test('signature canvas captures actual pointer strokes; blank signature cannot save',async()=>{
 const calls=[],dirty=[]
 const h=locationHelpHarness('components/ChecklistSignature',{}, {disabled:false,onDirty:x=>dirty.push(x),onSave:async b=>{calls.push(b);return true}})
 const canvas=h.find(n=>n.type==='canvas')
 const context={beginPath(){},moveTo(){},lineTo(){},stroke(){},clearRect(){}}
 canvas.ref.current={getBoundingClientRect:()=>({left:0,top:0,width:900,height:260}),setPointerCapture(){},getContext:()=>context,toBlob:cb=>cb(new Blob(['fictional-signature'],{type:'image/png'}))}
 assert.equal(button(h,'Save signature').props.disabled,true)
 canvas.props.onPointerDown({pointerId:1,clientX:10,clientY:20});canvas.props.onPointerMove({clientX:40,clientY:50});canvas.props.onPointerUp()
 assert.equal(button(h,'Save signature').props.disabled,false)
 button(h,'Save signature').props.onClick();await h.flush()
 assert.equal(calls.length,1);assert.deepEqual(dirty,[true,false]);assert.equal(button(h,'Save signature').props.disabled,true);h.unmount()
})

test('navigation access uses active authenticated roles and existing assignments without pilot reads',()=>{
 const source=readFileSync(new URL('../src/hooks/useChecklistAccess.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export function','function')
 function allowed(profile,locations=[{id:'site'}],user={id:actor}) {
  return new Function('useAuth',source+'\nreturn useChecklistAccess()')(()=>({profile,locations,user}))
 }
 const active={role:'store',is_active:true,deleted_at:null}
 for(const role of ['admin','store','area_manager']) assert.equal(allowed({...active,role}),true)
 assert.equal(allowed(active,[]),false)
 assert.equal(allowed({...active,role:'admin'},[]),true)
 for(const profile of [{...active,is_active:false},{...active,deleted_at:'2026-01-01'},{...active,role:'unknown'},null]) assert.equal(allowed(profile),false)
 assert.equal(allowed(active,undefined,null),false)
})

test('canceling browser Back preserves the draft and restores the prior history position',async()=>{
 const h=form({cancelNavigation:true});await h.flush()
 h.find(n=>n.type==='input'&&n.props.value==='No').props.onChange();h.render()
 h.browser.history.state={idx:1};let stopped=false
 h.events.get('popstate')({stopImmediatePropagation(){stopped=true}})
 assert.equal(stopped,true);assert.deepEqual(h.moves,[1]);assert.equal(h.calls.length,0)
 h.browser.history.state={idx:2};h.events.get('popstate')({stopImmediatePropagation(){throw Error('restoration must not be blocked')}})
 assert.equal(h.find(n=>n.type==='input'&&n.props.value==='No').props.checked,true);h.unmount()
})

test('six photo requirements expose one native picker each; invalid files never reach RPC/storage',async()=>{
 for(const templateData of checklistTemplates){
  const h=form({templateData});await h.flush()
  const inputs=h.all(n=>n.type==='input'&&n.props.type==='file')
  const required=templateData.definition.filter(i=>i.photo_required).length
  assert.equal(inputs.length,required);assert.ok(inputs.every(n=>!n.props.capture))
  if(inputs.length){inputs[0].props.onChange({target:{files:[new Blob(['invalid'],{type:'image/svg+xml'})],value:'selected'}});await h.flush();assert.equal(h.calls.length,0)}
  h.unmount()
 }
})
test('photo uploads save draft first, never upsert, and register evidence only after upload succeeds',async()=>{
 for(const config of [{},{uploadFail:true},{attachFail:true}]){
  const h=form({...config,templateData:checklistTemplates[0]});await h.flush()
  h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new Blob(['fictional-image'],{type:'image/png'})],value:'selected'}})
  await h.flush()
  assert.deepEqual(h.calls.map(x=>x.name),config.uploadFail?['save_checklist','upload']:['save_checklist','upload','attach_checklist_evidence'])
  assert.equal(h.calls[0].args.p_submit,false);assert.equal(h.calls[1].options.upsert,false);assert.equal(h.calls[1].options.cacheControl,'0')
  assert.equal(h.saved.length,1)
  const view=h.find(n=>Array.isArray(n.props?.files)&&n.props.files.some(file=>file.kind==='photo'))
  assert.equal(!!view,!config.uploadFail&&!config.attachFail)
  if(config.uploadFail||config.attachFail)assert.ok(h.find(n=>n.props?.role==='alert'))
  h.unmount()
 }
})

test('photo/signature previews use only in-memory blobs, freshly authorize every view and release memory',async()=>{
 for(const kind of ['photo','signature']){
  const file={id:'file',kind,item_id:kind==='photo'?'midday-1':null,object_path:'draft/file.png'}
  const h=form({evidenceFiles:[file]});await h.flush()
  const links=h.find(n=>n.props?.files?.some(f=>f.id===file.id))
  await links.props.onOpen(file);h.render()
  assert.equal(h.find(n=>n.type==='img').props.src,'blob:local-0')
  assert.equal(h.find(n=>n.type==='a'),undefined)
  button(h,'Close evidence').props.onClick();h.render();assert.deepEqual(h.revoked,['blob:local-0'])
  await links.props.onOpen(file);h.render();assert.equal(h.find(n=>n.type==='img').props.src,'blob:local-1')
  h.revoke();await links.props.onOpen(file);h.render()
  assert.equal(h.find(n=>n.type==='img'),undefined)
  assert.deepEqual(h.revoked,['blob:local-0','blob:local-1'])
  assert.equal(h.calls.filter(c=>c.name==='download').length,3);h.unmount()
 }
})
test('leaving during an evidence request aborts it and never creates an orphaned preview URL',async()=>{
 const file={id:'file',kind:'signature',item_id:null,object_path:'draft/file.png'}
 const h=form({evidenceFiles:[file],slowEvidence:true});await h.flush()
 const reading=h.find(n=>n.props?.files?.some(f=>f.id===file.id)).props.onOpen(file)
 await h.flush()
 h.unmount();assert.equal(h.calls.find(c=>c.name==='download').parameters.signal.aborted,true)
 h.finishEvidence();await reading;assert.equal(h.urls.length,0)
})


test('weekly section photo sits outside questions; one picker per requirement preserves attachment keys',async()=>{
 const weekly=checklistTemplates.find(t=>t.key==='weekly')
 const h=form({templateData:weekly});await h.flush()
 const inputs=h.all(n=>n.type==='input'&&n.props.type==='file')
 assert.equal(inputs.length,2)
 assert.deepEqual(inputs.map(n=>n.props['aria-label']),['Upload photo weekly-9','Upload photo weekly-13'])
 const containsPicker=node=>Array.isArray(node)?node.some(containsPicker):!!node&&typeof node==='object'&&(node.props?.['aria-label']==='Upload photo weekly-9'||containsPicker(node.props?.children))
 assert.ok(h.find(n=>n.props?.['aria-label']==='Communications Board section photo'))
 assert.ok(h.all(n=>n.type==='fieldset').every(n=>!containsPicker(n)))
 assert.ok(inputs.every(n=>!n.props.capture&&n.props.accept==='image/jpeg,image/png,image/webp'))
 const picker=inputs[0],target={files:[new Blob(['photo'],{type:'image/png'})],value:'selected'}
 picker.props.onChange({target});await h.flush()
 assert.equal(target.value,'')
 assert.equal(h.calls.find(c=>c.name==='attach_checklist_evidence').args.p_item,'weekly-9')
 assert.equal(h.calls.find(c=>c.name==='attach_checklist_evidence').args.p_kind,'photo')
 assert.equal(h.calls.filter(c=>c.name==='upload').length,1)
 assert.ok(button(h,'Save Draft'));assert.ok(button(h,'Submit'));assert.ok(button(h,'Close'))
 h.unmount()
 const review=form({templateData:weekly,submitted:true});await review.flush()
 assert.equal(review.all(n=>n.type==='input'&&n.props.type==='file').length,0)
 review.unmount()
})


test('answers use local recovery only; server saves are explicit and discard requires confirmation',async()=>{
 const h=form({cancelNavigation:true});await h.flush()
 h.find(n=>n.type==='input'&&n.props.value==='No').props.onChange();await h.flush()
 assert.equal(h.calls.length,0);assert.equal(h.storage.size,1)
 await button(h,'Discard Draft').props.onClick();await h.flush()
 assert.equal(h.calls.length,0);assert.ok(button(h,'Save Draft'));h.unmount()
})
test('confirmed discard clears local recovery, closes only on success, and blocks stale save/upload callbacks',async()=>{
 const h=form({slowDiscard:true,templateData:checklistTemplates[0]});await h.flush()
 h.find(n=>n.type==='input'&&n.props.value==='Not Completed').props.onChange();await h.flush()
 const save=button(h,'Save Draft').props.onClick,discard=button(h,'Discard Draft').props.onClick
 const upload=h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange
 const first=discard();await discard();await save();upload({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}})
 assert.deepEqual(h.calls.map(c=>c.name),['discard-checklist-draft'])
 h.finishDiscard();await first;await h.flush();await save()
 assert.equal(h.storage.size,0);assert.equal(h.calls.filter(c=>c.name==='closed').length,1)
 assert.equal(h.calls.filter(c=>c.name==='save_checklist').length,0);h.unmount()
})
test('discard unavailable for submitted/other-owner managers; Admin can discard reviewed drafts and resume interrupted cleanup',async()=>{
 for(const config of [{submitted:true},{other:true},{submitted:true,admin:true}]){
  const h=form(config);await h.flush();assert.equal(button(h,'Discard Draft'),undefined);h.unmount()
 }
 const admin=form({other:true,admin:true});await admin.flush()
 assert.ok(button(admin,'Discard Draft'));assert.equal(button(admin,'Save Draft'),undefined);admin.unmount()
 const h=form({pending:true,discardFail:true});await h.flush()
 assert.equal(button(h,'Save Draft'),undefined);assert.equal(button(h,'Submit'),undefined)
 await button(h,'Discard Draft').props.onClick();await h.flush()
 assert.ok(h.find(n=>n.props?.role==='alert'));assert.equal(h.calls.filter(c=>c.name==='closed').length,0)
 assert.equal(h.calls.filter(c=>c.name==='discard-checklist-draft').length,1);h.unmount()
})
test('pending save prevents discard; no overlapping cleanup while an upload/save is active',async()=>{
 const h=form({slow:true});await h.flush()
 const discard=button(h,'Discard Draft').props.onClick,save=button(h,'Save Draft').props.onClick
 const saving=save();await discard();assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'save_checklist')
 h.unblock();await saving;h.unmount()
})


test('an in-flight evidence upload prevents discard until upload and registration finish',async()=>{
 const h=form({slowUpload:true,templateData:checklistTemplates[0]});await h.flush()
 const discard=button(h,'Discard Draft').props.onClick
 h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}})
 await h.flush();await discard()
 assert.deepEqual(h.calls.map(c=>c.name),['save_checklist','upload'])
 h.finishUpload();await h.flush()
 assert.deepEqual(h.calls.map(c=>c.name),['save_checklist','upload','attach_checklist_evidence']);h.unmount()
})

test('known stale Storage rejection gets a clear message, no attachment and no automatic retry',async()=>{
 const h=form({templateData:checklistTemplates[0],uploadError:{status:500,statusCode:'500',message:'database error, code: P0001'},liveStatus:null});await h.flush()
 const upload=h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange
 upload({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}});await h.flush()
 assert.deepEqual(h.calls.map(c=>c.name),['save_checklist','upload','read_draft_status'])
 assert.ok(h.find(n=>n.props?.role==='alert'&&n.props.children==='This draft is no longer available. Uploads are no longer allowed.'))
 assert.equal(button(h,'Save Draft'),undefined);assert.equal(button(h,'Submit'),undefined);assert.equal(button(h,'Discard Draft'),undefined)
 upload({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}});await h.flush()
 assert.equal(h.calls.filter(c=>c.name==='upload').length,1);assert.equal(h.calls.filter(c=>c.name==='attach_checklist_evidence').length,0);h.unmount()
})
test('interrupted cleanup blocks uploads with clear guidance while preserving explicit discard resumption',async()=>{
 const h=form({templateData:checklistTemplates[0],uploadError:{status:500,message:'database error, code: P0001'},liveStatus:'discarding'});await h.flush()
 const upload=h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange
 upload({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}});await h.flush()
 upload({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}});await h.flush()
 assert.equal(h.calls.filter(c=>c.name==='upload').length,1)
 assert.ok(h.find(n=>n.props?.role==='alert'&&String(n.props.children).includes('being discarded')))
 assert.equal(button(h,'Save Draft'),undefined);assert.equal(button(h,'Submit'),undefined);assert.ok(button(h,'Discard Draft'))
 assert.equal(h.calls.filter(c=>c.name==='attach_checklist_evidence').length,0)
 assert.equal(h.calls.filter(c=>c.name==='discard-checklist-draft').length,0)
 await button(h,'Discard Draft').props.onClick();await h.flush()
 assert.equal(h.calls.filter(c=>c.name==='discard-checklist-draft').length,1);assert.equal(h.calls.filter(c=>c.name==='closed').length,1);h.unmount()
})
test('stale photo/signature saves and attachment registration failures are handled without recreating records',async()=>{
 for(const kind of ['photo','signature']){
  const h=form({templateData:checklistTemplates[0],saveError:{code:'P0002',message:'query returned no rows'},liveStatus:null});await h.flush()
  const blob=new Blob(['synthetic'],{type:'image/png'})
  if(kind==='photo')h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[blob],value:''}})
  else await h.find(n=>typeof n.props?.onDirty==='function').props.onSave(blob)
  await h.flush();assert.deepEqual(h.calls.map(c=>c.name),['save_checklist','read_draft_status'])
  assert.ok(h.find(n=>n.props?.role==='alert'&&String(n.props.children).includes('Uploads are no longer allowed.')));h.unmount()
 }
 const h=form({templateData:checklistTemplates[0],attachError:{code:'P0002',message:'query returned no rows'},liveStatus:null});await h.flush()
 h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}});await h.flush()
 assert.equal(h.calls.filter(c=>c.name==='attach_checklist_evidence').length,1)
 assert.equal(h.all(n=>Array.isArray(n.props?.files)&&n.props.files.length>0).length,0);h.unmount()
})
test('unknown Storage errors, still-editable drafts and failed state reads keep the original error',async()=>{
 for(const config of [
  {uploadError:{status:500,message:'Unexpected backend failure'},liveStatus:null},
  {uploadError:{status:500,message:'database error, code: P0001'},liveStatus:'draft'},
  {uploadError:{status:500,message:'database error, code: P0001'},statusReadFail:true},
 ]){
  const h=form({...config,templateData:checklistTemplates[0]});await h.flush()
  h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new Blob(['photo'],{type:'image/png'})],value:''}});await h.flush()
  assert.ok(h.find(n=>n.props?.role==='alert'&&String(n.props.children).startsWith(config.uploadError.message)))
  assert.ok(button(h,'Save Draft'));assert.equal(h.calls.filter(c=>c.name==='upload').length,1)
  assert.equal(h.calls.filter(c=>c.name==='attach_checklist_evidence').length,0);h.unmount()
 }
})

test('companywide page shows availability without auto-created drafts or derived overdue rows; Admin reviews historical records',async()=>{
 for(const role of ['admin','store','area_manager']) {
  const calls=[],records=[{id:'historic',location_id:'site',template_key:'midday',period_date:'2026-11-02',status:'submitted',is_pilot:true,manager_name:'Fictional Manager',submitted_at:'2026-11-02T12:00:00Z',template_snapshot:{name:'Mid-Day Checklist',timezone:'America/New_York'}}]
  const h=locationHelpHarness('pages/ManagerChecklists',{
   useAuth:()=>({user:{id:actor},profile:{role,is_active:true},locations:[{id:'site',site_code:'Fictional Site',timezone:'America/New_York'}]}),
   supabase:{from(name){calls.push(name);return {select(){return this},gte(){return this},lte(){return this},order(){return this},then(resolve){return Promise.resolve({data:name==='checklist_templates'?checklistTemplates:records}).then(resolve)}}},rpc(){throw new Error('Availability must not create drafts')}},
   checklistPeriod,completionStatus:(t,d,rows)=>rows.some(r=>r.template_key===t.key)?'Submitted':'Available',localChecklistDate:()=> '2026-11-02',checklistTimestamp,
   NavBar:()=>null,ChecklistForm:()=>null,ChecklistAdmin:()=>null,
  })
  await h.flush()
  assert.equal(h.all(n=>n.type==='section').length,4)
  assert.equal(calls.includes('checklist_pilot_access'),false)
  assert.equal(h.all(n=>n.type==='li').length,role==='admin'?1:0)
  assert.ok(h.find(n=>n.type==='button'&&n.props.children==='View submission'))
  assert.equal(h.all(n=>n.type==='button'&&String(n.props.children).includes('pilot access')).length,0)
  if(role==='admin') {
   const review=h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Review ')
   await review.props.onClick();h.render()
   assert.equal(h.find(n=>n.props?.initial?.id==='historic').props.initial.is_pilot,true)
  }
  h.unmount()
 }
})
test('direct checklist page denies inactive, deleted, unknown and unauthenticated accounts without querying',async()=>{
 for(const profile of [{role:'store',is_active:false},{role:'admin',is_active:true,deleted_at:'2026-11-01'},{role:'unknown',is_active:true},null]) {
  const h=locationHelpHarness('pages/ManagerChecklists',{
   useAuth:()=>({user:profile?{id:actor}:null,profile,locations:[]}),supabase:{from(){throw new Error('Denied account queried database')}},
   localChecklistDate:()=>'',NavBar:()=>null,ChecklistForm:()=>null,ChecklistAdmin:()=>null,
  })
  await h.flush();assert.equal(h.find(n=>n.props?.role==='alert').props.children,'Active checklist account required.');h.unmount()
 }
})
test('Admin management keeps template editing and makes no pilot/user grant queries',async()=>{
 const h=locationHelpHarness('components/ChecklistAdmin',{supabase:{from(){throw new Error('Grant query must be removed')}}},{templates:checklistTemplates,reload(){}})
 await h.flush()
 assert.equal(h.all(n=>n.type==='select').length,0)
 assert.equal(h.all(n=>n.type==='button').length,4)
 button(h,'Mid-Day Checklist').props.onClick();h.render()
 assert.ok(button(h,'Save template'));h.unmount()
})
