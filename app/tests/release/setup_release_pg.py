#!/usr/bin/env python3
import json,time,psycopg2
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DB='tm_roster_release_writer_test';options=dict(host='/private/tmp/tmid176-sock',port=55438,user='identity_test_admin')
c=psycopg2.connect(dbname='postgres',**options);c.autocommit=True
with c.cursor() as cur:
 cur.execute("select current_setting('data_directory'),inet_server_addr()")
 assert cur.fetchone()==('/private/tmp/tmid176-pgdata',None)
 cur.execute('drop database if exists '+DB);cur.execute('create database '+DB)
c.close();c=psycopg2.connect(dbname=DB,**options);c.autocommit=True
with c.cursor() as cur:
 cur.execute("""
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table locations(id uuid primary key);
 insert into locations values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
 create table user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz);
 insert into user_profiles values('40000000-0000-0000-0000-000000000002','store','10000000-0000-0000-0000-000000000001',true,null);
 create table manager_locations(manager_id uuid,location_id uuid);
 create function get_user_role() returns text language sql stable security definer set search_path='' as $$select role from public.user_profiles where id=auth.uid()$$;
 create table employees(id uuid primary key default gen_random_uuid(),location_id uuid not null references locations(id),name text not null,is_active boolean default true);
 insert into employees(id,location_id,name) values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Cam');
 alter table employees enable row level security;
 create policy employees_select on employees for select to authenticated using(true);
 create policy employees_write on employees for all to authenticated using(get_user_role()=any(array['admin'::text,'area_manager'::text]));
 grant all on employees to authenticated,anon,service_role;
 alter table user_profiles enable row level security;create policy profiles_select on user_profiles for select to authenticated using(id=auth.uid());grant select on user_profiles to authenticated;
 create table daily_logs(id uuid primary key default gen_random_uuid(),location_id uuid not null references locations(id),employee_id uuid references employees(id),log_date date not null,time_slot time not null,
 google_reviews integer default 0,total_washes integer default 0,member_washes integer default 0,opportunities integer default 0,basic integer default 0,good integer default 0,better integer default 0,best integer default 0,memberships_sold integer default 0,net_members integer default 0,updated_at timestamptz default now(),employee_name text,reactivations integer not null default 0,split_index integer not null default 0,plans_lost_today integer,net_members_legacy boolean not null default false,
 unique(location_id,log_date,time_slot,employee_id),unique(location_id,log_date,time_slot,split_index),check(plans_lost_today is null or plans_lost_today>=0 and time_slot='08:00:00' and split_index=0));
 alter table daily_logs enable row level security;
 create policy daily_logs_select on daily_logs for select to authenticated using(true);
 create policy daily_logs_write on daily_logs for all to authenticated using(location_id=(select location_id from user_profiles where id=auth.uid())) with check(location_id=(select location_id from user_profiles where id=auth.uid()));
 grant all on daily_logs to authenticated;
 """)
 # Production Plans Lost guard copied from the administrator-supplied inventory,
 # not the paused identity-foundation migration/fixtures.
 cur.execute("""
 create function guard_daily_plans_lost() returns trigger language plpgsql set search_path='' as $$
 declare r public.daily_logs; active_loss integer; lock_key text;
 begin
 if tg_op='DELETE' then r:=old;else r:=new;end if;
 for lock_key in select distinct v from(values(r.location_id::text||':'||r.log_date::text),(case when tg_op='UPDATE' then old.location_id::text||':'||old.log_date::text else r.location_id::text||':'||r.log_date::text end)) scopes(v) order by v loop
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key,0));end loop;
 if tg_op='UPDATE' and (old.location_id,old.log_date,old.time_slot,old.split_index) is distinct from(new.location_id,new.log_date,new.time_slot,new.split_index)
 and(old.plans_lost_today is not null or new.plans_lost_today is not null or exists(select 1 from public.daily_logs d where d.plans_lost_today is not null and ((d.location_id=old.location_id and d.log_date=old.log_date)or(d.location_id=new.location_id and d.log_date=new.log_date)))) then raise exception 'Calculated-day Daily Log identity cannot change';end if;
 if tg_op='DELETE' then if old.plans_lost_today is not null then raise exception 'Daily plans lost must be retained; set losses to zero instead';end if;return old;end if;
 select d.plans_lost_today into active_loss from public.daily_logs d where d.location_id=new.location_id and d.log_date=new.log_date and d.time_slot=time '08:00:00' and d.split_index=0;
 if tg_op='UPDATE' and old.net_members_legacy is distinct from new.net_members_legacy then raise exception 'Legacy Net Members transition requires separate approval';end if;
 if tg_op='UPDATE' and old.plans_lost_today is not null and new.plans_lost_today is null then raise exception 'Daily plans lost cannot be cleared; enter zero for no losses';end if;
 if new.plans_lost_today is not null or active_loss is not null then
 if tg_op='INSERT' then if coalesce(new.net_members,0)<>0 then raise exception 'Net Members are calculated daily; hourly manual values are not allowed';end if;
 elsif new.net_members is distinct from old.net_members then raise exception 'Historical manual Net Members must remain unchanged';end if;end if;return new;end;$$;
 create trigger guard_daily_plans_lost before insert or update or delete on daily_logs for each row execute function guard_daily_plans_lost();
 """)
 timings={}
 for file in ['20261024231853_employee_roster_permissions.sql','20261024232850_employee_roster_names_and_review.sql']:
  start=time.perf_counter();cur.execute((ROOT/'supabase/migrations'/file).read_text());timings[file]=round((time.perf_counter()-start)*1000,3)
 print(json.dumps({'database':DB,'migration_elapsed_ms':timings,'production_contacted':False}))
c.close()
