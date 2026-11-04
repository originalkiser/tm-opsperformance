// Isolated PostgreSQL only. No production connection or private workbook.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration=readFileSync(new URL('../../app/supabase/migrations/20261104210922_monthly_budget_import.sql',import.meta.url),'utf8')
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const admin=id(1),store=id(2),inactive=id(3),deleted=id(4),manager=id(5)
const site=id(10),full=id(11)
function source(month='2028-02-01',code='1512') {
 const days=new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).getUTCDate()
 return {site:code,hours:code==='1508'?'0':'100',hours_with_manager:code==='1508'?'0':'145',percentage:code==='1508'?'0.35':null,
 revenue_goal:String(days)+'.'+String(days).padStart(18,'0'),daily:Array.from({length:days},(_,i)=>({business_date:month.slice(0,8)+String(i+1).padStart(2,'0'),total:'1.000000000000000001',retail:'0.25',recurring:'0.750000000000000001'}))}
}
async function database(){
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid primary key,role text,is_active boolean,deleted_at timestamptz,name text,email text);
 create table public.locations(id uuid primary key,site_code text,show_budget_tracking boolean,exclude_from_reporting boolean);
 create table public.budget_targets(id uuid primary key default gen_random_uuid(),location_id uuid references public.locations(id),target_month date,
 revenue_goal numeric not null default 0,starting_members integer,membership_daily_growth numeric default 2,membership_goal integer not null default 0,
 labor_hours_non_salary numeric not null default 0,labor_hours_with_salary numeric not null default 0,full_service_labor_percentage numeric,
 desired_rating numeric default 4.85,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),unique(location_id,target_month));
 create table public.budget_daily_entries(location_id uuid,entry_date date,mtd_membership_actual integer,mtd_revenue_actual numeric,unique(location_id,entry_date));
 create table public.budget_daily_revenue_goals(location_id uuid references public.locations(id),business_date date,total_revenue_goal numeric not null,retail_revenue_goal numeric not null,recurring_revenue_goal numeric not null,primary key(location_id,business_date));
 alter table public.budget_daily_revenue_goals enable row level security;
 create table public.edit_audit_log(id uuid default gen_random_uuid(),table_name text,location_id uuid,period date,changed_by uuid,changed_by_name text,summary text,old_values jsonb,new_values jsonb);
 insert into public.user_profiles values('${admin}','admin',true,null,'Fictional Admin',null),('${store}','store',true,null,null,null),('${inactive}','admin',false,null,null,null),('${deleted}','admin',true,now(),null,null),('${manager}','area_manager',true,null,null,null);
 insert into public.locations values('${site}','1512-Fictional',true,false),('${full}','1508-Fictional',true,false);
 insert into public.budget_daily_entries values('${site}','2028-02-01',100,10),('${site}','2028-02-02',999,11),('${full}','2028-01-31',777,12),('${full}','2028-02-02',888,13);
 insert into public.budget_targets(location_id,target_month,revenue_goal,starting_members,membership_goal) values('${site}','2028-01-01',333,20,82);
 `)
 const metadata=async()=>JSON.stringify((await db.query(`select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl::text,'rls',relrowsecurity) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public')) as snapshot`)).rows[0].snapshot)
 const before=await metadata()
 await db.exec(migration)
 assert.equal(await metadata(),before)
 const security=(await db.query("select p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated from pg_proc p where p.oid='public.import_monthly_budget(date,jsonb,boolean,text)'::regprocedure")).rows[0]
 assert.equal(security.prosecdef,true);assert.equal(security.owner,'postgres');assert.equal(security.anon,false);assert.equal(security.authenticated,true);assert.ok(security.proconfig.includes('search_path=\"\"'))
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
 return db
}
async function call(db,sites=[source()],confirm=false,expected=null,month='2028-02-01') {
 return (await db.query('select public.import_monthly_budget($1,$2::jsonb,$3,$4) as result',[month,JSON.stringify(sites),confirm,expected])).rows[0].result
}
async function scalar(db,sql){await db.exec('reset role');const result=(await db.query(sql)).rows;await db.exec('set role authenticated');return result}

test('first-day baseline only, missing vs zero, preserved approved baselines, explicit corrections and idempotent audit',async()=>{
 const db=await database();try{
  const payload=[source(),source('2028-02-01','1508')],preview=await call(db,payload)
  const a=preview.sites.find(s=>s.site==='1512'),b=preview.sites.find(s=>s.site==='1508')
  assert.equal(a.starting_members,100);assert.equal(a.membership_goal,158)
  assert.equal(b.source_members,null);assert.equal(b.starting_members,null);assert.equal(b.membership_goal,null)
  const saved=await call(db,payload,true,preview.fingerprint);assert.equal(saved.changed_sites,2);assert.equal(saved.pending_membership,1)
  assert.equal((await scalar(db,`select count(*)::int as n from public.budget_daily_revenue_goals`))[0].n,58)
  const rows=await scalar(db,`select starting_members,membership_goal,full_service_labor_percentage::text as pct from public.budget_targets where location_id='${full}' and target_month='2028-02-01'`)
  assert.deepEqual(rows[0],{starting_members:null,membership_goal:null,pct:'0.35'})
  const again=await call(db,payload);assert.equal((await call(db,payload,true,again.fingerprint)).changed_sites,0)
  assert.equal((await scalar(db,'select count(*)::int as n from public.edit_audit_log'))[0].n,2)
  await db.exec('reset role');await db.exec(`update public.budget_daily_entries set mtd_membership_actual=101 where location_id='${site}' and entry_date='2028-02-01';insert into public.budget_daily_entries values('${full}','2028-02-01',0,10);update public.budget_targets set membership_daily_growth=3 where location_id='${full}' and target_month='2028-02-01'`);await db.exec('set role authenticated')
  const updated=await call(db,payload);assert.equal(updated.sites.find(s=>s.site==='1512').starting_members,100);assert.equal(updated.sites.find(s=>s.site==='1508').membership_goal,87)
  await call(db,payload,true,updated.fingerprint)
  const correction=payload.map(s=>s.site==='1512'?{...s,replace_membership:true,opening_members:'103'}:s)
  const reviewed=await call(db,correction);await call(db,correction,true,reviewed.fingerprint)
  const targets=await scalar(db,`select starting_members,membership_goal from public.budget_targets where location_id='${site}' and target_month='2028-02-01'`)
  assert.deepEqual(targets[0],{starting_members:103,membership_goal:161})
  assert.equal((await scalar(db,`select revenue_goal::text as v from public.budget_targets where target_month='2028-01-01'`))[0].v,'333')
  assert.equal((await scalar(db,'select sum(mtd_revenue_actual)::text as n from public.budget_daily_entries'))[0].n,'56')
 }finally{await db.close()}
})
test('Admin-only including preview; no direct daily goal writes or unrelated grants',async()=>{
 const db=await database();try{
  for(const user of [store,inactive,deleted,manager,id(99),'']){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await assert.rejects(call(db),/Active Admin required/)
  }
  await db.exec('reset role;set role anon');await assert.rejects(call(db),/permission denied/)
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
  await assert.rejects(db.exec(`insert into public.budget_daily_revenue_goals values('${site}','2028-02-01',1,0,1)`),/permission denied/)
 }finally{await db.close()}
})
test('invalid source, duplicate dates, mappings, conflicts, and audit failure roll back atomically',async()=>{
 const db=await database();try{
  const preview=await call(db), bad=source();bad.daily[1].business_date=bad.daily[0].business_date
  await assert.rejects(call(db,[bad],true,preview.fingerprint),/duplicate|Missing/)
  await assert.rejects(call(db,[source(),source()],true,preview.fingerprint),/duplicate site/)
  await assert.rejects(call(db,[{...source(),site:'1523'}]),/Missing or ambiguous/)
  await assert.rejects(call(db,[{...source(),site:'1508'}]),/full-service/)
  const altered=source();altered.revenue_goal='0';await assert.rejects(call(db,[altered]),/reconciliation/)
  await db.exec('reset role');await db.exec(`update public.budget_daily_entries set mtd_membership_actual=102 where location_id='${site}' and entry_date='2028-02-01'`);await db.exec('set role authenticated')
  await assert.rejects(call(db,[source()],true,preview.fingerprint),/changed since preview/)
  const fresh=await call(db)
  await db.exec('reset role');await db.exec(`alter table public.edit_audit_log add constraint fixture_failure check(false)`);await db.exec('set role authenticated')
  await assert.rejects(call(db,[source()],true,fresh.fingerprint),/fixture_failure/)
  assert.equal((await scalar(db,'select count(*)::int as n from public.budget_daily_revenue_goals'))[0].n,0)
  assert.equal((await scalar(db,"select count(*)::int as n from public.budget_targets where target_month='2028-02-01'"))[0].n,0)
 }finally{await db.close()}
})
test('month lengths and exact numeric precision survive database transport',async()=>{
 const db=await database();try{
  for(const month of ['2027-02-01','2028-02-01','2024-02-01','2026-11-01','2026-12-01','2027-01-01']){
   const s=source(month),p=await call(db,[s],false,null,month)
   await call(db,[s],true,p.fingerprint,month)
   const row=(await scalar(db,`select count(*)::int as n,min(total_revenue_goal)::text as v from public.budget_daily_revenue_goals where business_date>='${month}' and business_date<'${month}'::date+interval '1 month'`))[0]
   assert.equal(row.n,s.daily.length);assert.equal(row.v,'1.000000000000000001')
  }
 }finally{await db.close()}
})

test('target/daily/mapping drift stops, pending defaults become NULL, and unrelated fields survive',async()=>{
 const db=await database();try{
  const payload=[source()]
  await db.exec('reset role');await db.exec(`insert into public.budget_targets(location_id,target_month,desired_rating) values('${site}','2028-02-01',4.2)`);await db.exec('set role authenticated')
  let p=await call(db,payload)
  assert.equal(p.sites[0].keep_membership,false) // default zero is not an approved baseline
  await db.exec('reset role');await db.exec(`update public.budget_targets set desired_rating=4.3 where target_month='2028-02-01'`);await db.exec('set role authenticated')
  await assert.rejects(call(db,payload,true,p.fingerprint),/changed since preview/)
  p=await call(db,payload);await call(db,payload,true,p.fingerprint)
  assert.equal((await scalar(db,`select desired_rating::text as v from public.budget_targets where target_month='2028-02-01'`))[0].v,'4.3')
  p=await call(db,payload)
  await db.exec('reset role');await db.exec(`update public.budget_daily_revenue_goals set total_revenue_goal=2 where business_date='2028-02-01'`);await db.exec('set role authenticated')
  await assert.rejects(call(db,payload,true,p.fingerprint),/changed since preview/)
  p=await call(db,payload)
  await db.exec('reset role');await db.exec(`update public.locations set exclude_from_reporting=true where id='${site}'`);await db.exec('set role authenticated')
  await assert.rejects(call(db,payload,true,p.fingerprint),/not eligible/)
  await db.exec('reset role');await db.exec(`update public.locations set exclude_from_reporting=false where id='${site}';insert into public.locations values('${id(12)}','1512-Duplicate',true,false)`);await db.exec('set role authenticated')
  await assert.rejects(call(db,payload),/ambiguous/)
 }finally{await db.close()}
})

test('schema rollback refuses to invent zero goals and leaves all data intact',async()=>{
 const db=await database();try{
  const payload=[source('2028-02-01','1508')],p=await call(db,payload)
  await call(db,payload,true,p.fingerprint)
  const rollback=readFileSync(new URL('../../docs/sql/monthly-budget-import-ROLLBACK-REVIEW-ONLY.sql',import.meta.url),'utf8')
  await db.exec('reset role')
  await assert.rejects(db.exec(rollback),/Pending membership goals exist/);await db.exec('rollback')
  assert.equal((await db.query('select count(*)::int as n from public.budget_targets where membership_goal is null')).rows[0].n,1)
  assert.ok((await db.query("select to_regprocedure('public.import_monthly_budget(date,jsonb,boolean,text)') as f")).rows[0].f)
 }finally{await db.close()}
})

test('unexpected target and daily triggers cannot commit divergent budgets or unrelated fields',async()=>{
 const db=await database();try{
  await db.exec('reset role');await db.exec(`insert into public.budget_targets(location_id,target_month,starting_members,membership_goal,desired_rating) values('${site}','2028-02-01',100,158,4.2)`);await db.exec('set role authenticated')
  for(const [field,error]of [['desired_rating','Unrelated target fields changed'],['revenue_goal','Stored monthly targets differ']]){
   await db.exec('reset role');await db.exec(`create or replace function public.fixture_budget_trigger() returns trigger language plpgsql as $$begin new.${field}=0;return new;end$$;create trigger fixture_budget_trigger before update on public.budget_targets for each row execute function public.fixture_budget_trigger()`);await db.exec('set role authenticated')
   const p=await call(db);await assert.rejects(call(db,[source()],true,p.fingerprint),field==='desired_rating'?/Stored monthly targets|Unrelated target/:new RegExp(error))
   await db.exec('reset role');await db.exec('drop trigger fixture_budget_trigger on public.budget_targets');await db.exec('set role authenticated')
  }
  await db.exec('reset role');await db.exec(`create function public.fixture_daily_trigger() returns trigger language plpgsql as $$begin new.total_revenue_goal=0;return new;end$$;create trigger fixture_daily_trigger before insert on public.budget_daily_revenue_goals for each row execute function public.fixture_daily_trigger()`);await db.exec('set role authenticated')
  const p=await call(db);await assert.rejects(call(db,[source()],true,p.fingerprint),/Stored daily goals differ/)
  assert.equal((await scalar(db,'select count(*)::int as n from public.budget_daily_revenue_goals'))[0].n,0)
 }finally{await db.close()}
})

test('preview fingerprint binds all proposed budgets, baselines, growth and replacement decisions',async()=>{
 const db=await database();try{
  const original=[{...source(),opening_members:'100',replace_membership:false}],p=await call(db,original)
  const changes=[
   s=>{s.daily[0].total='2.000000000000000001';s.daily[0].recurring='1.750000000000000001';s.revenue_goal='30.000000000000000029'},
   s=>{s.daily[0].retail='0.5';s.daily[0].recurring='0.500000000000000001'},
   s=>{s.hours='101';s.hours_with_manager='146'},
   s=>{s.opening_members='101'},
   s=>{s.membership_daily_growth='3'},
   s=>{s.replace_membership=true},
  ]
  for(const change of changes){
   const changed=structuredClone(original);change(changed[0])
   // Each variant is valid for a new preview; stale approval must still fail.
   const revised=await call(db,changed);assert.notEqual(revised.fingerprint,p.fingerprint)
   assert.equal(revised.state_fingerprint,p.state_fingerprint)
   await assert.rejects(call(db,changed,true,p.fingerprint),/proposed import changed since preview/)
  }
  assert.equal((await scalar(db,'select count(*)::int as n from public.budget_daily_revenue_goals'))[0].n,0)
  assert.equal((await scalar(db,'select count(*)::int as n from public.edit_audit_log'))[0].n,0)
  // The unchanged preview/import pair still succeeds with its original approval.
  assert.equal((await call(db,original,true,p.fingerprint)).changed_sites,1)
  const fullPayload=[source('2028-02-01','1508')],fullPreview=await call(db,fullPayload)
  fullPayload[0].percentage='0.33'
  await assert.rejects(call(db,fullPayload,true,fullPreview.fingerprint),/proposed import changed since preview/)
  // Existing conflict protection also covers the effective stored growth rate.
  const fresh=await call(db,original)
  await db.exec('reset role');await db.exec(`update public.budget_targets set membership_daily_growth=3 where location_id='${site}' and target_month='2028-02-01'`);await db.exec('set role authenticated')
  await assert.rejects(call(db,original,true,fresh.fingerprint),/changed since preview/)
 }finally{await db.close()}
})
