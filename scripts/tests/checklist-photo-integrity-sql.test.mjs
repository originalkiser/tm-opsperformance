// Fictional-only PostgreSQL fixture. Set PGLITE_MODULE to a local PGlite module.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { weeklyPmTemplate } from '../../app/src/utils/weeklyPmTemplate.js'
import { setup, api, actor, root, start, upload, ready, saveNew, configure, guest, allAnswers, uuid, site, away, admin, store, other, outsider, maintenance, activate } from './helpers/checklistPhotoFixture.mjs'
const pmSql=readFileSync(new URL('../../app/supabase/migrations/20261116031924_weekly_pm_trap_door_inspections.sql',import.meta.url),'utf8')
const integritySql=readFileSync(new URL('../../app/supabase/migrations/20261116023332_checklist_photo_integrity.sql',import.meta.url),'utf8')
async function photo(db,row,sha='c'.repeat(64),item=row.template_snapshot.definition[0].id,uploadId) {
 const body={id:row.id,item_id:item,kind:'photo',extension:'png',working_copy_id:row.working_copy_id,...(uploadId?{upload_id:uploadId}:{})}
 const intent=await api(db,'upload_begin',body)
 await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1) on conflict do nothing",[intent.object_path])
 return {body,intent,finish:()=>api(db,'upload_finish',{...body,upload_id:intent.upload_id,sha256:sha})}
}
test('unique fingerprints reject same-location reuse across checklist types and dates, allow other locations',async()=>{
 const {db,today}=await setup();try {
  const row=(await start(db,'opening')).submission,otherRow=(await start(db,'closing')).submission
  const first=await photo(db,row);await first.finish()
  const second=await photo(db,otherRow);await assert.rejects(second.finish,/already used.*Take a new photo/)
  const yesterday=(await root(db,'select ($1::date-1)::text d',[today]))[0].d
  const previous=(await start(db,'opening',store,null,yesterday)).submission
  await assert.rejects((await photo(db,previous)).finish,/already used/)
  const elsewhere=(await api(db,'start',{location_id:away,template_key:'opening'},outsider)).submission
  const body={id:elsewhere.id,item_id:'opening-1',kind:'photo',extension:'png'}
  const intent=await api(db,'upload_begin',body,outsider)
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path])
  await api(db,'upload_finish',{...body,upload_id:intent.upload_id,sha256:'c'.repeat(64)},outsider)
 } finally {await db.close()}
})
test('verification is idempotent, actor-bound and direct attachment/RPC/table bypass is denied',async()=>{
 const {db}=await setup();try{
  const row=(await start(db,'opening')).submission,requestId=uuid(300)
  const p=await photo(db,row,'d'.repeat(64),undefined,requestId)
  await assert.rejects(api(db,'upload_finish',{...p.body,upload_id:p.intent.upload_id}),/verification required/)
  const once=await p.finish(),twice=await p.finish();assert.equal(once.attachment.id,twice.attachment.id)
  const repeated=await api(db,'upload_begin',p.body);assert.equal(repeated.upload_id,requestId);assert.equal(repeated.registered,true)
  // Completed verification retries remain idempotent even after the new-upload quota is reached.
  await root(db,`insert into checklist_private.upload_intents(id,submission_id,object_path,kind,item_id,actor_user,expires_at,created_at) select gen_random_uuid(),$1::uuid,$1::uuid::text||'/'||n::text||'.png','photo','opening-1',$2::uuid,now()-interval '1 day',now()-interval '1 day' from generate_series(1,199) n`,[row.id,store])
  assert.equal((await api(db,'upload_begin',p.body)).registered,true)

  await assert.rejects(api(db,'upload_finish',{...p.body,upload_id:requestId,sha256:'e'.repeat(64)}),/mismatch/)
  const stored=(await root(db,'select count(*)::int n from public.checklist_attachments where submission_id=$1',[row.id]))[0];assert.equal(stored.n,1)
  await actor(db,store)
  await assert.rejects(db.query('select * from checklist_private.photo_fingerprints'),/permission denied/)
  await assert.rejects(db.query("select public.checklist_photo_history('report')"),/permission denied/)
  const raw=uuid(301),path=`${row.id}/${raw}.png`
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[path])
  await actor(db,store)
  await assert.rejects(db.query('select public.attach_checklist_evidence($1,$2,$3,$4,$5)',[row.id,raw,row.template_snapshot.definition[0].id,'photo',path]),/verification required/)
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_fingerprints'))[0].n,1)
 }finally{await db.close()}
})
test('prospective PM replacement retains original snapshots, all other items and audit definitions',async()=>{
 const {db}=await setup({integrity:false});try{
  const old=(await start(db,'weekly_pm')).submission
  const audits=await root(db,"select key,definition,version from public.checklist_templates where key in ('monthly_site_assessment','quarterly_safety_audit') order by key")
  await db.exec('reset role');await db.exec(integritySql)
  await activate(db);await db.exec('reset role');await db.exec(pmSql)
  const previousWeek=(await root(db,'select ($1::date-7)::text d',[old.period_date]))[0].d
  const current=(await api(db,'start',{location_id:site,template_key:'weekly_pm',period_date:previousWeek},other)).submission
  const oldItems=old.template_snapshot.definition,newItems=current.template_snapshot.definition
  assert.equal(oldItems.length,80);assert.equal(newItems.length,81)
  assert.deepEqual(newItems,weeklyPmTemplate.definition)
  assert.deepEqual(newItems.filter(i=>!i.id.includes('-trap-door')),oldItems.filter(i=>i.id!=='weekly-pm-conveyer-10'))
  for(const item of newItems.filter(i=>i.id.includes('-trap-door'))) {
   assert.equal(item.critical,true);assert.equal(item.photo_required,true);assert.equal(item.section,'Tunnel Equipment');assert.match(item.text,/condition.*bolts are tight/)
   assert.equal(item.instruction,'Photo must clearly show the inspected components with the grate(s) removed.')
  }
  assert.deepEqual((await api(db,'read',{id:old.id})).submission.template_snapshot,old.template_snapshot)
  assert.deepEqual(await root(db,"select key,definition,version from public.checklist_templates where key in ('monthly_site_assessment','quarterly_safety_audit') order by key"),audits)
  // Incomplete drafts save; final requires each separate photo before ordinary signatures/answers pass.
  let saved=await api(db,'save',{id:current.id,revision:current.revision,answers:{},manager_name:'',submit:false},other)
  const r=saved.submission
  await assert.rejects(api(db,'save',{id:r.id,revision:r.revision,answers:allAnswers(r),manager_name:'Auditor',submit:true},other),/Required|Photo|signature/)
 }finally{await db.close()}
})
test('history hashing resumes and reports inaccessible objects without blocking staging uploads',async()=>{
 const {db}=await setup({integrity:false});try{
  const row=(await start(db,'opening')).submission
  const legacy=await upload(db,row,row.template_snapshot.definition[0].id,'photo')
  await db.exec('reset role');await db.exec(integritySql)
  const extra=await api(db,'upload_begin',{id:row.id,item_id:legacy.item_id,kind:'photo',extension:'png'})
  assert.ok(extra.upload_id)
  await root(db,"update checklist_private.upload_intents set expires_at=now()-interval '1 second' where id=$1",[extra.upload_id])
  await db.exec('reset role;set role service_role')
  let batch=(await db.query("select public.checklist_photo_history('batch') r")).rows[0].r
  assert.equal(batch.objects.length,1)
  await db.query("select public.checklist_photo_history('record',$1)",[JSON.stringify({attachment_id:legacy.id,error_code:'download_failed'})])
  let report=(await db.query("select public.checklist_photo_history('report') r")).rows[0].r
  assert.equal(report.inaccessible[0].attachment_id,legacy.id)
  await db.query("select public.checklist_photo_history('record',$1)",[JSON.stringify({attachment_id:legacy.id,sha256:'f'.repeat(64)})])
  await db.query("select public.checklist_photo_history('record',$1)",[JSON.stringify({attachment_id:legacy.id,sha256:'f'.repeat(64)})])
  assert.deepEqual((await api(db,'read',{id:row.id})).evidence.map(e=>e.id),[legacy.id])
  await activate(db)
  const otherRow=(await start(db,'closing')).submission
  await assert.rejects((await photo(db,otherRow,'f'.repeat(64))).finish,/already used/)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_attachments'))[0].n,1)
 }finally{await db.close()}
})
test('required photos, saved draft continuation, correction retention and QR revocation remain enforced',async()=>{
 const {db}=await setup();try{
  await configure(db)
  const r=(await start(db,'weekly_pm')).submission
  await ready(db,r)
  const submitted=(await saveNew(db,r,true)).submission
  const correction=(await api(db,'begin_edit',{id:r.id,revision:submitted.revision})).submission
  for(const item of correction.template_snapshot.definition.filter(i=>i.signature_required)) await upload(db,correction,item.id,'signature')
  await upload(db,correction,null,'signature')
  const applied=await saveNew(db,correction,true)
  assert.equal(applied.submission.template_snapshot.version,r.template_snapshot.version)
  assert.equal(applied.evidence.filter(e=>e.kind==='photo').length,2)
  const history=await api(db,'history',{id:r.id});assert.ok(history.versions.length>=2)
  const qr=(await guest(db,'start',{template_key:'opening'})).submission
  await assert.rejects(guest(db,'start',{template_key:'monthly_site_assessment'}),/Authenticated/)
  await api(db,'qr_revoke',{location_id:site,expected_generation:1},admin)
  await assert.rejects(guest(db,'upload_begin',{id:qr.id,item_id:'opening-1',kind:'photo',extension:'png'}),/expired or revoked/)
 }finally{await db.close()}
})
test('concurrent contenders leave exactly one claim and one attachment (PGlite serializes connections)',async()=>{
 const {db}=await setup();try{
  const a=(await start(db,'opening')).submission,b=(await start(db,'closing')).submission
  const pa=await photo(db,a),pb=await photo(db,b)
  const results=await Promise.allSettled([pa.finish(),pb.finish()])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_claims'))[0].n,1)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_attachments'))[0].n,1)
 }finally{await db.close()}
})
test('server requires each new PM photo before final submit but allows incomplete draft continuation',async()=>{
 const {db}=await setup();try{
  let row=(await start(db,'weekly_pm')).submission
  row=(await api(db,'save',{id:row.id,revision:row.revision,answers:{},manager_name:'',submit:false})).submission
  for(const i of row.template_snapshot.definition.filter(i=>i.signature_required))await upload(db,row,i.id,'signature')
  await upload(db,row,null,'signature')
  const photos=row.template_snapshot.definition.filter(i=>i.photo_required)
  assert.equal(photos.length,2)
  await assert.rejects(saveNew(db,row,true),/Photo required: Remove the front/)
  await (await photo(db,row,'1'.repeat(64),photos[0].id)).finish()
  await assert.rejects(saveNew(db,row,true),/Photo required: Remove the last two/)
  await (await photo(db,row,'2'.repeat(64),photos[1].id)).finish()
  const done=await saveNew(db,row,true);assert.equal(done.submission.status,'submitted')
  assert.deepEqual(done.submission.template_snapshot,row.template_snapshot)
 }finally{await db.close()}
})
test('authorized deletion of an unhashed legacy draft attachment does not leave an impossible history gate',async()=>{
 const {db}=await setup({integrity:false});try{
  const row=(await start(db,'opening')).submission
  const old=await upload(db,row,'opening-1','photo')
  await db.exec('reset role');await db.exec(integritySql)
  await root(db,'delete from public.checklist_attachments where id=$1',[old.id])
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_fingerprints'))[0].n,0)
  await api(db,'upload_begin',{id:row.id,item_id:'opening-1',kind:'photo',extension:'png'})
 }finally{await db.close()}
})
test('migration leaves completed records, draft snapshots, original versions and legacy duplicate evidence intact',async()=>{
 const {db}=await setup({integrity:false});try{
  const draft=(await start(db,'weekly_pm')).submission,completed=(await start(db,'midday')).submission
  await ready(db,completed);await saveNew(db,completed,true)
  const opening=(await start(db,'opening')).submission,closing=(await start(db,'closing')).submission
  const a=await upload(db,opening,'opening-1','photo'),b=await upload(db,closing,'closing-19','photo')
  const before=await root(db,'select to_jsonb(s) row from public.checklist_submissions s order by id')
  const versions=await root(db,'select to_jsonb(v) row from checklist_private.versions v order by submission_id,revision')
  await db.exec('reset role');await db.exec(integritySql)
  assert.deepEqual(await root(db,'select to_jsonb(s) row from public.checklist_submissions s order by id'),before)
  assert.deepEqual(await root(db,'select to_jsonb(v) row from checklist_private.versions v order by submission_id,revision'),versions)
  await db.exec('reset role;set role service_role')
  for(const attachment of [a,b])await db.query("select public.checklist_photo_history('record',$1)",[JSON.stringify({attachment_id:attachment.id,sha256:'e'.repeat(64)})])
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_claims'))[0].n,1)
  assert.equal((await root(db,"select count(*)::int n from checklist_private.photo_fingerprints where state='verified'"))[0].n,2)
  assert.equal((await api(db,'read',{id:draft.id})).submission.template_snapshot.version,draft.template_snapshot.version)
 }finally{await db.close()}
})
test('guest photo verification rechecks grant generation and excludes both audits at every access surface',async()=>{
 const {db}=await setup();try{
  await configure(db)
  const row=(await guest(db,'start',{template_key:'opening'})).submission
  const body={id:row.id,item_id:'opening-1',kind:'photo',extension:'png'}
  const u=await guest(db,'upload_begin',body)
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[u.object_path])
  await api(db,'qr_rotate',{location_id:site,expected_generation:1,token_hash:'b'.repeat(64)},admin)
  await assert.rejects(guest(db,'upload_finish',{id:row.id,upload_id:u.upload_id,sha256:'d'.repeat(64)}),/expired or revoked/)
  assert.equal((await root(db,'select count(*)::int n from checklist_private.photo_claims'))[0].n,0)
  for(const key of ['monthly_site_assessment','quarterly_safety_audit']){
   const audit=(await start(db,key)).submission
   for(const action of ['read','history','download','begin_edit','upload_begin','upload_finish'])await assert.rejects(guest(db,action,{id:audit.id,template_key:key},'b'.repeat(64)),/access unavailable/)
  }
 }finally{await db.close()}
})
