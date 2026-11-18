import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { webcrypto } from 'node:crypto'
import { moveChecklistSection, newChecklistQuestion, photoBudget, templateEditorAction } from '../src/utils/checklistTemplateEditor.js'
import { requiredChecklistPhotos, validateChecklist } from '../src/utils/checklistRules.js'
import { setManagerViewReadOnly } from '../src/utils/managerViewPolicy.js'

test('new IDs and presets preserve fixed response semantics; photo counts preserve old booleans',()=>{
 const q=newChecklistQuestion('yesno','Test')
 assert.match(q.id,/^q-[a-f0-9-]{36}$/);assert.deepEqual(q.options,['Yes','No']);assert.equal(q.na_allowed,false)
 assert.notEqual(newChecklistQuestion('yesno','Test').id,q.id)
 assert.throws(()=>newChecklistQuestion('sql','Test'))
 assert.equal(requiredChecklistPhotos({photo_required:true,failure_values:[]}),1)
 assert.equal(requiredChecklistPhotos({...q,photo_on_failure:true,failure_values:['No']},{value:'No'}),1)
 assert.equal(requiredChecklistPhotos({...q,photo_min_count:10}),10)
 assert.equal(photoBudget([{...q,photo_min_count:11}]),Infinity)
})
test('validation counts distinct photo IDs per question and retains all final signature requirements',()=>{
 const q={...newChecklistQuestion('yesno','Test'),photo_required:true,photo_min_count:3}
 const answers={[q.id]:{value:'Yes'}}, signature={id:'s',kind:'signature',item_id:null}
 const a={id:'a',kind:'photo',item_id:q.id},b={id:'b',kind:'photo',item_id:q.id},c={id:'c',kind:'photo',item_id:q.id}
 assert.match(validateChecklist([q],answers,[a,a,b,signature],'Fictional')[q.id],/2\/3/)
 assert.deepEqual(validateChecklist([q],answers,[a,b,c,signature],'Fictional'),{})
 assert.ok(validateChecklist([q],answers,[a,b,c],'Fictional')._signature)
 assert.match(validateChecklist([q],answers,[a,b,{...c,item_id:'other'},signature],'Fictional')[q.id],/2\/3/)
})
test('whole-section ordering preserves question identities and contiguous groups without mutating inputs',()=>{
 const items=[{id:'a',section:'One'},{id:'b',section:'One'},{id:'c',section:'Two'}]
 assert.deepEqual(moveChecklistSection(items,'Two',-1).map(i=>i.id),['c','a','b'])
 assert.deepEqual(items.map(i=>i.id),['a','b','c'])
 assert.equal(moveChecklistSection(items,'One',-1),items)
})
test('editor sends optimistic revisions and blocks Manager View writes before making requests',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true}}}},state={published:{version:3},draft:{revision:7}}
 await templateEditorAction(client,'save','opening',state,{p_definition:[]})
 assert.equal(calls[0].args.p_revision,7);assert.equal(calls[0].args.p_version,3)
 setManagerViewReadOnly(true)
 try {await assert.rejects(templateEditorAction(client,'publish','opening',state),/read-only/);assert.equal(calls.length,1)}finally{setManagerViewReadOnly(false)}
 await assert.rejects(templateEditorAction({rpc:async()=>({error:new Error('Conflict')})},'save','opening',state),/Conflict/)
})

function accountEndpoint({authorized=true,protectionError=false,active=true,deleted=false,role='admin'}={}) {
 let handler, mutations=0,checks=0,identityUpdates=0
 const caller={role,is_active:active,deleted_at:deleted?'date':null}
 const builder={select(){return this},eq(){return this},maybeSingle:async()=>({data:caller})}
 const admin={from:()=>builder,auth:{admin:{async updateUserById(){mutations++;return {}},async deleteUser(){mutations++;return {}}}}}
 const user={auth:{getUser:async()=>({data:{user:{id:'00000000-0000-0000-0000-000000000001'}}})},async rpc(){checks++;return protectionError?{error:{message:'Unavailable'}}:{data:authorized}},from(){return {update(){identityUpdates++;return this},eq:async()=>({})}}}
 let clients=0
 const source=readFileSync(new URL('../supabase/functions/admin-users/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
 new Function('Deno','createClient','projectKeys','crypto',transformSync(source,{loader:'ts',format:'cjs'}).code)({serve:fn=>{handler=fn}},()=>clients++%2===0?user:admin,()=>({url:'https://fictional.invalid',publishableKey:'public',secretKey:'fictional'}),webcrypto)
 return {stats:()=>({mutations,checks,identityUpdates}),call:action=>handler(new Request('https://fictional.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,user_id:'00000000-0000-0000-0000-000000000099',new_email:'fictional@example.invalid'})}))}
}
test('real account endpoint checks caller-JWT authorization before password/email/delete and fails closed on missing guard',async()=>{
 for(const action of ['reset_password','change_email','delete']) for(const config of [{authorized:false},{protectionError:true}]){
  const endpoint=accountEndpoint(config),result=await endpoint.call(action)
  assert.equal(result.status,403);assert.equal(endpoint.stats().mutations,0);assert.equal(endpoint.stats().checks,1)
 }
 for(const config of [{active:false},{deleted:true},{role:'store'}]){
  const endpoint=accountEndpoint(config),result=await endpoint.call('reset_password')
  assert.equal(result.status,403);assert.equal(endpoint.stats().mutations,0)
 }
 const normal=accountEndpoint();assert.equal((await normal.call('reset_password')).status,200);assert.equal(normal.stats().mutations,1)
 const email=accountEndpoint();assert.equal((await email.call('change_email')).status,200);assert.equal(email.stats().identityUpdates,1)
})
