// Isolated in-memory PostgreSQL with fictional profiles/storage metadata only. Never contacts Supabase.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { checklistTemplates } from '../../app/src/utils/checklistTemplates.js'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration = readFileSync(new URL('../../app/supabase/migrations/20261105173034_manager_checklists_pilot.sql', import.meta.url), 'utf8')
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const admin=uuid(1),store=uuid(2),other=uuid(3),outsider=uuid(4),inactive=uuid(5),deleted=uuid(6),manager=uuid(7),site=uuid(10),away=uuid(11)
async function actor(db,id=admin,role='authenticated') { await db.exec(`reset role;set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']) }
async function root(db,sql,args=[]) { await db.exec('reset role');const result=await db.query(sql,args);await db.exec('set role authenticated');return result.rows }
async function setup() {
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz,name text);
 create table public.locations(id uuid primary key,site_code text,timezone text);
 create table public.manager_locations(manager_id uuid,location_id uuid);
 create table public.edit_audit_log(id uuid default gen_random_uuid(),table_name text,location_id uuid not null,period date,changed_by uuid,changed_by_name text,summary text,old_values jsonb,new_values jsonb);
 create table public.actuals(id integer primary key,value numeric);insert into public.actuals values(1,123.456);
 create table public.budget_targets(id integer primary key,goal numeric);insert into public.budget_targets values(1,987.654);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant all on storage.objects to anon,authenticated;
 -- Deliberately broad existing policies: new bucket restrictions must still deny unauthorized operations.
 create policy preexisting_permissive on storage.objects for all to anon,authenticated using(true) with check(true);
 insert into storage.buckets values('unrelated','unrelated',false,null,null);
 insert into storage.objects(bucket_id,name) values('unrelated','untouched.png');
 insert into public.locations values('${site}','1000-Fictional','America/Los_Angeles'),('${away}','1001-Fictional','America/New_York');
 insert into public.user_profiles values('${admin}','admin',null,true,null,'Test Admin'),('${store}','store','${site}',true,null,'Test Store'),('${other}','store','${site}',true,null,'Other Store'),('${outsider}','store','${away}',true,null,'Outside Store'),('${inactive}','store','${site}',false,null,'Inactive'),('${deleted}','store','${site}',true,now(),'Deleted'),('${manager}','area_manager',null,true,null,'Legacy Manager');
 insert into public.manager_locations values('${manager}','${site}');
 `)
 await db.exec(`alter default privileges grant all on schemas to authenticated;alter default privileges grant all on tables to anon,authenticated;alter default privileges grant execute on functions to anon,authenticated;`)
 await db.exec(migration)
 const today=(await db.query(`select (now() at time zone 'America/Los_Angeles')::date::text as d`)).rows[0].d
 await db.exec(`insert into public.checklist_pilot_access(location_id,user_id,enabled_from) values('${site}','${store}',date '${today}'-40);`)
 await actor(db,store)
 return {db,today}
}
async function save(db,row,answers=row?.answers||{},submit=false,name='Test Manager',date,template='midday') {
 return (await db.query('select to_jsonb(public.save_checklist($1,$2,$3,$4,$5,$6::jsonb,$7,$8)) as s',
 [row?.template_key||template,row?.location_id||site,row?.period_date||date,row?.id||null,row?.revision||null,JSON.stringify(answers),name,submit])).rows[0].s
}
function answers(row) { return Object.fromEntries(row.template_snapshot.definition.map(item=>[item.id,{value:item.options[0]}])) }
let sequence=100
async function evidence(db,row,item=null,kind='signature') {
 const file=uuid(sequence++),path=`${row.id}/${file}.png`
 await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['manager-checklist-evidence',path,JSON.stringify({mimetype:'image/png',size:100})])
 return (await db.query('select to_jsonb(public.attach_checklist_evidence($1,$2,$3,$4,$5)) as a',[row.id,file,item,kind,path])).rows[0].a
}
async function ready(db,row) {
 for(const item of row.template_snapshot.definition.filter(i=>i.photo_required)) await evidence(db,row,item.id,'photo')
 await evidence(db,row)
 return answers(row)
}

test('migration seeds exactly approved templates; leaves operational data unchanged; closes all new write paths',async()=>{
 const {db}=await setup();try{
  const rows=await root(db,'select key,name,cadence,definition from public.checklist_templates order by key')
  assert.deepEqual(rows,structuredClone(checklistTemplates).sort((a,b)=>a.key.localeCompare(b.key)))
  assert.deepEqual((await root(db,'select * from public.actuals'))[0],{id:1,value:'123.456'})
  assert.deepEqual((await root(db,'select * from public.budget_targets'))[0],{id:1,goal:'987.654'})
  assert.equal((await root(db,"select count(*)::int n from public.checklist_pilot_access"))[0].n,1)
  const acl=await root(db,"select relname,relrowsecurity,has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE') writes from pg_class where relname in ('checklist_templates','checklist_pilot_access','checklist_submissions','checklist_attachments')")
  assert.equal((await root(db,"select has_schema_privilege('authenticated','checklist_private','CREATE') allowed"))[0].allowed,false)
  assert.equal(acl.length,4);assert.ok(acl.every(t=>t.relrowsecurity&&!t.writes))
  const fns=await root(db,"select p.proname,p.proconfig,pg_get_userbyid(proowner) owner,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='checklist_private' or p.proname in ('save_checklist','attach_checklist_evidence','configure_checklist_pilot'))")
  assert.ok(fns.every(f=>f.owner==='postgres'&&!f.anon&&f.proconfig.includes('search_path=\"\"')))
 }finally{await db.close()}
})
test('pilot authorization: direct URL/API, own-site, same-site nonpilot, assigned manager, inactive/deleted and anonymous',async()=>{
 const {db,today}=await setup();try{
  const row=await save(db,null,{},false,'',today)
  for(const id of [other,outsider,inactive,deleted,'']){
   await actor(db,id)
   assert.equal((await db.query('select * from public.checklist_templates')).rows.length,0)
   assert.equal((await db.query('select * from public.checklist_submissions')).rows.length,0)
   await assert.rejects(save(db,null,{},false,'',today),/pilot access/)
  }
  await actor(db,admin)
  await db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify({location_id:site,user_id:manager,is_active:true})])
  await actor(db,manager)
  assert.equal((await db.query('select * from public.checklist_templates')).rows.length,4)
  assert.equal((await db.query('select * from public.checklist_submissions')).rows.length,0) // Cannot read another manager's answers.
  assert.equal((await save(db,null,{},false,'',today,'opening')).status,'draft')
  await assert.rejects(save(db,row,{},false),/owner/)
  await actor(db,'','anon');await assert.rejects(save(db,null,{},false,'',today),/permission denied/)
  await assert.rejects(db.query('select * from public.checklist_templates'),/permission denied/)
 }finally{await db.close()}
})
test('Admin controls pilot access without expanding assignments; stale grant changes and audit failures roll back',async()=>{
 const {db}=await setup();try{
  const payload={location_id:site,user_id:outsider,is_active:true}
  await assert.rejects(db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify(payload)]),/Admin/)
  await actor(db,admin);await assert.rejects(db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify(payload)]),/assignments/)
  const grant=(await db.query('select * from public.checklist_pilot_access')).rows[0]
  await assert.rejects(db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify({...grant,updated_at:null,is_active:false})]),/changed/)
  await root(db,'alter table public.edit_audit_log add constraint audit_reject check(false)')
  await assert.rejects(db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify({...grant,is_active:false})]),/audit_reject/)
  assert.equal((await db.query('select is_active from public.checklist_pilot_access')).rows[0].is_active,true)
 }finally{await db.close()}
})
test('draft save/resume, conflicts, duplicates, required answers, single selection, failure explanations and signature',async()=>{
 const {db,today}=await setup();try{
  let row=await save(db,null,{},false,'',today)
  const partial={'midday-1':{value:'No'}}
  row=await save(db,row,partial,false,'')
  assert.deepEqual((await db.query('select answers from public.checklist_submissions')).rows[0].answers,partial)
  await assert.rejects(save(db,{...row,revision:row.revision-1},partial),/changed elsewhere/)
  await assert.rejects(save(db,null,{},false,'',today),/unique/)
  await assert.rejects(save(db,row,partial,true),/Explanation required/)
  await assert.rejects(save(db,row,{'midday-5':{value:['Empty','Half full']}},true),/Required response|Invalid answer/)
  const all=answers(row);all['midday-1']={value:'No',explanation:'Cleared debris.'};all['midday-5']={value:'Overflowing/needs to be emptied'}
  await assert.rejects(save(db,row,all,true),/Explanation required/)
  all['midday-5'].explanation='Emptied bin.'
  await assert.rejects(save(db,row,all,true),/signature/)
  await evidence(db,row)
  await assert.rejects(save(db,row,all,true,''),/full name/)
  row=await save(db,row,all,true)
  assert.equal(row.status,'submitted');assert.ok(row.submitted_at);assert.equal(row.is_pilot,true)
  assert.equal((await root(db,"select count(*)::int n from public.edit_audit_log where table_name='checklist_submissions'"))[0].n,1)
 }finally{await db.close()}
})
test('four daily and two Monday photos enforced; N/A reasons, original choices, no extra critical failure blocking',async()=>{
 const {db,today}=await setup();try{
  for(const key of ['opening','closing','weekly']) {
   const date=key==='weekly'?(await db.query("select date_trunc('week',$1::date)::date::text d",[today])).rows[0].d:today
   const row=await save(db,null,{},false,'',date,key), all=answers(row)
   await evidence(db,row)
   await assert.rejects(save(db,row,all,true),/Photo required/)
   for(const item of row.template_snapshot.definition.filter(i=>i.photo_required))await evidence(db,row,item.id,'photo')
   const conditional=row.template_snapshot.definition.find(i=>i.na_allowed)
   if(conditional){all[conditional.id]={value:'N/A'};await assert.rejects(save(db,row,all,true),/Explanation required/);all[conditional.id].explanation='Not applicable at this site today.'}
   const nonconditional=row.template_snapshot.definition.find(i=>!i.na_allowed)
   await assert.rejects(save(db,row,{...all,[nonconditional.id]:{value:'N/A',explanation:'Not allowed'}},true),/Invalid answer/)
   const failure=row.template_snapshot.definition.find(i=>i.critical)
   if(failure)all[failure.id]={value:failure.failure_values[0],explanation:'Unable to complete; issue recorded.'}
   assert.equal((await save(db,row,all,true)).status,'submitted')
  }
 }finally{await db.close()}
})
test('private evidence: uploads/links scoped; append-only after submit even with broad preexisting Storage policies',async()=>{
 const {db,today}=await setup();try{
  const row=await save(db,null,{},false,'',today),file=await evidence(db,row)
  assert.equal((await db.query("select * from storage.objects where bucket_id='manager-checklist-evidence'")).rows.length,1)
  await actor(db,other)
  assert.equal((await db.query('select * from public.checklist_attachments')).rows.length,0)
  assert.equal((await db.query("select * from storage.objects where bucket_id='manager-checklist-evidence'")).rows.length,0)
  await assert.rejects(evidence(db,row),/row-level security/)
  await actor(db,store)
  await save(db,row,answers(row),true)
  await assert.rejects(save(db,{...row,revision:2},answers(row),false),/immutable/)
  await assert.rejects(evidence(db,row),/row-level security/)
  assert.equal((await db.query("delete from storage.objects where name=$1 returning *",[file.object_path])).rows.length,0)
  assert.equal((await db.query("update storage.objects set name='replaced.png' where name=$1 returning *",[file.object_path])).rows.length,0)
  await assert.rejects(db.query('update public.checklist_submissions set answers=\'{}\' where id=$1',[row.id]),/permission denied/)
  await actor(db,'','anon');assert.equal((await db.query("select * from storage.objects where bucket_id='manager-checklist-evidence'")).rows.length,0)
  assert.equal((await db.query("select * from storage.objects where bucket_id='unrelated'")).rows.length,1)
  await actor(db,admin);assert.equal((await db.query('select * from public.checklist_attachments')).rows.length,1)
 }finally{await db.close()}
})
test('template edits are Admin-only and optimistic; snapshots fixed; configurable conditional evidence enforced',async()=>{
 const {db,today}=await setup();try{
  const old=await save(db,null,{},false,'',today)
  const template=(await db.query("select * from public.checklist_templates where key='midday'")).rows[0]
  await assert.rejects(db.query("select public.configure_checklist_pilot('template',$1::jsonb)",[JSON.stringify(template)]),/Admin/)
  await actor(db,admin)
  const edited=structuredClone(template);edited.definition[0].text='Edited inspection question';edited.definition[0].photo_on_failure=true;edited.definition[0].explanation_required=true
  await db.query("select public.configure_checklist_pilot('template',$1::jsonb)",[JSON.stringify(edited)])
  await assert.rejects(db.query("select public.configure_checklist_pilot('template',$1::jsonb)",[JSON.stringify(edited)]),/Template changed/)
  const current=(await db.query("select * from public.checklist_templates where key='midday'")).rows[0]
  const broken=structuredClone(current);broken.definition[0].critical=true
  await assert.rejects(db.query("select public.configure_checklist_pilot('template',$1::jsonb)",[JSON.stringify(broken)]),/Invalid template/)
  const nullPhoto=structuredClone(current);delete nullPhoto.definition[0].photo_required
  await assert.rejects(db.query("select public.configure_checklist_pilot('template',$1::jsonb)",[JSON.stringify(nullPhoto)]),/Invalid template/)
  assert.equal((await db.query('select template_snapshot from public.checklist_submissions where id=$1',[old.id])).rows[0].template_snapshot.version,1)
  await actor(db,store)
  const yesterday=(await db.query('select ($1::date-1)::text d',[today])).rows[0].d
  const fresh=await save(db,null,{},false,'',yesterday)
  assert.equal(fresh.template_snapshot.version,2)
  const all=await ready(db,fresh)
  await assert.rejects(save(db,fresh,all,true),/Explanation required/)
  all['midday-1']={value:'No',explanation:'Issue found.'};await assert.rejects(save(db,fresh,all,true),/Photo required/)
  await evidence(db,fresh,'midday-1','photo');assert.equal((await save(db,fresh,all,true)).status,'submitted')
 }finally{await db.close()}
})
test('atomic finalization and audit rollback, no automatic retry, uploaded draft evidence stays resumable',async()=>{
 const {db,today}=await setup();try{
  const row=await save(db,null,{},false,'',today),all=await ready(db,row)
  await root(db,'alter table public.edit_audit_log add constraint reject_submission check(false)')
  await assert.rejects(save(db,row,all,true),/reject_submission/)
  const saved=(await db.query('select * from public.checklist_submissions')).rows[0]
  assert.equal(saved.status,'draft');assert.equal(saved.revision,1);assert.equal(saved.submitted_at,null)
  assert.equal((await db.query('select * from public.checklist_attachments')).rows.length,1)
  assert.deepEqual(saved.answers,{})
 }finally{await db.close()}
})
test('site-local dates, Monday week keys, future dates, enrollment starts and access revocation',async()=>{
 const {db,today}=await setup();try{
  const future=(await db.query('select ($1::date+1)::text d',[today])).rows[0].d
  await assert.rejects(save(db,null,{},false,'',future),/business date/)
  const tuesday='2024-02-27';await assert.rejects(save(db,null,{},false,'',tuesday,'weekly'),/pilot access|business date/)
  await actor(db,admin);await assert.rejects(save(db,null,{},false,'',tuesday,'weekly'),/business date/)
  const row=await save(db,null,{},false,'',today)
  await actor(db,store)
  const grant=(await root(db,'select * from public.checklist_pilot_access'))[0]
  await actor(db,admin);await db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify({...grant,is_active:false})])
  await actor(db,store);assert.equal((await db.query('select * from public.checklist_templates')).rows.length,0)
  await assert.rejects(save(db,row,{},false),/pilot access/)
 }finally{await db.close()}
})

test('application-first rollback contains no executable SQL and preserves all pilot/operational data',async()=>{
 const {db,today}=await setup();try{
  const row=await save(db,null,{},false,'',today);await evidence(db,row)
  const rollback=readFileSync(new URL('../../docs/sql/checklists-pilot-ROLLBACK-REVIEW-ONLY.sql',import.meta.url),'utf8')
  assert.equal(rollback.replace(/--[^\n]*/g,'').trim(),'')
  assert.match(rollback,/Revert the checklist application release/)
  assert.match(rollback,/NOT uploaded photo\/signature contents/)
  const snapshot=async()=>JSON.stringify((await root(db,`select jsonb_build_object(
   'submissions',(select jsonb_agg(to_jsonb(s)) from public.checklist_submissions s),
   'files',(select jsonb_agg(to_jsonb(a)) from public.checklist_attachments a),
   'grants',(select jsonb_agg(to_jsonb(g)) from public.checklist_pilot_access g),
   'objects',(select jsonb_agg(to_jsonb(o)) from storage.objects o),
   'templates',(select jsonb_agg(to_jsonb(t)) from public.checklist_templates t),
   'audit',(select jsonb_agg(to_jsonb(a)) from public.edit_audit_log a),
   'actuals',(select jsonb_agg(to_jsonb(a)) from public.actuals a),
   'targets',(select jsonb_agg(to_jsonb(t)) from public.budget_targets t)
  ) as state`))[0].state)
  const before=await snapshot();await db.exec(rollback);assert.equal(await snapshot(),before)
 }finally{await db.close()}
})

test('prepared read-only metadata/verification SQL compiles and bucket configuration is private and bounded',async()=>{
 const {db}=await setup();try{
  await db.exec('reset role')
  for(const file of ['checklists-pilot-PREFLIGHT-READ-ONLY.sql','checklists-pilot-VERIFY-READ-ONLY.sql'])await db.exec(readFileSync(new URL('../../docs/sql/'+file,import.meta.url),'utf8'))
  const bucket=(await db.query("select public,file_size_limit::text,allowed_mime_types from storage.buckets where id='manager-checklist-evidence'")).rows[0]
  assert.deepEqual(bucket,{public:false,file_size_limit:'10485760',allowed_mime_types:['image/jpeg','image/png','image/webp']})
  await actor(db,store)
  await assert.rejects(db.query('select checklist_private.assigned($1,$2)',[site,admin]),/permission denied/)
  // New bucket guards must not change any existing-bucket read/write behavior, including legacy null bucket rows.
  await db.exec("insert into storage.objects(bucket_id,name) values(null,'legacy-null.png');")
  assert.equal((await db.query("select * from storage.objects where name='legacy-null.png'")).rows.length,1)
  await db.exec("insert into storage.objects(bucket_id,name) values('unrelated','new.png');update storage.objects set name='edited.png' where name='new.png';delete from storage.objects where name='edited.png';")
 }finally{await db.close()}
})

test('deactivated/deleted pilot users lose access while history survives; historical actors block hard deletion',async()=>{
 const {db,today}=await setup();try{
  const row=await save(db,null,{},false,'',today)
  await root(db,'update public.user_profiles set deleted_at=now(),is_active=false where id=$1',[store])
  assert.equal((await db.query('select * from public.checklist_submissions')).rows.length,0)
  await assert.rejects(save(db,row),/pilot access/)
  await db.exec('reset role')
  assert.equal((await db.query('select created_by from public.checklist_submissions where id=$1',[row.id])).rows[0].created_by,store)
  await assert.rejects(db.query('delete from public.user_profiles where id=$1',[store]),/foreign key/)
  // Access configuration alone must not block deletion of an otherwise unreferenced account.
  await db.query('insert into public.checklist_pilot_access(location_id,user_id,enabled_from) values($1,$2,$3)',[site,other,today])
  await db.query('delete from public.user_profiles where id=$1',[other])
  assert.equal((await db.query('select * from public.checklist_pilot_access where user_id=$1',[other])).rows.length,0)
 }finally{await db.close()}
})

test('fresh photo/signature reads honor revocation, active/deleted accounts, location changes and Admin access',async()=>{
 const {db,today}=await setup();try{
  const row=await save(db,null,{},false,'',today,'opening')
  await evidence(db,row,'opening-6','photo');await evidence(db,row)
  const reads=async()=>({
   attachments:(await db.query('select id from public.checklist_attachments where submission_id=$1',[row.id])).rows.length,
   objects:(await db.query("select name from storage.objects where bucket_id='manager-checklist-evidence'")).rows.length,
  })
  assert.deepEqual(await reads(),{attachments:2,objects:2})
  for(const change of [
   `update public.checklist_pilot_access set is_active=false where user_id='${store}'`,
   `update public.user_profiles set is_active=false where id='${store}'`,
   `update public.user_profiles set deleted_at=now() where id='${store}'`,
   `update public.user_profiles set location_id='${away}' where id='${store}'`,
  ]){
   await root(db,change);assert.deepEqual(await reads(),{attachments:0,objects:0})
   await root(db,'update public.checklist_pilot_access set is_active=true')
   await root(db,`update public.user_profiles set is_active=true,deleted_at=null,location_id='${site}' where id='${store}'`)
   assert.deepEqual(await reads(),{attachments:2,objects:2})
  }
  for(const account of [other,outsider,inactive,deleted]){
   await actor(db,account);assert.deepEqual(await reads(),{attachments:0,objects:0})
  }
  await actor(db,admin);assert.deepEqual(await reads(),{attachments:2,objects:2})
  for(const change of [`is_active=false`,`is_active=true,deleted_at=now()`]){
   await root(db,`update public.user_profiles set ${change} where id='${admin}'`)
   assert.deepEqual(await reads(),{attachments:0,objects:0})
  }
  await root(db,`update public.user_profiles set is_active=true,deleted_at=null where id='${admin}'`)
  assert.deepEqual(await reads(),{attachments:2,objects:2})
  assert.equal((await root(db,'select count(*)::int n from public.checklist_submissions'))[0].n,1)
 }finally{await db.close()}
})

const discardMigration = readFileSync(new URL('../../app/supabase/migrations/20261105212313_checklist_discard_draft.sql', import.meta.url), 'utf8')
async function discardSetup() {
 const fixture=await setup()
 await fixture.db.exec('reset role');await fixture.db.exec(discardMigration);await actor(fixture.db,store)
 return fixture
}
async function freeze(db,row) { return db.query('select public.begin_discard_checklist($1,$2) as s',[row.id,row.revision]) }
async function finishDiscard(db,row) { return db.query('select public.finish_discard_checklist($1)',[row.id]) }

test('discard authorization: owner pilot or active Admin only; submitted rows and other sites protected',async()=>{
 const {db,today}=await discardSetup();try{
  const row=await save(db,null,{},false,'',today)
  for(const id of [other,outsider,inactive,deleted,manager,'']){
   await actor(db,id);await assert.rejects(freeze(db,row),/Authorized draft access/)
  }
  await actor(db,'','anon');await assert.rejects(freeze(db,row),/permission denied/)
  await actor(db,store)
  await assert.rejects(finishDiscard(db,row),/frozen/)
  await root(db,'update public.user_profiles set is_active=false where id=$1',[store])
  await assert.rejects(freeze(db,row),/Authorized draft access/)
  await root(db,'update public.user_profiles set is_active=true,deleted_at=now() where id=$1',[store])
  await assert.rejects(freeze(db,row),/Authorized draft access/)
  await root(db,'update public.user_profiles set deleted_at=null where id=$1',[store])
  await root(db,'update public.checklist_pilot_access set is_active=false')
  await assert.rejects(freeze(db,row),/Authorized draft access/)
  await actor(db,admin);await freeze(db,row);await finishDiscard(db,row)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_submissions'))[0].n,0)
  // Active Admin already has companywide checklist review; inactive/deleted Admin does not.
  await actor(db,admin);let submitted=await save(db,null,{},false,'',today)
  submitted=await save(db,submitted,await ready(db,submitted),true)
  await assert.rejects(freeze(db,submitted),/Submitted checklists/)
  await assert.rejects(finishDiscard(db,submitted),/frozen/)
  await root(db,"update public.user_profiles set is_active=false where id=$1",[admin])
  await assert.rejects(freeze(db,submitted),/Authorized draft access/)
  await root(db,"update public.user_profiles set is_active=true,deleted_at=now() where id=$1",[admin])
  await assert.rejects(freeze(db,submitted),/Authorized draft access/)
 }finally{await db.close()}
})

test('discard freezes writes, catches unregistered evidence and late privileged upload completion, and removes only its draft',async()=>{
 const {db,today}=await discardSetup();try{
  const row=await save(db,null,{},false,'Owner',today)
  await evidence(db,row)
  const late=uuid(801),unregistered=`${row.id}/${uuid(802)}.png`
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['manager-checklist-evidence',unregistered])
  await actor(db,admin);const otherRow=await save(db,null,{},false,'Admin',today,'opening');await evidence(db,otherRow)
  await actor(db,store);await freeze(db,row)
  await assert.rejects(save(db,row,{},false),/immutable/)
  await assert.rejects(save(db,row,{},true),/immutable/)
  await assert.rejects(save(db,null,{},false,'',today),/unique/)
  // Even Storage's privileged completion cannot commit metadata after the freeze.
  await db.exec('reset role')
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['manager-checklist-evidence',`${row.id}/${late}.png`]),/unavailable/)
  assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='manager-checklist-evidence' and name=$1",[`${row.id}/${late}.png`])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int n from public.checklist_attachments where id=$1',[late])).rows[0].n,0)
  await db.query("insert into storage.objects(bucket_id,name) values('unrelated','after-freeze.png')")
  await actor(db,store);await assert.rejects(finishDiscard(db,row),/cleanup is not complete/)
  // Fictional Storage API deletion simulation ONLY; production cleanup must use Storage.remove.
  await root(db,"delete from storage.objects where bucket_id='manager-checklist-evidence' and starts_with(name,$1)",[row.id+'/'])
  await finishDiscard(db,row)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_submissions where id=$1',[row.id]))[0].n,0)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_attachments where submission_id=$1',[row.id]))[0].n,0)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_submissions where id=$1',[otherRow.id]))[0].n,1)
  assert.equal((await root(db,"select count(*)::int n from storage.objects where bucket_id='unrelated'"))[0].n,2)
  assert.equal((await root(db,"select count(*)::int n from public.edit_audit_log where summary='Checklist draft discarded'"))[0].n,1)
  await assert.rejects(save(db,row,{},false),/no rows/)
  await db.exec('reset role');await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['manager-checklist-evidence',`${row.id}/${late}.png`]),/unavailable/)
  assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='manager-checklist-evidence' and starts_with(name,$1)",[row.id+'/'])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int n from public.checklist_attachments where submission_id=$1',[row.id])).rows[0].n,0)
 }finally{await db.close()}
})

test('changed revision stops discard; audit failure preserves frozen records; retries resume and final authorization is rechecked',async()=>{
 const {db,today}=await discardSetup();try{
  const row=await save(db,null,{},false,'',today),newer=await save(db,row,{},false)
  await assert.rejects(freeze(db,row),/changed elsewhere/)
  await freeze(db,newer);await freeze(db,row) // Already-frozen cleanup can resume with the original revision.
  await root(db,'update public.checklist_pilot_access set is_active=false')
  await assert.rejects(finishDiscard(db,row),/Authorized draft access/)
  await root(db,'update public.checklist_pilot_access set is_active=true')
  await root(db,`create function public.fail_discard_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$` )
  await root(db,'create trigger fail_discard_audit before insert on public.edit_audit_log for each row execute function public.fail_discard_audit()')
  await assert.rejects(finishDiscard(db,row),/Audit unavailable/)
  assert.equal((await root(db,'select status from public.checklist_submissions where id=$1',[row.id]))[0].status,'discarding')
  await root(db,'drop trigger fail_discard_audit on public.edit_audit_log')
  await finishDiscard(db,row)
  assert.deepEqual((await root(db,'select * from public.actuals'))[0],{id:1,value:'123.456'})
  assert.deepEqual((await root(db,'select * from public.budget_targets'))[0],{id:1,goal:'987.654'})
 }finally{await db.close()}
})


test('legacy assigned pilot manager may discard only their own draft',async()=>{
 const {db,today}=await discardSetup();try{
  await actor(db,admin)
  await db.query("select public.configure_checklist_pilot('access',$1::jsonb)",[JSON.stringify({location_id:site,user_id:manager,is_active:true})])
  await actor(db,manager);const row=await save(db,null,{},false,'',today)
  await freeze(db,row);await finishDiscard(db,row)
  assert.equal((await root(db,'select count(*)::int n from public.checklist_submissions'))[0].n,0)
 }finally{await db.close()}
})
