-- SYNTHETIC FIXTURE ONLY. NOT EXECUTED. Never run in SQL Editor/production.
-- Requires a separately authorized, disposable LOCAL database named exactly
-- tm_identity_foundation_test, an empty public application schema and the
-- anon/authenticated/service_role test roles. No real employee data is used.
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'tm_identity_foundation_test'
     or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
    raise exception 'Disposable LOCAL identity test database required';
  end if;
  if to_regclass('public.employees') is not null or to_regclass('public.daily_logs') is not null then
    raise exception 'Empty fixture database required; never replace existing application tables';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role'))<>3 then
    raise exception 'Pre-provision isolated test API roles';
  end if;
end $$;
create table public.locations(id uuid primary key);
create table public.employees(id uuid primary key,location_id uuid not null references public.locations(id),name text not null,is_active boolean default true);
create table public.daily_logs(
  id uuid primary key, location_id uuid not null references public.locations(id),
  employee_id uuid references public.employees(id), log_date date not null,
  time_slot time not null, employee_name text, split_index integer not null default 0,
  total_washes integer default 0,member_washes integer default 0,
  basic integer default 0,good integer default 0,better integer default 0,best integer default 0,
  net_members integer default 0,plans_lost_today integer,net_members_legacy boolean not null default false,
  constraint daily_logs_location_id_log_date_time_slot_employee_id_key unique(location_id,log_date,time_slot,employee_id),
  constraint daily_logs_location_id_log_date_time_slot_split_index_key unique(location_id,log_date,time_slot,split_index)
);
alter table public.employees enable row level security;
alter table public.daily_logs enable row level security;
-- Limited synthetic scopes make it possible to verify that phase1 guards never
-- grant location access. Live broad policies/helpers require separate RLS tests.
create policy fixture_read_employees on public.employees for select to authenticated using(true);
create policy fixture_read_logs on public.daily_logs for select to authenticated using(true);
create policy fixture_write_logs on public.daily_logs for all to authenticated
 using(location_id='10000000-0000-0000-0000-000000000001'::uuid)
 with check(location_id='10000000-0000-0000-0000-000000000001'::uuid);
grant usage on schema public to authenticated;
grant select on public.employees to authenticated;
grant select,insert,update,delete on public.daily_logs to authenticated;
insert into public.locations values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.employees values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Cam',true),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Cam',true);
insert into public.daily_logs(id,location_id,employee_id,log_date,time_slot,employee_name,total_washes,best) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null,'2026-10-20','08:00','Cam',100,10),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-21','08:00','Original name',100,10);

-- Existing production guard body from the previously reviewed source.
create or replace function public.guard_daily_plans_lost() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare r public.daily_logs; active_loss integer; lock_key text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- Lock both scopes in deterministic order for permitted legacy record moves.
  for lock_key in select distinct v from (values
    (r.location_id::text || ':' || r.log_date::text),
    (case when tg_op='UPDATE' then old.location_id::text || ':' || old.log_date::text
      else r.location_id::text || ':' || r.log_date::text end)) scopes(v) order by v loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key,0));
  end loop;
  if tg_op = 'UPDATE' and (old.location_id, old.log_date, old.time_slot, old.split_index)
      is distinct from (new.location_id, new.log_date, new.time_slot, new.split_index)
      and (old.plans_lost_today is not null or new.plans_lost_today is not null or exists (
        select 1 from public.daily_logs d where d.plans_lost_today is not null
          and ((d.location_id=old.location_id and d.log_date=old.log_date)
            or (d.location_id=new.location_id and d.log_date=new.log_date)))) then
    raise exception 'Calculated-day Daily Log identity cannot change';
  end if;
  if tg_op = 'DELETE' then
    if old.plans_lost_today is not null then
      raise exception 'Daily plans lost must be retained; set losses to zero instead';
    end if;
    return old;
  end if;
  select d.plans_lost_today into active_loss from public.daily_logs d
    where d.location_id = new.location_id and d.log_date = new.log_date
      and d.time_slot = time '08:00:00' and d.split_index = 0;
  if tg_op = 'UPDATE' and old.net_members_legacy is distinct from new.net_members_legacy then
    raise exception 'Legacy Net Members transition requires separate approval';
  end if;
  if tg_op = 'UPDATE' and old.plans_lost_today is not null and new.plans_lost_today is null then
    raise exception 'Daily plans lost cannot be cleared; enter zero for no losses';
  end if;
  -- Explicit daily-loss entry adopts the daily calculation without rewriting
  -- any historical manual Net Members or the immutable legacy marker.
  if new.plans_lost_today is not null or active_loss is not null then
    if tg_op = 'INSERT' then
      if coalesce(new.net_members,0) <> 0 then
        raise exception 'Net Members are calculated daily; hourly manual values are not allowed';
      end if;
    elsif new.net_members is distinct from old.net_members then
      raise exception 'Historical manual Net Members must remain unchanged';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_daily_plans_lost before insert or update or delete on public.daily_logs for each row execute function public.guard_daily_plans_lost();
create table public.fixture_before as select jsonb_agg(to_jsonb(d) order by id) as logs from public.daily_logs d;
create table public.fixture_policies as select jsonb_agg(to_jsonb(p) order by tablename,policyname) as policies from pg_policies p where schemaname='public' and tablename in ('employees','daily_logs');
