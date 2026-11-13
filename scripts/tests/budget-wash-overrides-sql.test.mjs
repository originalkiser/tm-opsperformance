// Isolated PostgreSQL engine and fictional counts only. No hosted connections.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration=readFileSync(new URL('../../app/supabase/migrations/20261113045619_budget_wash_overrides.sql',import.meta.url),'utf8')
const oldRpc=readFileSync(new URL('../../app/supabase/migration21.sql',import.meta.url),'utf8')
const admin='00000000-0000-0000-0000-000000000001',store='00000000-0000-0000-0000-000000000002',manager='00000000-0000-0000-0000-000000000003',site='00000000-0000-0000-0000-000000000010',other='00000000-0000-0000-0000-000000000011'
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.user_profiles(id uuid,role text,is_active boolean,deleted_at timestamptz);
create table public.locations(id uuid primary key,show_budget_tracking boolean,timezone text);
create table public.manager_locations(manager_id uuid,location_id uuid);
create table public.budget_daily_entries(location_id uuid,entry_date date,mtd_washes integer,mtd_redemptions integer,mtd_basic integer,mtd_good integer,mtd_better integer,mtd_best integer,current_reviews integer,yesterday_total_revenue numeric,mtd_revenue_actual numeric);
alter table public.budget_daily_entries enable row level security;
insert into public.locations values('${site}',true,'America/Chicago'),('${other}',true,'America/Chicago');
insert into public.user_profiles values('${admin}','admin',true,null),('${store}','store',true,null),('${manager}','area_manager',true,null);
insert into public.manager_locations values('${manager}','${site}');
insert into public.budget_daily_entries values('${site}','2026-11-12',1000,600,0,0,0,60,10,123.45,9876.54),('${other}','2026-11-12',2000,1000,0,0,0,80,20,543.21,7654.32);`);await db.exec(oldRpc);return db}
async function report(db,who=admin){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('set role authenticated');try{return (await db.query("select * from public.dashboard_mtd_performance($1,'2026-11-01','2026-11-11') order by location_id",[[site,other]])).rows}finally{await db.exec('reset role')}}
test('migration preserves old records/RLS/ACL and extends only the performance-count projection',async()=>{const db=await setup();try{
 const old=await report(db);const acl=(await db.query("select proacl::text acl from pg_proc where oid='public.dashboard_mtd_performance(uuid[],date,date)'::regprocedure")).rows[0].acl
 await db.exec(migration);const now=await report(db);assert.deepEqual(now.map(({mtd_wash_overrides,...r})=>r),old);assert(now.every(r=>r.mtd_wash_overrides===null));assert.deepEqual((await db.query('select yesterday_total_revenue,mtd_revenue_actual from public.budget_daily_entries order by location_id')).rows,[{yesterday_total_revenue:'123.45',mtd_revenue_actual:'9876.54'},{yesterday_total_revenue:'543.21',mtd_revenue_actual:'7654.32'}]);
 assert.equal((await db.query("select proacl::text acl from pg_proc where oid='public.dashboard_mtd_performance(uuid[],date,date)'::regprocedure")).rows[0].acl,acl)
 assert.equal((await db.query("select relrowsecurity rls from pg_class where oid='public.budget_daily_entries'::regclass")).rows[0].rls,true)
 assert(!Object.keys(now[0]).some(k=>k.includes('revenue')))
 await db.exec(`update public.budget_daily_entries set yesterday_wash_overrides=10,mtd_wash_overrides=100 where location_id='${site}'`);assert.equal((await report(db)).find(r=>r.location_id===site).mtd_wash_overrides,100)
 assert.equal((await report(db,store)).length,2);assert.equal((await report(db,manager)).length,1)
 await db.exec('set role anon');await assert.rejects(db.query("select * from public.dashboard_mtd_performance('{}','2026-11-01','2026-11-11')"),{code:'42501'});await db.exec('reset role')
}finally{await db.close()}})
test('database rejects negative Yesterday/MTD and fractional integer inputs while historical nulls remain valid',async()=>{const db=await setup();try{await db.exec(migration);for(const key of ['yesterday_wash_overrides','mtd_wash_overrides']){await assert.rejects(db.query(`update public.budget_daily_entries set ${key}=-1`),{code:'23514'});await assert.rejects(db.query(`update public.budget_daily_entries set ${key}=$1`,['1.5']),{code:'22P02'});await db.query(`update public.budget_daily_entries set ${key}=0`)}assert.equal((await db.query('select count(*)::int n from public.budget_daily_entries')).rows[0].n,2)}finally{await db.close()}})
test('unexpected RPC dependency blocks installation atomically; no CASCADE or lost historical columns',async()=>{const db=await setup();try{await db.exec('create view public.dependent_report as select * from public.dashboard_mtd_performance(null,null,null)');await assert.rejects(db.exec(migration),{code:'2BP01'});await db.exec('rollback');assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='budget_daily_entries' and column_name like '%wash_overrides'")).rows[0].n,0);assert.equal((await report(db)).length,2)}finally{await db.close()}})
