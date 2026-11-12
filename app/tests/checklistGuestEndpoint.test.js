import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { checklistAccess } from '../supabase/functions/checklist-access/handler.js'
const token='a'.repeat(64), id='00000000-0000-0000-0000-000000000010', userId='00000000-0000-0000-0000-000000000001'
const png=new Uint8Array([137,80,78,71,13,10,26,10,0])
function request(body) {return new Request('https://fictional.invalid/functions/v1/checklist-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
function clients({auth=true,rpc,upload,download}={}) {
 const calls=[]
 return {
  calls,
  user:{auth:{getUser:async()=>({data:{user:auth?{id:userId}:null},error:auth?null:{message:'invalid'}})}},
  server:{
   rpc:async(name,args)=>{calls.push({name,args});return rpc?rpc(args,calls):{data:{ok:true},error:null}},
   storage:{from:name=>{
    assert.equal(name,'manager-checklist-evidence')
    return {upload:upload||(async()=>({error:null})),download:download||(async()=>({data:new Blob([png],{type:'image/png'}),error:null}))}
   }}
  }
 }
}
function multipart(fields,bytes=png,type='image/png') {const body=new FormData();for(const[k,v]of Object.entries(fields))body.set(k,v);body.set('file',new Blob([bytes],{type}),'signature.png');return new Request('https://fictional.invalid/checklist',{method:'POST',body})}
test('unauthenticated requests never reach service RPC; guest token is hashed and cannot spoof actor/path',async()=>{
 let c=clients({auth:false});let r=await checklistAccess(request({action:'read',id}),c.user,c.server,webcrypto);assert.equal(r.status,401);assert.equal(c.calls.length,0)
 c=clients({auth:false});r=await checklistAccess(request({action:'read',id,token,p_actor:userId,p_token_hash:'fake',object_path:'foreign/file',guest_grant_id:'fake'}),c.user,c.server,webcrypto)
 assert.equal(r.status,200);assert.equal(c.calls[0].args.p_actor,null);assert.match(c.calls[0].args.p_token_hash,/^[a-f0-9]{64}$/);assert.notEqual(c.calls[0].args.p_token_hash,token)
 assert.deepEqual(c.calls[0].args.p_body,{id});assert.equal(JSON.stringify(c.calls).includes(token),false)
})
test('empty draft name survives whitelisting and malformed capabilities never reach RPC',async()=>{
 const c=clients();let r=await checklistAccess(request({action:'save',id,revision:1,answers:{},manager_name:'',submit:false}),c.user,c.server,webcrypto)
 assert.equal(r.status,200);assert.equal(c.calls[0].args.p_body.manager_name,'');assert.equal(c.calls[0].args.p_actor,userId)
 for(const value of ['',null,'b'.repeat(63),'Z'.repeat(64)]) {r=await checklistAccess(request({action:'read',id,token:value}),c.user,c.server,webcrypto);assert.equal(r.status,401)}
 assert.equal(c.calls.length,1)
})
test('admin rotation returns generated secret once and passes only its hash plus expected generation; guests cannot rotate',async()=>{
 const c=clients({rpc:async args=>({data:{grant:{id,generation:2}},error:null})})
 let r=await checklistAccess(request({action:'qr_rotate',location_id:id,expected_generation:1,token_hash:'attacker'}),c.user,c.server,webcrypto)
 const result=await r.json();assert.match(result.token,/^[a-f0-9]{64}$/);assert.notEqual(c.calls[0].args.p_body.token_hash,result.token);assert.equal(c.calls[0].args.p_body.expected_generation,1)
 r=await checklistAccess(request({action:'qr_rotate',location_id:id,token}),c.user,c.server,webcrypto);assert.equal(r.status,401);assert.equal(c.calls.length,1)
})
test('binary download rechecks authorization after transfer and sends no bytes after revocation',async()=>{
 let checks=0
 const c=clients({rpc:async()=> ++checks===1?{data:{object_path:'authorized/file.png',attachment_id:id},error:null}:{data:null,error:{code:'42501',message:'revoked'}},download:async()=>({data:new Blob([png],{type:'image/png'}),error:null})})
 let r=await checklistAccess(request({action:'download',token,id,attachment_id:id}),c.user,c.server,webcrypto)
 assert.equal(r.status,403);assert.match(r.headers.get('Content-Type'),/json/);assert.equal(checks,2)
 const good=clients({rpc:async()=>({data:{object_path:'authorized/file.png',attachment_id:id},error:null})})
 r=await checklistAccess(request({action:'download',token,id,attachment_id:id}),good.user,good.server,webcrypto)
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Content-Type'),'image/png');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png)
})
test('upload uses server intent path, validates contents, never replaces an object and registers only on confirmed upload',async()=>{
 let received
 const c=clients({rpc:async args=>({data:args.p_action==='upload_begin'?{upload_id:id,object_path:'server/path.png'}:{attachment:{id}},error:null}),upload:async(path,bytes,options)=>{received={path,bytes,options};return{error:null}}})
 let r=await checklistAccess(multipart({action:'upload',token,id,kind:'signature',object_path:'attacker/path',item_id:''}),c.user,c.server,webcrypto)
 assert.equal(r.status,200);assert.equal(received.path,'server/path.png');assert.equal(received.options.upsert,false);assert.equal(received.options.cacheControl,'0')
 assert.deepEqual(c.calls.map(c=>c.args.p_action),['upload_begin','upload_finish']);assert.equal(c.calls[1].args.p_body.upload_id,id)
 r=await checklistAccess(multipart({action:'upload',token,id,kind:'signature'},new Uint8Array([1,2,3])),c.user,c.server,webcrypto);assert.equal(r.status,415);assert.equal(c.calls.length,2)
 const failed=clients({rpc:async()=>({data:{upload_id:id,object_path:'server/path.png'},error:null}),upload:async()=>({error:{message:'network uncertain'}})})
 r=await checklistAccess(multipart({action:'upload',token,id,kind:'signature'}),failed.user,failed.server,webcrypto);assert.equal(r.status,409);assert.equal(failed.calls.length,1)
})
test('bounded request parsing rejects oversized JSON before RPC and unrecognized action cannot invoke internal upload phases',async()=>{
 const c=clients()
 let r=await checklistAccess(request({action:'save',token,id,answers:{x:'x'.repeat(240001)}}),c.user,c.server,webcrypto);assert.equal(r.status,413)
 r=await checklistAccess(request({action:'upload_finish',id,upload_id:id,token}),c.user,c.server,webcrypto);assert.equal(r.status,400)
 r=await checklistAccess(new Request('https://fictional.invalid/checklist',{method:'GET'}),c.user,c.server,webcrypto);assert.equal(r.status,405)
 assert.equal(c.calls.length,0)
})
test('unknown database errors never leak details, token material, or stack traces; conflicts remain actionable',async()=>{
 let c=clients({rpc:async()=>({data:null,error:{code:'XX000',message:'private token '+token}})})
 let r=await checklistAccess(request({action:'read',id,token}),c.user,c.server,webcrypto);assert.equal((await r.text()).includes(token),false)
 c=clients({rpc:async()=>({data:null,error:{code:'PT409',message:'arbitrary conflict detail'}})})
 r=await checklistAccess(request({action:'save',id,token}),c.user,c.server,webcrypto);assert.equal(r.status,409);assert.match((await r.json()).error,/changed elsewhere/)
})
test('non-retryable application conflicts return one safe HTTP409 for edit, save and QR generation changes',async()=>{
 for(const action of ['begin_edit','save','qr_rotate','qr_revoke']) {
  const c=clients({rpc:async()=>({data:null,error:{code:'PT409',message:'private conflict '+token}})})
  const r=await checklistAccess(request({action,id,location_id:id,revision:1,expected_generation:0}),c.user,c.server,webcrypto)
  assert.equal(r.status,409)
  assert.deepEqual(await r.json(),{error:'Checklist changed elsewhere. Reload before saving.'})
  assert.equal(c.calls.length,1)
 }
})
