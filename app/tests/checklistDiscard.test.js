import test from 'node:test'
import assert from 'node:assert/strict'
import { discardDraft } from '../supabase/functions/discard-checklist-draft/handler.js'
const id='00000000-0000-0000-0000-000000000100'
const file=n=>({id:`file-${n}`,name:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}.png`})
function fixture({signedIn=true,authorized=true,submitted=false,count=2,listFail=false,removeFail=false,finishFail=false}={}) {
 const calls=[],objects=Array.from({length:count},(_,n)=>file(n)),other=[file(9999)]
 let frozen=false,deleted=false
 const user={auth:{async getUser(){calls.push('auth');return {data:{user:signedIn?{id:'actor'}:null}}}},async rpc(name,args){
  calls.push(name)
  assert.equal(args.p_id,id)
  if(!authorized)return {error:{message:'Authorized draft access required'}}
  if(name==='begin_discard_checklist'){
   if(submitted)return {error:{message:'Submitted checklists cannot be discarded'}}
   frozen=true;return {data:{id,status:'discarding'}}
  }
  if(finishFail)return {error:{message:'Audit failed'}}
  assert.ok(frozen);assert.equal(objects.length,0);deleted=true;return {}
 }}
 const storage={storage:{from(bucket){assert.equal(bucket,'manager-checklist-evidence');return {
  async list(prefix,options){calls.push('list');assert.equal(prefix,id);assert.equal(options.offset,0);return listFail?{error:{message:'List failed'}}:{data:objects.slice(0,options.limit)}},
  async remove(paths){calls.push('remove');if(removeFail)return {error:{message:'Storage failed'}}
   assert.ok(frozen);for(const path of paths){assert.ok(path.startsWith(id+'/'));const i=objects.findIndex(f=>id+'/'+f.name===path);assert.ok(i>=0);objects.splice(i,1)}return {data:paths}
  }
 }}}}
 return {user,storage,calls,objects,other,get frozen(){return frozen},get deleted(){return deleted}}
}
const request=(body={id,revision:1},method='POST')=>new Request('https://example.invalid/discard-checklist-draft',{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})})
test('discard endpoint verifies identity, caller authorization and submitted protection before privileged cleanup',async()=>{
 for(const config of [{signedIn:false},{authorized:false},{submitted:true}]){
  const f=fixture(config),response=await discardDraft(request(),f.user,f.storage)
  assert.ok(response.status>=400);assert.ok(!f.calls.includes('remove'));assert.equal(f.deleted,false);assert.equal(f.objects.length,2)
 }
 const f=fixture();assert.equal((await discardDraft(request({},'OPTIONS'),f.user,f.storage)).status,200);assert.equal(f.calls.length,0)
 assert.equal((await discardDraft(request({},'GET'),f.user,f.storage)).status,405)
 assert.equal((await discardDraft(request({id:'../another',revision:1}),f.user,f.storage)).status,400)
 assert.equal((await discardDraft(request({id,revision:0}),f.user,f.storage)).status,400)
})
test('cleanup removes every page under only the frozen draft prefix, including unattached files',async()=>{
 const f=fixture({count:501}),response=await discardDraft(request(),f.user,f.storage)
 assert.equal(response.status,200);assert.equal((await response.json()).discarded,true)
 assert.equal(response.headers.get('Cache-Control'),'no-store')
 assert.equal(f.calls.filter(c=>c==='remove').length,2);assert.equal(f.objects.length,0);assert.equal(f.other.length,1);assert.equal(f.deleted,true)
 assert.deepEqual(f.calls.slice(0,2),['auth','begin_discard_checklist'])
 assert.equal(f.calls.at(-1),'finish_discard_checklist')
})
test('cleanup/list/audit failure keeps a frozen draft for explicit resumption; no success or automatic retry',async()=>{
 for(const config of [{listFail:true},{removeFail:true},{finishFail:true}]){
  const f=fixture(config),response=await discardDraft(request(),f.user,f.storage),body=await response.json()
  assert.equal(response.status,409);assert.equal(body.discard_pending,true);assert.equal(f.frozen,true);assert.equal(f.deleted,false)
  assert.ok(f.calls.filter(c=>c==='remove').length<=1)
  if(!config.finishFail)assert.ok(!f.calls.includes('finish_discard_checklist'))
 }
})
test('unexpected folder/path stops cleanup without expanding its scope',async()=>{
 const f=fixture();f.objects[0]={id:null,name:'nested-folder'}
 assert.equal((await discardDraft(request(),f.user,f.storage)).status,409)
 assert.ok(!f.calls.includes('remove'));assert.equal(f.deleted,false)
})


test('a cleanup request making no progress stops after one remove attempt',async()=>{
 const f=fixture();f.storage.storage.from=()=>({async list(){return {data:f.objects}},async remove(){f.calls.push('remove');return {data:[]}}})
 const response=await discardDraft(request(),f.user,f.storage)
 assert.equal(response.status,409);assert.equal(f.calls.filter(c=>c==='remove').length,1);assert.equal(f.deleted,false)
})


test('explicit retry resumes frozen cleanup after a Storage failure and deletes only after success',async()=>{
 const f=fixture(),original=f.storage.storage.from
 f.storage.storage.from=bucket=>({...original(bucket),async remove(){return {error:{message:'Network interrupted'}}}})
 assert.equal((await discardDraft(request(),f.user,f.storage)).status,409)
 assert.equal(f.frozen,true);assert.equal(f.deleted,false);assert.equal(f.objects.length,2)
 f.storage.storage.from=original
 assert.equal((await discardDraft(request(),f.user,f.storage)).status,200)
 assert.equal(f.objects.length,0);assert.equal(f.deleted,true)
})
