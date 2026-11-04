// Authorization regression for the final migration itself, with fictional data.
// No corrective policy script is applied. No production connection.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'')
const migrationPath=`${root}/app/supabase/migrations/20261103203908_november_daily_revenue_goals.sql`
const migration=readFileSync(migrationPath,'utf8')
const digest=s=>createHash('sha256').update(s).digest('hex')
const originalHash=digest(migration)
const siteId=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const accountId=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const sites=Array.from({length:20},(_,i)=>siteId(i+1))
test('final migration directly grants companywide goals to active Admin/Store while preserving operational access', async t => {
const db=new PGlite()
let checks=0
const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++}
const denied=async sql=>{await assert.rejects(db.exec(sql),/permission denied|row-level security/);checks++}
const count=async sql=>(await db.query(sql)).rows[0].n
const login=async n=>{await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${n?accountId(n):''}',false)`)}
const metadata=async()=>JSON.stringify((await db.query(`select jsonb_build_object(
 'functions',(select jsonb_agg(pg_get_functiondef(p.oid) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname) from pg_policies p where schemaname='public' and tablename<>'budget_daily_revenue_goals'),
 'tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('locations','user_profiles','budget_targets','budget_daily_entries','manager_locations'))
 ) as fingerprint`)).rows[0].fingerprint)
try {
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table public.locations(id uuid primary key,show_budget_tracking boolean,exclude_from_reporting boolean);
 create table public.user_profiles(id uuid primary key,role text,is_active boolean,deleted_at timestamptz,location_id uuid);
 create table public.manager_locations(manager_id uuid,location_id uuid);
 create table public.budget_targets(location_id uuid,target_month date);
 create table public.budget_daily_entries(location_id uuid,entry_date date,mtd_revenue_actual numeric,cash_note text);
 create function public.user_can_edit_location(loc uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=auth.uid() and
 (p.role='admin' or(p.role='store' and p.location_id=loc) or(p.role='area_manager' and exists(select 1 from public.manager_locations m where m.manager_id=p.id and m.location_id=loc))))$$;
 alter table public.user_profiles enable row level security;
 create policy own_profile on public.user_profiles for select to authenticated using(id=auth.uid());
 alter table public.locations enable row level security;
 create policy reporting_locations on public.locations for select to authenticated using(true);
 alter table public.budget_daily_entries enable row level security;
 create policy operational_access on public.budget_daily_entries for all to authenticated
 using(public.user_can_edit_location(location_id)) with check(public.user_can_edit_location(location_id));
 grant select on public.user_profiles,public.locations to authenticated;
 grant select,insert,update,delete on public.budget_daily_entries to authenticated;
 alter default privileges in schema public grant all on tables to authenticated,anon;`)
 for(const id of sites)await db.query('insert into public.locations values($1,true,false)',[id])
 await db.query('insert into public.locations values($1,true,true),($2,false,false)',[siteId(21),siteId(22)])
 const profiles=[['admin',true,null],['store',true,null],['store',false,null],['store',true,'2026-01-01'],['auditor',true,null],['area_manager',true,null],['admin',false,null],['admin',true,'2026-01-01']]
 for(let i=0;i<profiles.length;i++)await db.query('insert into public.user_profiles values($1,$2,$3,$4,$5)',[accountId(i+1),...profiles[i],sites[0]])
 await db.query('insert into public.manager_locations values($1,$2)',[accountId(6),sites[0]])
 await db.exec(`insert into public.budget_daily_entries select id,date '2026-11-02',1.01,'Fictional private cash note' from public.locations`)
 const beforeMetadata=await metadata()
 await db.exec(migration)
 await db.exec(`insert into public.budget_daily_revenue_goals
 select l.id,date '2026-11-01'+d.day,1.1234567890123456789,.1234567890123456789,1
 from public.locations l cross join generate_series(0,29) as d(day)`)
 equal(await metadata(),beforeMetadata)
 equal((await db.query("select count(*)::int as n from pg_policies where schemaname='public' and tablename='budget_daily_revenue_goals'")).rows[0].n,1)
 assert.doesNotMatch(migration,/drop policy/i);checks++
 const corrected={}
 for(const [name,number] of [['Admin',1],['Store',2]]) {
  await login(number)
  const rows=(await db.query('select location_id,business_date,total_revenue_goal::text,retail_revenue_goal::text,recurring_revenue_goal::text from public.budget_daily_revenue_goals')).rows
  equal(rows.length,600);equal(new Set(rows.map(r=>r.location_id)).size,20)
  equal(rows[0].total_revenue_goal,'1.1234567890123456789')
  equal(rows.some(r=>r.location_id===siteId(21)||r.location_id===siteId(22)),false)
  equal(Object.keys(rows[0]).sort(),['business_date','location_id','recurring_revenue_goal','retail_revenue_goal','total_revenue_goal'])
  for(const sql of [
   `insert into public.budget_daily_revenue_goals values('${sites[0]}','2026-12-01',1,0,1)`,
   'update public.budget_daily_revenue_goals set total_revenue_goal=0',
   'delete from public.budget_daily_revenue_goals',
   'truncate public.budget_daily_revenue_goals'
  ])await denied(sql)
  corrected[name]={eligible_sites:20,goal_rows:600,goal_writes:'denied'}
 }
 await login(2)
 equal(await count('select count(*)::int as n from public.budget_daily_entries'),1)
 equal(await count(`select count(*)::int as n from public.budget_daily_entries where location_id='${sites[1]}'`),0)
 const updated=await db.query(`update public.budget_daily_entries set mtd_revenue_actual=999 where location_id='${sites[1]}' returning location_id`)
 equal(updated.rows.length,0)
 await denied(`insert into public.budget_daily_entries values('${sites[1]}','2026-11-03',1,'No access')`)
 const own=await db.query(`update public.budget_daily_entries set mtd_revenue_actual=2 where location_id='${sites[0]}' returning location_id`)
 equal(own.rows.length,1)
 await db.exec(`insert into public.budget_daily_entries values('${sites[0]}','2026-11-03',2,'Authorized own-site entry')`)
 equal(await count('select count(*)::int as n from public.budget_daily_entries'),2)
 for(const n of [3,4,5,0,7,8,9]){await login(n);equal(await count('select count(*)::int as n from public.budget_daily_revenue_goals'),0)}
 await login(6);equal(await count('select count(*)::int as n from public.budget_daily_revenue_goals'),30)
 await db.exec('reset role;set role anon')
 await denied('select * from public.budget_daily_revenue_goals')
 await db.exec('reset role')
 equal(await metadata(),beforeMetadata)
 equal(digest(readFileSync(migrationPath,'utf8')),originalHash)
 const summary={environment:'Isolated PostgreSQL with fictional profiles/data; established access rules modeled, no production SQL.',assertions:checks,
 final_migration_access:corrected,
 Store_actuals:'assigned-site reads/entry/corrections retained; unassigned reads/writes denied',
 excluded_or_disabled_goals:'hidden',inactive_deleted_unknown_or_signedout:'denied',legacy_manager:'assigned scope retained',
 existing_operational_policies_grants_and_functions:'unchanged',accepted_migration_sha256:originalHash}
 t.diagnostic(JSON.stringify(summary))
} finally {await db.close()}

})
