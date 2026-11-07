// Fictional in-memory PostgreSQL only. No Supabase connection or operational files.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration = readFileSync(new URL('../../app/supabase/migrations/20261106202656_resource_center.sql', import.meta.url), 'utf8')
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const admin=uuid(1),store=uuid(2),inactive=uuid(3),deleted=uuid(4),manager=uuid(5),inactiveAdmin=uuid(6),site=uuid(10)
const info={title:'Fictional manual',category:'Equipment Manuals',brand:'Example Brand',filename:'example.pdf',size:28000000,sha256:'a'.repeat(64)}
async function actor(db,id=admin,role='authenticated'){await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||''])}
async function root(db,sql,args=[]){await db.exec('reset role');try{return (await db.query(sql,args)).rows}finally{await db.exec('set role authenticated')}}
async function rpc(db,action,row,data={}){return (await db.query('select public.manage_resource($1,$2,$3,$4::jsonb) d',[action,row?.id||null,row?.revision??null,JSON.stringify(data)])).rows[0].d}
async function object(db,row,metadata){return db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',['resource-pdfs',row.pending_upload.path,JSON.stringify(metadata||{mimetype:'application/pdf',size:row.pending_upload.size})])}
async function published(db,data=info){const row=await rpc(db,'prepare',null,data);await object(db,row);return rpc(db,'publish',row)}
async function setup(applyCorrection=true){
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz,name text);
 create table public.locations(id uuid primary key,site_code text,timezone text);
 create table public.manager_locations(manager_id uuid,location_id uuid);
 create table public.edit_audit_log(id uuid default gen_random_uuid(),table_name text,location_id uuid not null,period date,changed_by uuid,changed_by_name text,summary text,old_values jsonb,new_values jsonb);
 create table public.actuals(id integer primary key,value numeric);insert into public.actuals values(1,123.456);
 create table public.budget_targets(id integer primary key,goal numeric);insert into public.budget_targets values(1,987.654);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;
 create policy preexisting_permissive on storage.objects for all to anon,authenticated using(true) with check(true);
 insert into public.locations values('${site}','1000-Fictional','America/Los_Angeles');
 insert into public.user_profiles values('${admin}','admin',null,true,null,'Admin'),('${store}','store','${site}',true,null,'Store'),('${inactive}','store','${site}',false,null,'Inactive'),('${deleted}','store','${site}',true,now(),'Deleted'),('${manager}','area_manager',null,true,null,'Legacy'),('${inactiveAdmin}','admin',null,false,null,'Inactive Admin');
 alter default privileges grant all on schemas to authenticated;alter default privileges grant all on tables to anon,authenticated;alter default privileges grant execute on functions to anon,authenticated;
 `)
 // Apply actual installed checklist definitions too, to detect policy/trigger interference.
 for(const file of ['20261105173034_manager_checklists_pilot.sql','20261105212313_checklist_discard_draft.sql'])await db.exec(readFileSync(new URL('../../app/supabase/migrations/'+file,import.meta.url),'utf8'))
 const before=await db.query("select policyname,qual,with_check from pg_policies where schemaname='storage' order by policyname")
 await db.exec(migration);if(applyCorrection)await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261106233818_resource_upload_finalization_guard.sql',import.meta.url),'utf8'));await actor(db)
 return {db,before:before.rows}
}
test('private PDF bucket, grants, limits, existing checklist policies/triggers and operational data preserved',async()=>{
 const {db,before}=await setup();try{
  const buckets=await root(db,'select * from storage.buckets order by id')
  assert.deepEqual(buckets.find(b=>b.id==='resource-pdfs'),{id:'resource-pdfs',name:'resource-pdfs',public:false,file_size_limit:52428800,allowed_mime_types:['application/pdf']})
  assert.equal(buckets.find(b=>b.id==='manager-checklist-evidence').file_size_limit,10485760)
  assert.deepEqual((await root(db,"select policyname,qual,with_check from pg_policies where schemaname='storage' and policyname not like 'resource_%' order by policyname")),before)
  assert.equal((await root(db,"select count(*)::int n from pg_trigger where tgname='checklist_evidence_draft_insert'"))[0].n,1)
  assert.deepEqual(await root(db,'select * from public.actuals'),[{id:1,value:'123.456'}])
  assert.deepEqual(await root(db,'select * from public.budget_targets'),[{id:1,goal:'987.654'}])
  assert.equal((await root(db,"select has_table_privilege('authenticated','public.resource_documents','INSERT,UPDATE,DELETE,TRUNCATE') v"))[0].v,false)
  assert.equal((await root(db,"select has_schema_privilege('authenticated','resource_private','CREATE') v"))[0].v,false)
  const fns=await root(db,"select p.proname,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='resource_private' or p.proname='manage_resource'")
  assert.ok(fns.every(f=>!f.anon&&f.proconfig.includes('search_path=\"\"')))
 }finally{await db.close()}
})
test('only current active Admin and Store read published documents; no unpublished objects or client mutations',async()=>{
 const {db}=await setup();try{
  const live=await published(db),pending=await rpc(db,'prepare',null,{...info,title:'Pending'})
  await object(db,pending)
  await actor(db,store)
  assert.deepEqual((await db.query('select id from public.resource_documents')).rows,[{id:live.id}])
  assert.deepEqual((await db.query("select name from storage.objects where bucket_id='resource-pdfs'")).rows,[{name:live.object_path}])
  await assert.rejects(rpc(db,'prepare',null,info),/Admin/)
  for(const action of ['edit','publish','remove','cancel','cleanup','finish_cleanup'])await assert.rejects(rpc(db,action,live,info),/Admin/)
  await assert.rejects(object(db,pending),/policy|authorized/)
  for(const id of [inactive,deleted,manager,inactiveAdmin]){
   await actor(db,id);assert.equal((await db.query('select * from public.resource_documents')).rows.length,0)
   assert.equal((await db.query("select * from storage.objects where bucket_id='resource-pdfs'")).rows.length,0)
   await assert.rejects(rpc(db,'prepare',null,info),/Admin/)
  }
  await actor(db,'','anon');await assert.rejects(db.query('select * from public.resource_documents'),/permission/)
  assert.equal((await db.query("select * from storage.objects where bucket_id='resource-pdfs'")).rows.length,0)
  await actor(db,admin);await assert.rejects(db.query('delete from public.resource_documents'),/permission/)
  assert.equal((await db.query("delete from storage.objects where bucket_id='resource-pdfs' returning *")).rows.length,0)
 }finally{await db.close()}
})
test('replacement publishes only complete PDF, denies stale changes, hides retired bytes and resumes cleanup safely',async()=>{
 const {db}=await setup();try{
  const old=await published(db),pending=await rpc(db,'prepare',old,{...info,filename:'new.pdf'})
  await assert.rejects(rpc(db,'publish',pending),/Complete PDF/)
  await assert.rejects(rpc(db,'edit',old,info),/changed/)
  await actor(db,store);assert.equal((await db.query("select name from storage.objects where bucket_id='resource-pdfs'")).rows[0].name,old.object_path)
  await actor(db,admin);await object(db,pending);const live=await rpc(db,'publish',pending)
  assert.equal(live.cleanup_path,old.object_path);assert.notEqual(live.object_path,old.object_path)
  await assert.rejects(object(db,pending),/authorized|policy/)
  await assert.rejects(rpc(db,'finish_cleanup',live),/deletion/)
  await assert.rejects(rpc(db,'prepare',live,info),/pending/)
  await actor(db,store);assert.deepEqual((await db.query("select name from storage.objects where bucket_id='resource-pdfs'")).rows,[{name:live.object_path}])
  await actor(db,admin);assert.equal((await rpc(db,'cleanup',live)).path,old.object_path)
  // Simulated successful Storage API deletion in the isolated metadata fixture only.
  await root(db,'delete from storage.objects where name=$1',[old.object_path])
  const clean=await rpc(db,'finish_cleanup',live);assert.equal(clean.cleanup_path,null)
  await assert.rejects(rpc(db,'finish_cleanup',live),/changed/)
  assert.equal(clean.original_name,'new.pdf')
 }finally{await db.close()}
})
test('cancel/removal freeze stale uploads, retain cleanup until physical removal, and cannot affect another document',async()=>{
 const {db}=await setup();try{
  const other=await published(db,{...info,title:'Unrelated'}),pending=await rpc(db,'prepare',null,info)
  await object(db,pending);const canceled=await rpc(db,'cancel',pending)
  await assert.rejects(object(db,pending),/authorized|policy/)
  await root(db,'delete from storage.objects where name=$1',[canceled.cleanup_path]);await rpc(db,'finish_cleanup',canceled)
  const removed=await rpc(db,'remove',other)
  await actor(db,store);assert.equal((await db.query('select * from public.resource_documents')).rows.length,0)
  await actor(db,admin);await assert.rejects(rpc(db,'finish_cleanup',removed),/deletion/)
  await root(db,'delete from storage.objects where name=$1',[removed.cleanup_path]);assert.equal((await rpc(db,'finish_cleanup',removed)).deleted,true)
  assert.equal((await db.query("select * from storage.objects where bucket_id='resource-pdfs'")).rows.length,0)
 }finally{await db.close()}
})
test('metadata rules, file limits, unique uploads and publish failures are atomic',async()=>{
 const {db}=await setup();try{
  for(const bad of [{...info,size:52428801},{...info,size:0},{...info,brand:''},{...info,category:'Training'},{...info,filename:'bad.exe'},{...info,title:''}])await assert.rejects(rpc(db,'prepare',null,bad))
  assert.equal((await db.query('select * from public.resource_documents')).rows.length,0)
  const row=await rpc(db,'prepare',null,{...info,size:52428800});await object(db,row,{mimetype:'image/png',size:52428800})
  await assert.rejects(rpc(db,'publish',row),/Complete PDF/)
  assert.equal((await db.query('select object_path from public.resource_documents')).rows[0].object_path,null)
  await assert.rejects(object(db,row),/unique/)
  const edited=await rpc(db,'cancel',row);await root(db,'delete from storage.objects where name=$1',[edited.cleanup_path]);await rpc(db,'finish_cleanup',edited)
  const live=await published(db);const renamed=await rpc(db,'edit',live,{...info,title:'Renamed',brand:'New Brand'})
  assert.equal(renamed.title,'Renamed');assert.equal(renamed.object_path,live.object_path)
 }finally{await db.close()}
})
test('deactivation revokes reads and writes immediately even with unchanged caller JWT',async()=>{
 const {db}=await setup();try{
  const row=await published(db);await actor(db,store)
  assert.equal((await db.query('select * from public.resource_documents')).rows.length,1)
  await root(db,'update public.user_profiles set is_active=false where id=$1',[store])
  assert.equal((await db.query('select * from public.resource_documents')).rows.length,0)
  assert.equal((await db.query("select * from storage.objects where bucket_id='resource-pdfs'")).rows.length,0)
  await actor(db,admin);await root(db,'update public.user_profiles set deleted_at=now() where id=$1',[admin])
  await assert.rejects(rpc(db,'remove',row),/Admin/)
 }finally{await db.close()}
})

test('Storage finalization without caller JWT preserves active Admin owner and reservation authorization',async()=>{
 const {db}=await setup();try{
  const row=await rpc(db,'prepare',null,info)
  // Storage first probes INSERT as the authenticated caller and rolls it back.
  await db.exec('begin');await object(db,row);await db.exec('rollback')
  // Its final metadata write runs as service_role, retaining owner_id, without sub.
  await actor(db,'','service_role')
  await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)',
   ['resource-pdfs',row.pending_upload.path,admin,JSON.stringify({mimetype:'application/pdf',size:info.size})])
 }finally{await db.close()}
})

test('original guard reproduces the hosted failure at Storage service-role finalization',async()=>{
 const {db}=await setup(false);try{
  const row=await rpc(db,'prepare',null,info)
  await db.exec('begin');await object(db,row);await db.exec('rollback')
  await actor(db,'','service_role')
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',
   ['resource-pdfs',row.pending_upload.path,admin]),{code:'42501',message:'Resource upload is no longer authorized'})
  assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='resource-pdfs'")).rows[0].n,0)
 }finally{await db.close()}
})
test('finalization rejects non-Admin owners, missing owners, stale reservations and caller spoofing',async()=>{
 const {db}=await setup();try{
  let row=await rpc(db,'prepare',null,info)
  const insert=(owner,path=row.pending_upload.path)=>db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['resource-pdfs',path,owner])
  await actor(db,'','service_role')
  for(const owner of [null,store,inactive,deleted,manager,inactiveAdmin])await assert.rejects(insert(owner),/no longer authorized/)
  await assert.rejects(insert(admin,'unreserved.pdf'),/no longer authorized/)
  for(const [id,role] of [[store,'authenticated'],[inactiveAdmin,'authenticated'],['','authenticated'],['','anon']]){
   await actor(db,id,role);await assert.rejects(insert(admin),/authorized|policy/)
  }
  await actor(db,admin);row=await rpc(db,'cancel',row)
  await actor(db,'','service_role');await assert.rejects(insert(admin,row.cleanup_path),/no longer authorized/)
  await actor(db,admin);const pending=await rpc(db,'prepare',null,info)
  await root(db,'update public.user_profiles set is_active=false where id=$1',[admin])
  await actor(db,'','service_role');await assert.rejects(insert(admin,pending.pending_upload.path),/no longer authorized/)
  assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='resource-pdfs'")).rows[0].n,0)
 }finally{await db.close()}
})
