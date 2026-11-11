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
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261105212313_checklist_discard_draft.sql', import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261109172331_checklist_companywide_access.sql', import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261109193454_weekly_pm_checklist.sql', import.meta.url),'utf8'))
 await db.exec(`alter table locations add column name text, add column market text, add column exclude_from_reporting boolean default false;`)
 await db.exec(reportMigration)
 const today=(await db.query(`select (now() at time zone 'America/Los_Angeles')::date::text as d`)).rows[0].d
 await db.exec(`insert into public.checklist_pilot_access(location_id,user_id,enabled_from) values('${site}','${store}',date '${today}'-40);`)
 await actor(db,store)
 return {db,today}
}

const reportMigration=readFileSync(new URL('../../app/supabase/migrations/20261111200615_checklist_compliance_report.sql',import.meta.url),'utf8')
async function report(db,start='2026-01-07',end='2026-01-11') {
 return (await db.query('select public.get_checklist_compliance($1,$2) result',[start,end])).rows[0].result
}
async function seed(db,location=site,key='opening',date='2026-01-07',status='submitted') {
 return root(db,`insert into checklist_submissions(template_key,location_id,period_date,created_by,status,submitted_at,template_snapshot,answers,manager_name,is_pilot)
 values($1,$2,$3,$4,$5,case when $5='submitted' then now() else null end,'{}','{"secret":"PRIVATE ANSWERS"}','PRIVATE NAME',true) returning id`,[key,location,date,store,status])
}
test('RPC scope includes zero-submission sites; denied profiles and anonymous cannot execute',async()=>{
 const {db}=await setup();try{
  const empty=uuid(12),excluded=uuid(13)
  await root(db,`insert into locations(id,site_code,timezone,exclude_from_reporting) values('${empty}','1002','UTC',null),('${excluded}','1003','UTC',true)`)
  await actor(db,admin)
  assert.deepEqual((await report(db)).locations.map(l=>l.id),[site,away,empty])
  assert.deepEqual((await report(db)).submissions,[])
  await actor(db,store);assert.deepEqual((await report(db)).locations.map(l=>l.id),[site])
  await actor(db,manager);assert.deepEqual((await report(db)).locations.map(l=>l.id),[site])
  await root(db,`delete from manager_locations`)
  assert.deepEqual((await report(db)).locations,[])
  await root(db,`insert into user_profiles(id,role,is_active) values('${uuid(90)}','unsupported',true)`)
  for(const id of [inactive,deleted,uuid(90),uuid(91),'']) {
   await actor(db,id);await assert.rejects(report(db),/Active supported profile/)
  }
  await actor(db,'','anon');await assert.rejects(report(db),/permission denied/)
 }finally{await db.close()}
})
test('narrow summaries include all five templates, Monday before range and draft/pilot status; raw RLS stays isolated',async()=>{
 const {db}=await setup();try{
  for(const key of ['opening','midday','closing','weekly','weekly_pm']) await seed(db,site,key,key.startsWith('weekly')?'2026-01-05':'2026-01-07',key==='midday'?'draft':'submitted')
  await seed(db,away)
  await seed(db,site,'opening','2026-01-08','discarding')
  await seed(db,site,'opening','2026-01-06')
  await seed(db,site,'weekly','2025-12-29')
  await seed(db,site,'closing','2026-01-12')
  const existing=(await root(db,`select id from checklist_submissions where location_id='${site}' and status='draft' limit 1`))[0].id
  await root(db,`insert into checklist_attachments(id,submission_id,kind,object_path,created_by) values('${uuid(200)}','${existing}','signature','${existing}/${uuid(200)}.png','${store}')`)
  await root(db,`insert into storage.objects(bucket_id,name) values('manager-checklist-evidence','${existing}/${uuid(200)}.png')`)
  await actor(db,manager)
  assert.equal((await db.query("select * from storage.objects where bucket_id='manager-checklist-evidence'")).rows.length,0)
  assert.equal((await db.query('select * from checklist_submissions')).rows.length,0)
  assert.equal((await db.query('select * from checklist_attachments')).rows.length,0)
  const r=await report(db)
  assert.equal(r.submissions.length,6)
  for(const row of r.submissions) assert.deepEqual(Object.keys(row).sort(),['is_pilot','location_id','period_date','status','template_key'])
  for(const row of r.locations) assert.deepEqual(Object.keys(row).sort(),['id','local_today','market','name','site_code','timezone'])
  assert.equal(r.submissions.find(s=>s.template_key==='midday').status,'draft')
  assert.equal(r.submissions.find(s=>s.period_date==='2026-01-08').status,'discarding')
  assert.equal(r.submissions.find(s=>s.template_key==='weekly_pm').period_date,'2026-01-05')
  assert.ok(r.submissions.every(s=>s.is_pilot))
  assert.ok(!JSON.stringify(r).includes('PRIVATE'))
  await actor(db,other);assert.equal((await report(db)).submissions.length,6)
  assert.equal((await db.query('select * from checklist_submissions')).rows.length,0)
  await assert.rejects(db.exec("update checklist_submissions set answers='{}'"),/permission denied/)
 }finally{await db.close()}
})
test('inclusive 92-day cap, null/infinite/reversed bounds, site-local future suppression and explicit timezone failures',async()=>{
 const {db,today}=await setup();try{
  await report(db,'2026-01-01','2026-04-02')
  for(const [start,end] of [[null,today],[today,null],['infinity','infinity'],['-infinity',today],['2026-01-02','2026-01-01'],['2026-01-01','2026-04-03']]) await assert.rejects(report(db,start,end),/valid range/)
  const dates=(await db.query("select (current_date+2)::text future, (current_date-1)::text start, (current_date+3)::text finish")).rows[0]
  await seed(db,site,'opening',dates.future)
  await actor(db,store)
  const r=await report(db,dates.start,dates.finish)
  assert.equal(r.locations[0].local_today,today);assert.equal(r.submissions.length,0)
  await root(db,`update locations set timezone='Not/AZone' where id='${away}'`)
  await report(db) // Invalid unassigned site must not block/leak into Store scope.
  await actor(db,admin);await assert.rejects(report(db),/Valid site time zone/)
  await root(db,`update locations set timezone=null where id='${away}'`)
  await assert.rejects(report(db),/Valid site time zone/)
 }finally{await db.close()}
})
test('report is repeatable/read-only, migration re-runs and existing raw/evidence policies and grants remain unchanged',async()=>{
 const {db}=await setup();try{
  await seed(db)
  const snapshot=async()=>JSON.stringify(await root(db,`select
   (select jsonb_agg(to_jsonb(s)) from checklist_submissions s) submissions,
   (select jsonb_agg(to_jsonb(t)) from checklist_templates t) templates,
   (select jsonb_agg(to_jsonb(a)) from edit_audit_log a) audit,
   (select jsonb_agg(to_jsonb(a)) from checklist_attachments a) attachments,
   (select jsonb_agg(to_jsonb(o)) from storage.objects o) objects,
   (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p) policies`))
  const before=await snapshot()
  await db.exec('reset role');await db.exec(reportMigration)
  await actor(db,manager);await report(db);await report(db)
  assert.equal(await snapshot(),before)
  const acl=await root(db,`select p.proname,p.provolatile,p.prosecdef,p.proconfig,
   has_function_privilege('anon',p.oid,'execute') anon,
   has_function_privilege('authenticated',p.oid,'execute') authenticated
   from pg_proc p where p.proname in ('get_checklist_compliance','compliance_summary')`)
  assert.equal(acl.length,2)
  assert.ok(acl.every(f=>f.provolatile==='s'&&!f.anon&&f.authenticated&&f.proconfig.includes('search_path=""')))
  assert.equal(acl.find(f=>f.proname==='get_checklist_compliance').prosecdef,false)
  await db.exec('reset role; set role authenticated; begin read only')
  await report(db);await db.exec('rollback')
 }finally{await db.close()}
})
