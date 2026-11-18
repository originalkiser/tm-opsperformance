// Fictional users only; never contacts production. Minimal existing checklist fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setup, actor, root, api, start, upload, ready, saveNew, configure, guest, allAnswers, uuid, site, away, admin, store } from './helpers/checklistPhotoFixture.mjs'
import { newChecklistQuestion } from '../../app/src/utils/checklistTemplateEditor.js'
import { createHash } from 'node:crypto'
const migration = readFileSync(new URL('../../app/supabase/migrations/20261118145030_super_admin_checklist_editor.sql',import.meta.url),'utf8')
const ordinary = uuid(70), second = uuid(71)
async function fixture() {
 const { db,today } = await setup()
 await db.exec('reset role')
 await db.exec(`alter table public.user_profiles add column email text; alter table public.user_profiles add column settings jsonb default '{}'; grant select,update,delete on public.user_profiles to authenticated; insert into public.user_profiles(id,role,is_active,name) values('${ordinary}','admin',true,'Fictional ordinary Admin'),('${second}','admin',true,'Fictional second Super Admin')`)
 await db.exec(migration)
 return {db,today}
}
async function seed(db) { await root(db,'insert into configuration_private.super_admins(user_id) values($1),($2)',[admin,second]); await actor(db,admin) }
async function editor(db,action,key='midday',state=null,extra={}) {
 const args={p_revision:state?.draft?.revision??0,p_version:state?.published.version??null,p_definition:null,p_note:'Fictional test change',p_restore_version:null,...extra}
 return (await db.query('select public.checklist_template_editor($1,$2,$3,$4,$5::jsonb,$6,$7) result',[action,key,args.p_revision,args.p_version,args.p_definition==null?null:JSON.stringify(args.p_definition),args.p_note,args.p_restore_version])).rows[0].result
}
test('migration grants nobody by default; capability, drafts/history and all legacy writes fail closed',async()=>{
 const {db}=await fixture();try{
  assert.equal((await root(db,'select count(*)::integer n from configuration_private.super_admins'))[0].n,0)
  for(const id of [admin,ordinary,store,'']) {
   await actor(db,id)
   assert.equal((await db.query('select public.configuration_capabilities() result')).rows[0].result.can_edit_templates,false)
   await assert.rejects(editor(db,'read'),/Super Admin/)
   await assert.rejects(db.query("select public.configure_checklist_pilot('template','{}')"),/Super Admin/)
   await assert.rejects(db.query('select * from configuration_private.super_admins'),/permission denied/)
   await assert.rejects(db.query('insert into configuration_private.super_admins(user_id) values($1)',[id||admin]),/permission denied/)
  }
  await actor(db,'','anon');await assert.rejects(editor(db,'read'),/permission denied/)
  await seed(db)
  assert.equal((await db.query('select public.configuration_capabilities() result')).rows[0].result.can_edit_templates,true)
  await assert.rejects(db.query("select public.configure_checklist_pilot('template','{}')"),/immediate publishing is disabled/)
  for(const table of ['template_drafts','template_versions','template_revisions']) await assert.rejects(db.query(`delete from configuration_private.${table}`),/permission denied/)
  const before=await root(db,'select definition,version from public.checklist_templates order by key')
  assert.equal(before.length,7)
  assert.equal((await root(db,'select count(*)::integer n from configuration_private.template_versions'))[0].n,7)
 }finally{await db.close()}
})
test('ordinary Admin account actions and direct profile mutations cannot take over protected accounts; others remain manageable',async()=>{
 const {db}=await fixture();try{
  await seed(db);await actor(db,ordinary)
  assert.equal((await db.query('select public.authorize_admin_user_action($1) allowed',[store])).rows[0].allowed,true)
  await assert.rejects(db.query('select public.authorize_admin_user_action($1)',[admin]),/Super Admin/)
  for(const patch of ["role='store'","is_active=false","deleted_at=now()","email='fictional@example.invalid'","name='replaced'","settings='{\"role\":\"admin\"}'"]) await assert.rejects(db.query(`update public.user_profiles set ${patch} where id=$1`,[admin]),/Super Admin/)
  await assert.rejects(db.query('delete from public.user_profiles where id=$1',[admin]),/Super Admin/)
  await db.query('update public.user_profiles set is_active=false where id=$1',[store])
  await db.query('update public.user_profiles set is_active=true where id=$1',[store])
  await actor(db,admin)
  assert.equal((await db.query('select public.authorize_admin_user_action($1) allowed',[second])).rows[0].allowed,true)
  await db.query('update public.user_profiles set settings=\'{"dark":true}\' where id=$1',[admin])
  await db.query('update public.user_profiles set is_active=false where id=$1',[second])
  await actor(db,second);await assert.rejects(editor(db,'read'),/Super Admin/)
  await actor(db,admin);await db.query('update public.user_profiles set is_active=true where id=$1',[second])
  await db.exec('reset role;set role service_role')
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  await assert.rejects(db.query('update public.user_profiles set is_active=false where id=$1',[admin]),/permission denied|Super Admin/)
 }finally{await db.close()}
})
test('save/preview/publish/restore are atomic, immutable, audited and conflict checked; old snapshots stay identical',async()=>{
 const {db}=await fixture();try{
  const old=(await start(db)).submission
  await seed(db)
  let state=await editor(db,'read'), original=structuredClone(state.published)
  const stale=structuredClone(state), definition=structuredClone(original.definition)
  definition[0].text='Edited wording';definition[0].section='Renamed section';definition.forEach(i=>i.section='Renamed section')
  definition[0].critical=true;definition[0].photo_min_count=3;definition[0].photo_required=true
  definition.push(newChecklistQuestion('completion','Renamed section',()=> '12345678-1234-4234-8234-123456789012'))
  state=await editor(db,'save','midday',state,{p_definition:definition})
  assert.equal(state.published.version,original.version);assert.equal(state.draft.revision,1)
  const saved=structuredClone(state)
  await actor(db,second);await assert.rejects(editor(db,'save','midday',stale,{p_definition:definition}),/changed elsewhere/)
  await assert.rejects(editor(db,'publish','midday',state),/Preview/)
  await editor(db,'preview','midday',state)
  state=await editor(db,'publish','midday',state)
  assert.equal(state.published.version,original.version+1)
  await assert.rejects(editor(db,'publish','midday',saved),/changed elsewhere/)
  assert.deepEqual((await root(db,'select template_snapshot from public.checklist_submissions where id=$1',[old.id]))[0].template_snapshot,old.template_snapshot)
  state=await editor(db,'restore','midday',state,{p_restore_version:original.version})
  assert.equal(state.published.version,original.version+1)
  const restored=structuredClone(state.draft.definition);restored[0].instruction+=' Reviewed restored draft.'
  state=await editor(db,'save','midday',state,{p_definition:restored})
  await editor(db,'preview','midday',state)
  state=await editor(db,'publish','midday',state)
  assert.equal(state.published.version,original.version+2)
  assert.equal(state.published.definition[0].text,original.definition[0].text)
  assert.equal((await editor(db,'revisions')).revisions.length,5)
  assert.equal((await root(db,'select restored_from from configuration_private.template_versions where template_key=$1 and version=$2',['midday',state.published.version]))[0].restored_from,original.version)
  const versions=await root(db,"select definition from configuration_private.template_versions where template_key='midday' and version=$1",[original.version])
  assert.deepEqual(versions[0].definition,original.definition)
  assert.deepEqual((await root(db,'select * from public.actuals'))[0],{id:1,value:'123.456'})
 }finally{await db.close()}
})
test('schema whitelist protects signatures, cadence, N/A, choices, IDs, conditional follow-ups and upload budget',async()=>{
 const {db}=await fixture();try{
  await seed(db)
  const state=await editor(db,'read'), original=state.published.definition
  for(const mutate of [d=>{d[0].type='text'},d=>{d[0].options=['Fake']},d=>{d[0].na_allowed=true},d=>{d[0].condition={item_id:'fake',value:'Yes'}},d=>{d[0].database_field='role'},d=>{d[0].photo_min_count=11},d=>{d[0].photo_min_count=1.5},d=>{d[0].photo_min_count=-1},d=>{d.pop()},d=>{d[1].id=d[0].id}]) {
   const definition=structuredClone(original);mutate(definition);await assert.rejects(editor(db,'save','midday',state,{p_definition:definition}))
  }
  const audit=await editor(db,'read','quarterly_safety_audit')
  const child=audit.published.definition.findIndex(i=>i.condition)
  if(child>=0) {const bad=structuredClone(audit.published.definition);const [c]=bad.splice(child,1);bad.unshift(c);await assert.rejects(editor(db,'save','quarterly_safety_audit',audit,{p_definition:bad}),/follow-ups|section/)}
  const signature=audit.published.definition.findIndex(i=>i.signature_required)
  if(signature>=0) {const bad=structuredClone(audit.published.definition);bad[signature].signature_required=false;await assert.rejects(editor(db,'save','quarterly_safety_audit',audit,{p_definition:bad}),/Protected/)}
  const heavy=structuredClone(audit.published.definition).map(i=>({...i,photo_min_count:10,photo_required:true}))
  await assert.rejects(editor(db,'save','quarterly_safety_audit',audit,{p_definition:heavy}),/180 uploads/)
 }finally{await db.close()}
})
test('all seven installed templates remain editable; wording-only edits preserve intentional source numbering',async()=>{
 const {db}=await fixture();try{
  await seed(db)
  const templates=await root(db,'select key from public.checklist_templates order by key')
  for(const {key} of templates) {
   const state=await editor(db,'read',key), definition=structuredClone(state.published.definition)
   definition[0].text+=' Reviewed.'
   const updated=await editor(db,'save',key,state,{p_definition:definition})
   assert.deepEqual(updated.draft.definition.map(i=>i.number),definition.map(i=>i.number))
  }
 }finally{await db.close()}
})
test('ten photos are enforced server-side and removed Storage objects cannot satisfy the minimum',async()=>{
 const {db}=await fixture();try{
  await seed(db)
  let state=await editor(db,'read'),definition=structuredClone(state.published.definition)
  definition[0].photo_required=true;definition[0].photo_min_count=10
  state=await editor(db,'save','midday',state,{p_definition:definition})
  await editor(db,'preview','midday',state);await editor(db,'publish','midday',state)
  const row=(await start(db)).submission, files=[]
  await upload(db,row,null,'signature')
  for(let i=0;i<10;i++) files.push(await upload(db,row,definition[0].id,'photo'))
  await root(db,"delete from storage.objects where bucket_id='manager-checklist-evidence' and name=$1",[files[0].object_path])
  await assert.rejects(saveNew(db,row,true),/needs 10, has 9/)
  await upload(db,row,definition[0].id,'photo')
  assert.equal((await saveNew(db,row,true)).submission.status,'submitted')
 }finally{await db.close()}
})
test('server counts valid question photos, preserves legacy booleans and signatures, and retains QR restrictions',async()=>{
 const {db}=await fixture();try{
  const old=(await start(db)).submission
  await seed(db)
  let state=await editor(db,'read'), definition=structuredClone(state.published.definition)
  definition[0].photo_min_count=3;definition[0].photo_required=true
  state=await editor(db,'save','midday',state,{p_definition:definition})
  await editor(db,'preview','midday',state);await editor(db,'publish','midday',state)
  // Existing old draft stays on its boolean rules, without retroactive photos.
  await ready(db,old);await saveNew(db,old,true)
  const row=(await api(db,'start',{location_id:away,template_key:'midday'},admin)).submission
  await upload(db,row,null,'signature',admin)
  await assert.rejects(saveNew(db,row,true,admin),/Photo required|photos missing/)
  await upload(db,row,definition[0].id,'photo',admin)
  await upload(db,row,definition[0].id,'photo',admin)
  await assert.rejects(saveNew(db,row,true,admin),/needs 3, has 2/)
  await upload(db,row,definition[1].id,'photo',admin)
  await assert.rejects(saveNew(db,row,true,admin),/needs 3, has 2/)
  await upload(db,row,definition[0].id,'photo',admin)
  assert.equal((await saveNew(db,row,true,admin)).submission.status,'submitted')
  await configure(db)
  const context=await guest(db,'context',{})
  assert.equal(context.templates.length,5)
  await assert.rejects(guest(db,'start',{template_key:'monthly_site_assessment'}),/Authenticated checklist/)
  await actor(db,ordinary)
  assert.equal((await db.query('select count(*)::integer n from public.checklist_templates')).rows[0].n,7)
  await assert.rejects(db.query('update public.checklist_templates set version=999'),/permission denied/)
 }finally{await db.close()}
})
test('parameterized grant preparation stops on unresolved identities and atomically adds exactly three verified fictional Admin capabilities',async()=>{
 const {db}=await fixture();try{
  await db.exec('reset role')
  await db.exec('create table auth.users(id uuid primary key,email text)')
  const pairs=[[admin,'one@example.invalid'],[second,'two@example.invalid'],[ordinary,'three@example.invalid']]
  for(const [id,email] of pairs) {
   await db.query('insert into auth.users values($1,$2)',[id,email])
   await db.query('update public.user_profiles set email=$2 where id=$1',[id,email])
  }
  const sha=v=>createHash('sha256').update(v).digest('hex')
  const manifest=pairs.map(([id,email])=>({uuid_sha256:sha(id),email_sha256:sha(email)}))
  const grantSql=readFileSync(new URL('../../docs/sql/super-admin-grants-PARAMETERIZED-REVIEW-ONLY.sql',import.meta.url),'utf8')
  await db.query("select set_config('tmops.super_admin_manifest',$1,false)",[JSON.stringify([...manifest.slice(0,2),{...manifest[2],uuid_sha256:'0'.repeat(64)}])])
  await assert.rejects(db.exec(grantSql),/identity is missing|ambiguous/)
  await db.exec('rollback')
  assert.equal((await db.query('select count(*)::integer n from configuration_private.super_admins')).rows[0].n,0)
  await db.query("select set_config('tmops.super_admin_manifest',$1,false)",[JSON.stringify(manifest)])
  await db.exec(grantSql)
  assert.equal((await db.query('select count(*)::integer n from configuration_private.super_admins')).rows[0].n,3)
  await assert.rejects(db.exec(grantSql),/already exist/);await db.exec('rollback')
 }finally{await db.close()}
})
