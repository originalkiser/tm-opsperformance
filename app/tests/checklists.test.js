import test from 'node:test'
import assert from 'node:assert/strict'
import { checklistTemplates } from '../src/utils/checklistTemplates.js'
import { validateChecklist, localChecklistDate, mondayOf, checklistPeriod, completionStatus, validateEvidence } from '../src/utils/checklistRules.js'
const [opening,midday,closing,weekly]=checklistTemplates
const complete=t=>Object.fromEntries(t.definition.map(i=>[i.id,{value:i.options[0]}]))
const photos=t=>[...t.definition.filter(i=>i.photo_required).map(i=>({item_id:i.id,kind:'photo'})),{kind:'signature'}]

test('approved inventory: original wording, critical exception, six photo requirements and conditional N/A',()=>{
 assert.deepEqual(checklistTemplates.map(t=>t.definition.length),[31,5,19,16])
 assert.deepEqual(checklistTemplates.map(t=>t.definition.filter(i=>i.critical).length),[31,0,18,0])
 assert.equal(closing.definition.find(i=>i.text==='Secure the site - Lock front and back door and set alarm system').critical,false)
 assert.deepEqual(checklistTemplates.map(t=>t.definition.filter(i=>i.photo_required).length),[1,0,3,2])
 assert.deepEqual(checklistTemplates.map(t=>t.definition.filter(i=>i.na_allowed).length),[0,0,1,3])
 assert.deepEqual(midday.definition[4].options,['Empty','Half full','Overflowing/needs to be emptied'])
 assert.equal(opening.definition[14].text,'Pull top brush down and spin it around to ensure no debris has wrapped around it from the prior day.')
 assert.deepEqual(opening.definition[14].options,['Completed','Not Completed'])
 assert.equal(weekly.definition[6].text,'Dashboard Performance Review completed. How does the site compare with other locations?')
 assert.equal(weekly.definition[7].text,'Dashboard Team Performance reviewed. Are the right employees scheduled at the right times?')
})
test('required responses/evidence, failure/N/A explanations, name and signature; weekly reviews need no narrative',()=>{
 for(const t of checklistTemplates){
  const answers=complete(t),evidence=photos(t)
  assert.deepEqual(validateChecklist(t.definition,answers,evidence,'Test Manager'),{})
  assert.equal(Object.keys(validateChecklist(t.definition,{},[],'')).length,t.definition.length+2)
  const first=t.definition[0];answers[first.id]={value:first.failure_values[0]}
  assert.match(validateChecklist(t.definition,answers,evidence,'Test Manager')[first.id],/explanation/)
  answers[first.id].explanation='Unable to complete; action recorded.'
  assert.deepEqual(validateChecklist(t.definition,answers,evidence,'Test Manager'),{})
  answers[first.id]={value:'N/A',explanation:'Not applicable'}
  assert.match(validateChecklist(t.definition,answers,evidence,'Test Manager')[first.id],/Choose/)
  const conditional=t.definition.find(i=>i.na_allowed)
  if(conditional){answers[first.id]={value:first.options[0]};answers[conditional.id]={value:'N/A'};assert.match(validateChecklist(t.definition,answers,evidence,'Test Manager')[conditional.id],/explanation/)}
 }
})
test('single-selection and overflow explanations; Admin-configurable conditional evidence',()=>{
 const answers=complete(midday)
 answers['midday-5']={value:['Empty','Half full']};assert.match(validateChecklist(midday.definition,answers,photos(midday),'Test Manager')['midday-5'],/Choose/)
 answers['midday-5']={value:'Overflowing/needs to be emptied'};assert.match(validateChecklist(midday.definition,answers,photos(midday),'Test Manager')['midday-5'],/explanation/)
 const items=[{...midday.definition[0],photo_on_failure:true,explanation_required:true}]
 assert.match(validateChecklist(items,complete(midday),photos(midday),'Test Manager')['midday-1'],/explanation/)
 answers['midday-1']={value:'No',explanation:'Debris removed'}
 assert.match(validateChecklist(items,answers,photos(midday),'Test Manager')['midday-1'],/photo/)
 assert.deepEqual(validateChecklist(items,answers,[...photos(midday),{kind:'photo',item_id:'midday-1'}],'Test Manager'),{})
})
test('Monday end-of-day in site time zone, DST, year boundary and leap day',()=>{
 const instant=new Date('2026-11-03T07:30:00Z')
 assert.equal(localChecklistDate('America/Los_Angeles',instant),'2026-11-02')
 assert.equal(localChecklistDate('America/New_York',instant),'2026-11-03')
 assert.equal(localChecklistDate('America/Los_Angeles',new Date('2026-03-09T06:59:59Z')),'2026-03-08')
 assert.equal(localChecklistDate('America/Los_Angeles',new Date('2026-03-09T07:00:00Z')),'2026-03-09')
 assert.equal(mondayOf('2028-02-29'),'2028-02-28');assert.equal(mondayOf('2027-01-01'),'2026-12-28')
 assert.throws(()=>mondayOf('2026-02-29'),/Invalid/);assert.throws(()=>localChecklistDate(null),/time zone/)
 assert.equal(checklistPeriod(weekly,'2028-03-01'),'2028-02-28')
 assert.equal(completionStatus(weekly,'2026-11-02',[],'2026-11-02'),'Not submitted')
 assert.equal(completionStatus(weekly,'2026-11-02',[],'2026-11-03'),'Missing')
 assert.equal(completionStatus(weekly,'2026-11-02',[{template_key:'weekly',period_date:'2026-11-02',status:'draft'}],'2026-11-03'),'Draft')
})
test('private image format and size limits',()=>{
 for(const type of ['image/jpeg','image/png','image/webp']) assert.doesNotThrow(()=>validateEvidence({type,size:1024}))
 for(const file of [{type:'text/html',size:10},{type:'image/png',size:0},{type:'image/png',size:10485761}])assert.throws(()=>validateEvidence(file))
})

// Real locked SDK transport, fictional fetch only: no Supabase project is contacted.
import { createClient } from '@supabase/supabase-js'
import { downloadChecklistEvidence, checklistUploadRejection } from '../src/utils/checklistEvidence.js'
function evidenceClient({ allowed=true, revokeDuringTransfer=false, sessionId='manager' }={}) {
 const calls=[];let current=sessionId,permit=allowed
 const file={id:'file',object_path:'submission/file.png'}
 const sdk=createClient('https://fictional-checklist.invalid','fictional-public-key',{
  realtime:{transport:class { constructor(){throw Error('Realtime connections are forbidden in this fixture')} }},
  accessToken:async()=> 'fictional-account-token',auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async(url,init)=>{
   const endpoint=new URL(url);const headers=new Headers(init.headers)
   calls.push({endpoint,cache:init.cache,headers,signal:init.signal})
   assert.equal(headers.get('authorization'),'Bearer fictional-account-token')
   if(endpoint.pathname.startsWith('/storage/v1/object/')){
    if(!permit)return new Response(JSON.stringify({message:'Access denied',statusCode:'403',error:'Forbidden'}),{status:403,headers:{'Content-Type':'application/json'}})
    if(revokeDuringTransfer)permit=false
    return new Response(new Blob(['fictional-photo'],{type:'image/png'}),{headers:{'Content-Type':'image/png'}})
   }
   assert.equal(endpoint.pathname,'/rest/v1/checklist_attachments')
   assert.equal(endpoint.searchParams.get('id'),'eq.file')
   return new Response(JSON.stringify(permit?{object_path:file.object_path}:null),{headers:{'Content-Type':'application/json'}})
  }},
 })
 return {client:{auth:{async getSession(){return {data:{session:current?{user:{id:current}}:null}}}},storage:sdk.storage,from:(...args)=>sdk.from(...args)},file,calls,
  revoke(){permit=false},changeSession(id){current=id}}
}
test('authenticated evidence reads use new cache nonces, no-store and a fresh post-transfer RLS check',async()=>{
 const h=evidenceClient(),controller=new AbortController()
 for(let i=0;i<2;i++)assert.equal((await downloadChecklistEvidence(h.client,h.file,'manager',controller.signal)).type,'image/png')
 const objects=h.calls.filter(c=>c.endpoint.pathname.startsWith('/storage/'))
 assert.equal(objects.length,2)
 assert.ok(objects.every(c=>c.cache==='no-store'&&c.signal===controller.signal))
 assert.notEqual(objects[0].endpoint.searchParams.get('cacheNonce'),objects[1].endpoint.searchParams.get('cacheNonce'))
 assert.ok(objects.every(c=>!c.endpoint.pathname.includes('/sign/')&&!c.endpoint.searchParams.has('token')))
 const checks=h.calls.filter(c=>c.endpoint.pathname.startsWith('/rest/'))
 assert.equal(checks.length,2);assert.ok(checks.every(c=>c.headers.get('Cache-Control')==='no-cache, no-store'))
})
test('a previously successful read cannot be reused after revocation; denied or mid-transfer revoked access returns no evidence',async()=>{
 const h=evidenceClient()
 await downloadChecklistEvidence(h.client,h.file,'manager')
 h.revoke();await assert.rejects(downloadChecklistEvidence(h.client,h.file,'manager'))
 assert.equal(h.calls.filter(c=>c.endpoint.pathname.startsWith('/storage/')).length,2)
 const changing=evidenceClient({revokeDuringTransfer:true})
 await assert.rejects(downloadChecklistEvidence(changing.client,changing.file,'manager'),/no longer authorized/)
 assert.equal(changing.calls.length,2)
})
test('signed-out, changed-account and canceled evidence reads fail closed',async()=>{
 for(const sessionId of [null,'different-user']){
  const h=evidenceClient({sessionId});await assert.rejects(downloadChecklistEvidence(h.client,h.file,'manager'),/Sign in/)
  assert.equal(h.calls.length,0)
 }
 const h=evidenceClient(),controller=new AbortController();controller.abort()
 await assert.rejects(downloadChecklistEvidence(h.client,h.file,'manager',controller.signal))
})


test('real locked SDK Storage 500 maps to lifecycle guidance only after an authenticated uncached state read',async()=>{
 for(const state of [null,'discarding','submitted','draft']){
  const calls=[]
  const client=createClient('https://fictional-stale-upload.invalid','fictional-public-key',{
   realtime:{transport:class {constructor(){throw Error('Realtime forbidden in this fixture')}}},
   accessToken:async()=> 'fictional-account-token',auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:async(url,init)=>{
    const endpoint=new URL(url),headers=new Headers(init.headers);calls.push({endpoint,headers})
    assert.equal(headers.get('authorization'),'Bearer fictional-account-token')
    if(endpoint.pathname.startsWith('/storage/'))return new Response(JSON.stringify({statusCode:'500',error:'DatabaseError',message:'database error, code: P0001',code:'DatabaseError'}),{status:500,headers:{'Content-Type':'application/json'}})
    assert.equal(endpoint.pathname,'/rest/v1/checklist_submissions');assert.equal(endpoint.searchParams.get('id'),'eq.discarded-draft')
    assert.equal(endpoint.searchParams.get('select'),'status');assert.equal(headers.get('Cache-Control'),'no-cache, no-store')
    return new Response(JSON.stringify(state===null?[]:[{status:state}]),{headers:{'Content-Type':'application/json'}})
   }},
  })
  const uploaded=await client.storage.from('manager-checklist-evidence').upload('discarded-draft/test.png',new Blob(['synthetic'],{type:'image/png'}),{upsert:false})
  assert.ok(uploaded.error);assert.equal(uploaded.error.status,500)
  const result=await checklistUploadRejection(client,'discarded-draft',uploaded.error)
  assert.equal(result?.status||null,state==='draft'?null:state===null?'unavailable':state)
  assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.endpoint.pathname.startsWith('/storage/')).length,1)
 }
})
test('lifecycle error explanation fails closed on permission/read/network errors and ignores unrelated 500s',async()=>{
 const known={status:500,message:'database error, code: P0001'}
 for(const failure of ['rls','network']){
  const client={from(){return {select(){return this},eq(){return this},setHeader(){return this},async maybeSingle(){if(failure==='network')throw Error('offline');return {error:{code:'42501',message:'Denied'}}}}}}
  assert.equal(await checklistUploadRejection(client,'draft',known),null)
 }
 const client={from(){throw Error('Unrelated errors must not trigger a lifecycle lookup')}}
 assert.equal(await checklistUploadRejection(client,'draft',{status:500,message:'Different error'}),null)
 assert.equal(await checklistUploadRejection(client,'draft',{status:401,message:'Expired session'}),null)
})
