import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePdf, PDF_LIMIT, RESOURCE_CATEGORIES, resourceAccess, filterResources, validateResourceMetadata, downloadResource, uploadResource, resourceAction, cleanupResource } from '../src/utils/resourceLibrary.js'
import { cleanupResourceFiles } from '../supabase/functions/manage-resource-files/handler.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { Upload as TusUpload } from 'tus-js-client'

const id='00000000-0000-0000-0000-000000000001',fileId='00000000-0000-0000-0000-000000000002'
const pdf=(text='%PDF-1.7\nSynthetic test only',name='fictional.pdf')=>Object.assign(new Blob([text],{type:'application/pdf'}),{name})
const row={id,revision:2,title:'Example manual',category:'Equipment Manuals',brand:'Example Brand',object_path:`${id}/${fileId}.pdf`,original_name:'fictional.pdf',file_size:20}
test('PDF validation accepts a 28 MB Playbook and exact limit; rejects oversize, empty and disguised files',async()=>{
 const large=Object.assign(new Blob(['%PDF-1.7\n',new Uint8Array(28000000-9)],{type:'application/pdf'}),{name:'playbook.pdf'})
 assert.equal((await validatePdf(large)).size,28000000)
 const file=pdf(),base={name:file.name,type:file.type,slice:(...a)=>file.slice(...a),arrayBuffer:()=>file.arrayBuffer()}
 assert.equal((await validatePdf({...base,size:PDF_LIMIT})).size,PDF_LIMIT)
 await assert.rejects(validatePdf({...base,size:PDF_LIMIT+1}),/50 MB/)
 await assert.rejects(validatePdf({...base,size:0}),/nonempty/)
 await assert.rejects(validatePdf(pdf('not a PDF')),/header/)
 await assert.rejects(validatePdf(pdf('%PDF-1.7','file.exe')),/PDF/)
 await assert.rejects(validatePdf({...base,size:1,type:'image/png'}),/PDF/)
})
test('manufacturer groups and title/category/brand search preserve source records',()=>{
 const rows=[{...row,id:'b',brand:'Siemens'},{...row,id:'a',brand:'Coleman Hanna'},{...row,id:'c',category:'Employee Handbook',brand:''}]
 const before=JSON.stringify(rows)
 assert.deepEqual(filterResources(rows,{category:'Equipment Manuals'}).map(x=>x.brand),['Coleman Hanna','Siemens'])
 assert.equal(filterResources(rows,{query:'siemens'})[0].id,'b')
 assert.equal(filterResources(rows,{query:'handbook'})[0].id,'c')
 assert.equal(filterResources(rows,{query:'Example manual',brand:'Coleman Hanna'})[0].id,'a')
 assert.equal(JSON.stringify(rows),before)
 assert.throws(()=>validateResourceMetadata({...row,brand:''}),/manufacturer/)
 assert.throws(()=>validateResourceMetadata({...row,category:'Training'}),/category/)
 assert.throws(()=>validateResourceMetadata({...row,title:' '}),/title/)
 assert.equal(RESOURCE_CATEGORIES.length,5)
})
test('active Admin/Store navigation and page access only; no Admin management for Store',async()=>{
 for(const role of ['admin','store','area_manager'])for(const status of [{is_active:true,deleted_at:null},{is_active:false,deleted_at:null},{is_active:true,deleted_at:'2026-01-01'}]){
  const profile={role,...status},allowed=resourceAccess(profile)
  assert.equal(allowed,status.is_active&&!status.deleted_at&&role!=='area_manager')
  const nav=locationHelpHarness('components/NavBar',{useAuth:()=>({profile,signOut(){}}),useNavigate:()=>()=>{},useLocation:()=>({pathname:'/resources'}),useDarkModeCtx:()=>[false,()=>{}],useChecklistAccess:()=>false,resourceAccess,Link:()=>null,tmLogo:'',SettingsModal:()=>null,TargetsBell:()=>null,HelpPanel:()=>null})
  assert.equal(!!nav.find(n=>n.props?.to==='/resources'),allowed);nav.unmount()
  const client={from(){return {select(){return this},order:async()=>({data:[row]})}}}
  const page=locationHelpHarness('pages/Resources',{
   useAuth:()=>({user:{id},profile}),resourceAccess,RESOURCE_CATEGORIES,filterResources,supabase:client,NavBar:()=>null,ResourceViewer:()=>null,
  });await page.flush()
  assert.equal(!!page.find(n=>n.type==='input'&&n.props.multiple),allowed&&role==='admin')
  assert.equal(!!page.find(n=>n.type==='button'&&n.props.children==='Edit metadata'),allowed&&role==='admin')
  assert.equal(!!page.find(n=>n.type==='button'&&n.props.children==='Open / Download PDF'),allowed)
  page.unmount()
 }
})
function reader({denied=false,replaced=false,switched=false}={}){
 const calls=[];let sessions=0
 return {calls,auth:{async getSession(){return {data:{session:{user:{id:switched&&sessions++?'other':id}}}}}},storage:{from(bucket){calls.push(bucket);return {async download(path,query,options){calls.push({path,query,options});return {data:pdf()}}}}},from(){return {select(){return this},eq(){return this},setHeader(){return this},abortSignal(){return this},async single(){return denied?{error:{message:'Denied'}}:{data:{object_path:replaced?'new':row.object_path,removed:false}}}}}}
}
test('authenticated no-store download rechecks revocation, replacement and user changes',async()=>{
 const client=reader();const blob=await downloadResource(client,row,id,new AbortController().signal)
 assert.ok(blob instanceof Blob);assert.equal(client.calls[0],'resource-pdfs');assert.equal(client.calls[1].options.cache,'no-store');assert.ok(client.calls[1].query.cacheNonce)
 for(const options of [{denied:true},{replaced:true},{switched:true}])await assert.rejects(downloadResource(reader(options),row,id),/access changed/)
})
test('mobile viewer provides local PDF preview, new-tab fallback and download; close revokes URL',async()=>{
 const urls=[],revoked=[]
 const h=locationHelpHarness('components/ResourceViewer',{
  downloadResource:async()=>pdf(),URL:{createObjectURL:b=>{urls.push(b);return 'blob:local-pdf'},revokeObjectURL:x=>revoked.push(x)},Blob,AbortController,
 },{client:{},document:row,userId:id,onClose(){}})
 await h.flush()
 assert.equal(h.find(n=>n.type==='iframe').props.src,'blob:local-pdf')
 assert.equal(h.find(n=>n.type==='a'&&n.props.download).props.download,'fictional.pdf')
 assert.equal(h.find(n=>n.type==='a'&&n.props.target==='_blank').props.rel,'noopener noreferrer')
 h.unmount();assert.deepEqual(revoked,['blob:local-pdf']);assert.equal(urls[0].type,'application/pdf')
})
test('viewer denial never creates a usable local URL',async()=>{
 let created=0
 const h=locationHelpHarness('components/ResourceViewer',{downloadResource:async()=>{throw new Error('Denied')},URL:{createObjectURL(){created++}},AbortController},{client:{},document:row,userId:id,onClose(){}})
 await h.flush();assert.equal(created,0);assert.ok(h.find(n=>n.props?.role==='alert'));h.unmount()
})
test('resumable uploads use identity-scoped fingerprints, fresh JWT, fixed chunks, exact path and no overwrite',async()=>{
 const file=pdf(),info=await validatePdf(file),pending={...row,pending_upload:{...info,path:row.object_path}}
 let instance,resumed,starts=0,header={}
 class Upload{constructor(file,options){this.options=options;instance=this}async findPreviousUploads(){return [{uploadUrl:'https://example.invalid/resume'}]}resumeFromPreviousUpload(p){resumed=p}start(){starts++;this.options.onBeforeRequest({setHeader:(k,v)=>{header[k]=v}}).then(()=>this.options.onSuccess())}}
 const client={supabaseUrl:'https://example.supabase.co',auth:{getSession:async()=>({data:{session:{user:{id},access_token:'fictional-test-token'}}})}}
 await uploadResource(client,file,pending,'fictional-publishable',()=>{},null,Upload)
 assert.equal(starts,1);assert.ok(resumed);assert.equal(instance.options.endpoint,'https://example.storage.supabase.co/storage/v1/upload/resumable')
 assert.equal(instance.options.chunkSize,6*1024*1024);assert.equal(instance.options.metadata.objectName,row.object_path)
 assert.equal(instance.options.metadata.contentType,'application/pdf');assert.equal(header.Authorization,'Bearer fictional-test-token')
 assert.equal(header.apikey,'fictional-publishable');assert.equal(instance.options.headers?.['x-upsert'],undefined)
 assert.ok((await instance.options.fingerprint()).includes(`${id}:${row.object_path}:${info.sha256}`))
 assert.equal(instance.options.onShouldRetry({originalResponse:{getStatus:()=>403}},0,instance.options),false)
 await assert.rejects(uploadResource(client,pdf('%PDF-different'),pending,'key',()=>{},null,Upload),/exact PDF/)
})
test('interrupted TUS upload keeps reservation for explicit resume, pauses and does not publish automatically',async()=>{
 const file=pdf(),info=await validatePdf(file),pending={...row,pending_upload:{...info,path:row.object_path}},controller=new AbortController()
 let aborted=false,start
 const started=new Promise(resolve=>{start=resolve})
 class Upload{constructor(file,options){this.options=options}async findPreviousUploads(){return []}start(){start()}abort(terminate){aborted=terminate===false;return Promise.resolve()}}
 const client={supabaseUrl:'http://localhost:54321',auth:{getSession:async()=>({data:{session:{user:{id}}}})}}
 const result=uploadResource(client,file,pending,'key',()=>{},controller.signal,Upload)
 await started;controller.abort();await assert.rejects(result,/paused/);assert.equal(aborted,true)
 assert.equal(pending.pending_upload.path,row.object_path)
})
test('installed TUS SDK resumes HEAD offset and PATCHes remaining bytes using fresh authorization',async()=>{
 const file=pdf(),info=await validatePdf(file),pending={...row,pending_upload:{...info,path:row.object_path}}
 const requests=[],resumeUrl='https://example.invalid/uploads/fictional',previous={urlStorageKey:'fictional-key',uploadUrl:resumeUrl}
 let offset=5,removed=false
 const stack={getName:()=> 'FictionalTransport',createRequest(method,url){
  const headers={}
  return {getMethod:()=>method,getURL:()=>url,getHeader:k=>headers[k],setHeader:(k,v)=>{headers[k]=v},setProgressHandler(){},abort:async()=>{},getUnderlyingObject:()=>null,
   async send(body){requests.push({method,url,headers,body});if(method==='PATCH')offset+=body.length
    return {getStatus:()=>method==='HEAD'?200:204,getHeader:k=>({'Upload-Offset':String(offset),'Upload-Length':String(file.size),'Tus-Resumable':'1.0.0'}[k]||null),getBody:()=>'',getUnderlyingObject:()=>null}
   }}
 }}
 class Upload extends TusUpload{constructor(file,options){super(Buffer.from('%PDF-1.7\nSynthetic test only'),{...options,httpStack:stack,urlStorage:{findUploadsByFingerprint:async()=>[previous],removeUpload:async()=>{removed=true},addUpload:async()=> 'fictional-key'}})}}
 const client={supabaseUrl:'https://example.supabase.co',auth:{getSession:async()=>({data:{session:{user:{id},access_token:'fictional-token'}}})}}
 await uploadResource(client,file,pending,'fictional-key',()=>{},null,Upload)
 assert.deepEqual(requests.map(r=>r.method),['HEAD','PATCH'])
 assert.equal(requests[1].headers['Upload-Offset'],'5');assert.equal(offset,file.size)
 assert.ok(requests.every(r=>r.headers.Authorization==='Bearer fictional-token'));assert.equal(removed,true)
})
test('multiple-file Admin upload validates all files first and publishes each successful PDF once',async()=>{
 const calls=[],profile={role:'admin',is_active:true,deleted_at:null},files=[pdf(),pdf('%PDF-another','second.pdf')]
 const h=locationHelpHarness('pages/Resources',{
  useAuth:()=>({user:{id},profile}),resourceAccess,RESOURCE_CATEGORIES,filterResources,validateResourceMetadata,validatePdf,
  supabase:{from(){return {select(){return this},order:async()=>({data:[]})}}},supabasePublicKey:'fictional-key',NavBar:()=>null,ResourceViewer:()=>null,AbortController,
  resourceAction:async(client,action,record,data)=>{calls.push(action);return action==='prepare'?{...row,pending_upload:{...data,path:row.object_path}}:{...row,cleanup_path:null}},uploadResource:async()=>{calls.push('upload')},
 })
 await h.flush()
 const input=h.find(n=>n.type==='input'&&n.props.multiple)
 await input.props.onChange({target:{files,value:'selected'}});await h.flush()
 assert.deepEqual(calls,['prepare','upload','publish','prepare','upload','publish'])
 calls.length=0
 await input.props.onChange({target:{files:[files[0],pdf('not a PDF')],value:'selected'}});await h.flush()
 assert.equal(calls.length,0);assert.ok(h.find(n=>n.props?.role==='alert'));h.unmount()
})
test('management preserves optimistic revision and reports RPC/cleanup failures',async()=>{
 let args
 const client={rpc:async(name,p)=>{args=p;return {data:row}},functions:{invoke:async()=>({data:{error:'Interrupted'}})}}
 await resourceAction(client,'edit',row,{title:'New'});assert.equal(args.p_revision,row.revision);assert.equal(args.p_id,id)
 await assert.rejects(cleanupResource(client,row),/Interrupted/)
 await assert.rejects(resourceAction({rpc:async()=>({error:{message:'Conflict'}})},'remove',row),/Conflict/)
})
function cleanupFixture({denied=false,path=row.object_path,removeFail=false,finishFail=false,authFail=false}={}){
 const objects=new Set([row.object_path,'unrelated/keep.pdf']),calls=[]
 const user={auth:{getUser:async()=>authFail?{error:{message:'Expired'}}:{data:{user:{id}}}},rpc:async(name,args)=>{
  calls.push(args)
  if(denied)return {error:{message:'Active Admin required'}}
  if(args.p_action==='cleanup')return {data:{id,revision:2,path}}
  return finishFail?{error:{message:'Interrupted finish'}}:{data:{id,deleted:true}}
 }}
 const storage={storage:{from(bucket){assert.equal(bucket,'resource-pdfs');return {async remove(paths){calls.push(paths);if(removeFail)return {error:{message:'Storage interrupted'}};paths.forEach(p=>objects.delete(p));return {data:paths}}}}}}
 return {user,storage,objects,calls}
}
const request=body=>new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{id,revision:2})})
test('cleanup authenticates and authorizes before exact-path Storage removal; unrelated objects preserved',async()=>{
 const f=cleanupFixture();const response=await cleanupResourceFiles(request(),f.user,f.storage)
 assert.equal(response.status,200);assert.deepEqual([...f.objects],['unrelated/keep.pdf']);assert.equal(f.calls[0].p_action,'cleanup');assert.equal(f.calls[2].p_action,'finish_cleanup')
 for(const args of [{denied:true},{authFail:true},{path:`other/${fileId}.pdf`}]){
  const denied=cleanupFixture(args);const r=await cleanupResourceFiles(request(),denied.user,denied.storage)
  assert.ok(r.status>=400);assert.equal(denied.objects.size,2)
 }
})
test('cleanup interruptions never finish prematurely and explicit resumption is idempotent',async()=>{
 const fail=cleanupFixture({removeFail:true});assert.equal((await cleanupResourceFiles(request(),fail.user,fail.storage)).status,409)
 assert.equal(fail.objects.size,2);assert.equal(fail.calls.length,2)
 const interrupted=cleanupFixture({finishFail:true});assert.equal((await cleanupResourceFiles(request(),interrupted.user,interrupted.storage)).status,409)
 assert.deepEqual([...interrupted.objects],['unrelated/keep.pdf'])
 const resumed=cleanupFixture();resumed.objects.delete(row.object_path)
 assert.equal((await cleanupResourceFiles(request(),resumed.user,resumed.storage)).status,200);assert.deepEqual([...resumed.objects],['unrelated/keep.pdf'])
})
