// Isolated in-memory PostgreSQL with fictional profiles/storage metadata only. Never contacts Supabase.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration = readFileSync(new URL('../../../app/supabase/migrations/20261105173034_manager_checklists_pilot.sql', import.meta.url), 'utf8')
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const admin=uuid(1),store=uuid(2),other=uuid(3),outsider=uuid(4),inactive=uuid(5),deleted=uuid(6),manager=uuid(7),site=uuid(10),away=uuid(11)
async function actor(db,id=admin,role='authenticated') { await db.exec(`reset role;set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']) }
async function root(db,sql,args=[]) { await db.exec('reset role');const result=await db.query(sql,args);await db.exec('set role authenticated');return result.rows }
async function setup({deadlines=true,integrity=true}={}) {
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz,name text);
 create table public.locations(id uuid primary key,site_code text,timezone text,exclude_from_reporting boolean default false);
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
 insert into public.locations(id,site_code,timezone) values('${site}','1000-Fictional','America/Los_Angeles'),('${away}','1001-Fictional','America/New_York');
 insert into public.user_profiles values('${admin}','admin',null,true,null,'Test Admin'),('${store}','store','${site}',true,null,'Test Store'),('${other}','store','${site}',true,null,'Other Store'),('${outsider}','store','${away}',true,null,'Outside Store'),('${inactive}','store','${site}',false,null,'Inactive'),('${deleted}','store','${site}',true,now(),'Deleted'),('${manager}','area_manager',null,true,null,'Legacy Manager');
 insert into public.manager_locations values('${manager}','${site}');
 `)
 await db.exec(`alter default privileges grant all on schemas to authenticated;alter default privileges grant all on tables to anon,authenticated;alter default privileges grant execute on functions to anon,authenticated;`)
 await db.exec(migration)
 const today=(await db.query(`select (now() at time zone 'America/Los_Angeles')::date::text as d`)).rows[0].d
 await db.exec(`insert into public.checklist_pilot_access(location_id,user_id,enabled_from) values('${site}','${store}',date '${today}'-40);`)
 await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261105212313_checklist_discard_draft.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261109172331_checklist_companywide_access.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261109193454_weekly_pm_checklist.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261112022829_checklist_qr_same_day.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261112143325_checklist_conflict_http_409.sql',import.meta.url),'utf8'))
 if(deadlines) await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261112184148_checklist_occurrence_deadlines.sql',import.meta.url),'utf8'))
 if(deadlines) await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261112222936_management_audits.sql',import.meta.url),'utf8'))
 if(integrity) await db.exec(readFileSync(new URL('../../../app/supabase/migrations/20261116023332_checklist_photo_integrity.sql',import.meta.url),'utf8'))
 await db.exec('set role service_role')
 return {db,today}
}

const hash='a'.repeat(64), newHash='b'.repeat(64)
async function api(db,action,body={},who=store,token=null) {
 await db.exec('reset role;set role service_role')
 return (await db.query('select public.checklist_access_server($1,$2,$3,$4::jsonb) as result',[who,token,action,JSON.stringify(body)])).rows[0].result
}
async function guest(db,action,body={},token=hash) {return api(db,action,body,null,token)}
async function configure(db) { return api(db,'qr_rotate',{location_id:site,token_hash:hash,expected_generation:0},admin) }
async function start(db,template='midday',who=store,token=null,date) {return api(db,'start',{location_id:site,template_key:template,period_date:date},who,token)}
function allAnswers(row) {return Object.fromEntries(row.template_snapshot.definition.map(i=>[i.id,{value:i.type==='text'?'Fictional inspection':i.options.find(v=>!i.failure_values.includes(v)),explanation:'Fictional test reason.'}]))}
async function upload(db,row,item=null,kind='signature',who=store,token=null) {
 const body={id:row.id,working_copy_id:row.working_copy_id,kind,item_id:item,extension:'png'}
 const u=await api(db,'upload_begin',body,who,token)
 await db.exec('reset role')
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('manager-checklist-evidence',$1,'{}'::jsonb)",[u.object_path])
 const done=await api(db,'upload_finish',{...body,upload_id:u.upload_id,sha256:u.upload_id.replaceAll('-','').padEnd(64,'0')},who,token)
 return done.attachment
}
async function ready(db,row,who=store,token=null) {
 for(const i of row.template_snapshot.definition) {if(i.photo_required) await upload(db,row,i.id,'photo',who,token);if(i.signature_required) await upload(db,row,i.id,'signature',who,token)}
 await upload(db,row,null,'signature',who,token)
}
async function saveNew(db,row,submit=false,who=store,token=null,answers=allAnswers(row)) {return api(db,'save',{id:row.id,working_copy_id:row.working_copy_id,revision:row.revision,answers,manager_name:'Fictional Auditor',submit},who,token)}

export { setup, api, actor, root, start, upload, ready, saveNew, configure, guest, allAnswers, uuid, site, away, admin, store, other, outsider }
