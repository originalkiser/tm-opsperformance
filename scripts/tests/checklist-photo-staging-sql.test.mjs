// Focused staging/cutover checks, isolated fictional PostgreSQL only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {setup,api,actor,root,start,upload,ready,saveNew,configure,guest,uuid,site,away,store,admin,maintenance,activate} from './helpers/checklistPhotoFixture.mjs'
const openingSql=readFileSync(new URL('../../app/supabase/migrations/20261116031924_opening_trap_door_inspections.sql',import.meta.url),'utf8')
async function oldUpload(db,row,{guestActor=false,item=null}={}) {
 const body={id:row.id,kind:'photo',item_id:item||row.template_snapshot.definition.find(i=>i.photo_required).id,extension:'png'}
 const call=(action,body)=>guestActor?guest(db,action,body):api(db,action,body)
 const u=await call('upload_begin',body)
 await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[u.object_path])
 const result=await call('upload_finish',{id:row.id,upload_id:u.upload_id}) // Original endpoint: no SHA field.
 return result.attachment
}
async function recordAll(db,sha='a'.repeat(64)) {
 const batch=await maintenance(db,'batch')
 for(const obj of batch.objects)await maintenance(db,'record',{attachment_id:obj.attachment_id,sha256:sha})
}
test('bootstrap permits old authenticated and QR photo uploads and final submissions while history is pending',async()=>{
 const {db}=await setup({enforcement:false});try{
  await configure(db)
  const account=(await start(db,'opening')).submission,qr=(await guest(db,'start',{template_key:'closing'})).submission
  const a=await oldUpload(db,account),b=await oldUpload(db,qr,{guestActor:true,item:'closing-19'})
  assert.equal((await maintenance(db,'report')).unverified_photos,2)
  const sig=(row,item=null,isGuest=false)=>upload(db,row,item,'signature',isGuest?null:store,isGuest?'a'.repeat(64):null)
  await sig(account)
  const done=await saveNew(db,account,true);assert.equal(done.submission.status,'submitted')
  // Closing has three required photos: keep the QR flow on its original snapshot.
  for(const item of qr.template_snapshot.definition.filter(i=>i.photo_required&&i.id!==b.item_id))await oldUpload(db,qr,{guestActor:true,item:item.id})
  await sig(qr,null,true)
  const submitted=await saveNew(db,qr,true,null,'a'.repeat(64));assert.equal(submitted.submission.status,'submitted')
  assert.equal((await maintenance(db,'report')).enforced,false)
  assert.ok((await maintenance(db,'report')).unverified_photos>0)
 }finally{await db.close()}
})
test('inaccessible history blocks activation, not new staging submissions, and reports the affected location',async()=>{
 const {db}=await setup({enforcement:false});try{
  const one=(await start(db,'opening')).submission
  const a=await oldUpload(db,one)
  await maintenance(db,'record',{attachment_id:a.id,error_code:'download_failed'})
  let r=await maintenance(db,'report');assert.equal(r.locations.find(l=>l.location_id===site).inaccessible,1)
  await assert.rejects(activate(db),/not ready/)
  const two=(await start(db,'closing')).submission
  await oldUpload(db,two,{item:'closing-19'})
  r=await maintenance(db,'report');assert.equal(r.enforced,false);assert.equal(r.unverified_photos,2)
  assert.equal(r.inaccessible[0].location_id,site)
 }finally{await db.close()}
})
test('activation requires verified endpoint, every current eligible location, complete fingerprints, objects and no in-flight uploads',async()=>{
 const {db}=await setup({enforcement:false});try{
  for(let n=20;n<38;n++)await root(db,'insert into public.locations(id,site_code,timezone) values($1,$2,$3)',[uuid(n),`Fictional eligible ${n}`,'America/New_York'])
  let r=await maintenance(db,'report')
  await assert.rejects(maintenance(db,'activate',{expected_location_ids:r.eligible_location_ids}),/endpoint deployment required/)
  await assert.rejects(maintenance(db,'attest_endpoint',{version:'old',deployment_id:'fictional'}),/endpoint deployment required/)
  await maintenance(db,'attest_endpoint',{version:'sha256-v1',deployment_id:'fictional'})
  await assert.rejects(maintenance(db,'activate',{expected_location_ids:r.eligible_location_ids}),/drain window is still open/)
  await root(db,"update checklist_private.photo_rollout set endpoint_verified_at=clock_timestamp()-interval '11 minutes' where singleton")
  await assert.rejects(maintenance(db,'activate',{expected_location_ids:[site]}),/Eligible locations changed/)
  assert.equal(r.locations.length,20);assert.ok(r.locations.every(l=>l.photos===0))
  const row=(await start(db,'opening')).submission
  const u=await api(db,'upload_begin',{id:row.id,item_id:'opening-1',kind:'photo',extension:'jpg'})
  await assert.rejects(activate(db),/still in flight/)
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[u.object_path])
  await api(db,'upload_finish',{id:row.id,upload_id:u.upload_id})
  await assert.rejects(activate(db),/not ready/)
  await maintenance(db,'record',{attachment_id:u.upload_id,sha256:'b'.repeat(64)})
  await root(db,"delete from storage.objects where name=$1",[u.object_path])
  await assert.rejects(activate(db),/not ready/)
  r=await maintenance(db,'report');assert.equal(r.missing_objects,1);assert.equal(r.enforced,false)
 }finally{await db.close()}
})
test('staging duplicates remain historical evidence; activation rejects new reuse and retains saved photos/corrections',async()=>{
 const {db}=await setup({enforcement:false});try{
  const a=(await start(db,'opening')).submission,b=(await start(db,'closing')).submission
  const first=await oldUpload(db,a),second=await oldUpload(db,b,{item:'closing-19'})
  for(const obj of [first,second])await maintenance(db,'record',{attachment_id:obj.id,sha256:'c'.repeat(64)})
  assert.equal((await maintenance(db,'report')).unverified_photos,0)
  const enabled=await activate(db);assert.equal(enabled.enforced,true)
  const u=await api(db,'upload_begin',{id:a.id,item_id:'opening-1',kind:'photo',extension:'png'})
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[u.object_path])
  await assert.rejects(api(db,'upload_finish',{id:a.id,upload_id:u.upload_id,sha256:'c'.repeat(64)}),/already used.*new photo/)
  assert.deepEqual((await api(db,'read',{id:a.id})).evidence.map(e=>e.id),[first.id])
  await upload(db,a,null,'signature')
  const done=(await saveNew(db,a,true)).submission
  const correction=(await api(db,'begin_edit',{id:a.id,revision:done.revision})).submission
  await upload(db,correction,null,'signature');assert.equal((await saveNew(db,correction,true)).submission.status,'submitted')
  assert.equal((await api(db,'history',{id:a.id})).versions.length,2)
 }finally{await db.close()}
})
test('reconciliation discovers transition arrivals and remains idempotent; no original rows or audit definitions are rewritten',async()=>{
 const {db}=await setup({enforcement:false});try{
  const beforeAudits=await root(db,"select key,definition,version from public.checklist_templates where key like '%audit' or key='monthly_site_assessment' order by key")
  const row=(await start(db,'opening')).submission
  const one=await oldUpload(db,row)
  // Simulate a deliberately missing registry entry; activation must reject even before reconciliation.
  await root(db,'delete from checklist_private.photo_fingerprints where attachment_id=$1',[one.id])
  await assert.rejects(activate(db),/not ready/)
  assert.equal((await maintenance(db,'reconcile')).queued,1);assert.equal((await maintenance(db,'reconcile')).queued,0)
  await recordAll(db)
  const two=(await start(db,'closing')).submission;await oldUpload(db,two,{item:'closing-19'})
  await assert.rejects(activate(db),/not ready/)
  await recordAll(db,'d'.repeat(64));await activate(db)
  assert.deepEqual((await api(db,'read',{id:row.id})).submission.template_snapshot,row.template_snapshot)
  assert.deepEqual(await root(db,"select key,definition,version from public.checklist_templates where key like '%audit' or key='monthly_site_assessment' order by key"),beforeAudits)
  assert.equal((await api(db,'read',{id:row.id})).evidence[0].object_path,one.object_path)
 }finally{await db.close()}
})
test('legacy attachment RPC queues during staging; browser roles cannot attest or activate; Opening publication waits for backend activation',async()=>{
 const {db}=await setup({enforcement:false});try{
  const row=(await start(db,'opening')).submission,id=uuid(999),path=`${row.id}/${id}.png`
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[path])
  await actor(db,store)
  await db.query('select public.attach_checklist_evidence($1,$2,$3,$4,$5)',[row.id,id,'opening-1','photo',path])
  assert.equal((await maintenance(db,'report')).unverified_photos,1)
  await actor(db,store)
  for(const action of ['activate','attest_endpoint','reconcile'])await assert.rejects(db.query('select public.checklist_photo_history($1,$2)',[action,JSON.stringify({expected_location_ids:[site,away],version:'sha256-v1',deployment_id:'spoof'})]),/permission denied/)
  await db.exec('reset role')
  await assert.rejects(db.exec(openingSql),/Activate the verified photo backend/);await db.exec('rollback')
  const pm=(await start(db,'weekly_pm')).submission;assert.equal(pm.template_snapshot.definition.length,80)
  await recordAll(db);await activate(db);await db.exec('reset role');await db.exec(openingSql)
  assert.equal((await api(db,'read',{id:pm.id})).submission.template_snapshot.definition.length,80)
 }finally{await db.close()}
})
test('verified observation uploads accept staging duplicates and atomic activation protects only later evidence',async()=>{
 const {db}=await setup({enforcement:false});try{
  for(const key of ['opening','closing']){
   const row=(await start(db,key)).submission
   const u=await api(db,'upload_begin',{id:row.id,kind:'photo',item_id:row.template_snapshot.definition.find(i=>i.photo_required).id,extension:'png',verifier_version:'sha256-v1'})
   await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[u.object_path])
   await api(db,'upload_finish',{id:row.id,upload_id:u.upload_id,sha256:'f'.repeat(64)})
  }
  assert.equal((await maintenance(db,'report')).unverified_photos,0)
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_fingerprints where legacy and state=\'verified\''))[0].n,2)
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_claims'))[0].n,1)
  assert.equal((await activate(db)).enforced,true)
 }finally{await db.close()}
})
test('both Management Audits remain fully usable and QR-isolated before and after activation',async()=>{
 const {db}=await setup({enforcement:false});try{
  await configure(db)
  const row=(await start(db,'opening')).submission,old=await oldUpload(db,row)
  await maintenance(db,'record',{attachment_id:old.id,error_code:'download_failed'})
  for(const key of ['monthly_site_assessment','quarterly_safety_audit']){
   const audit=(await start(db,key)).submission
   await ready(db,audit)
   assert.equal((await saveNew(db,audit,true)).submission.status,'submitted')
   await assert.rejects(guest(db,'start',{template_key:key}),/Authenticated/)
   assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_fingerprints where submission_id=$1',[audit.id]))[0].n,0)
   if(key==='monthly_site_assessment'){
    await maintenance(db,'record',{attachment_id:old.id,sha256:'e'.repeat(64)})
    await activate(db)
   }
  }
 }finally{await db.close()}
})
