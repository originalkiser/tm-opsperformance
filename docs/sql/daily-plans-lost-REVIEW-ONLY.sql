-- REVIEW ONLY — not installed. Install and verify in an isolated database before
-- approving production migration, then deploy the application. No backfill.
-- Additive Daily Log storage reuses all existing grants, RLS and audit triggers.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.daily_logs in access exclusive mode;
do $pre$
begin
  if current_user <> 'postgres' then raise exception 'postgres installer required'; end if;
  if not exists(select 1 from pg_class where oid='public.daily_logs'::regclass and relrowsecurity) then
    raise exception 'Daily Log RLS must already be enabled';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.daily_logs'::regclass and contype='u'
    and pg_get_constraintdef(oid)='UNIQUE (location_id, log_date, time_slot, split_index)') then
    raise exception 'Expected four-column Daily Log unique constraint missing';
  end if;
  perform set_config('tm_ops.plans_rows_before',(select md5(coalesce(jsonb_agg(to_jsonb(d) order by id)::text,'null')) from public.daily_logs d),true);
  perform set_config('tm_ops.plans_policies_before',(select md5(coalesce(jsonb_agg(to_jsonb(p) order by policyname)::text,'null')) from pg_policies p where schemaname='public' and tablename='daily_logs'),true);
  perform set_config('tm_ops.plans_acl_before',(select coalesce(relacl::text,'') from pg_class where oid='public.daily_logs'::regclass),true);
end;
$pre$;
alter table public.daily_logs add column plans_lost_today integer;
-- Metadata-only default protects all existing manual records, including zero,
-- without an UPDATE/backfill that would alter audit history.
alter table public.daily_logs add column net_members_legacy boolean not null default true;
alter table public.daily_logs alter column net_members_legacy set default false;
alter table public.daily_logs add constraint daily_logs_plans_lost_once check (
  plans_lost_today is null or
  (plans_lost_today >= 0 and time_slot = time '08:00:00' and split_index = 0)
);
comment on column public.daily_logs.plans_lost_today is
  'Daily losses once per location/date on 08:00 split 0. NULL means unknown/legacy; 0 is explicit zero. Never sum cumulative sales.';

-- Serialize changes within each location/day, including old-client writes.
-- Invoker security: no grants, policies or role helpers changed.
create function public.guard_daily_plans_lost() returns trigger
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
  if new.plans_lost_today is not null and (new.net_members_legacy or exists (
    select 1 from public.daily_logs d where d.location_id = new.location_id
      and d.log_date = new.log_date and (d.net_members_legacy or d.net_members <> 0)
  )) then
    raise exception 'Historical manual Net Members require an approved transition plan';
  end if;
  if (new.plans_lost_today is not null or active_loss is not null) and new.net_members <> 0 then
    raise exception 'Net Members are calculated daily; hourly manual values are not allowed';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_daily_plans_lost() from public, anon, authenticated;
create trigger guard_daily_plans_lost before insert or update or delete on public.daily_logs
  for each row execute function public.guard_daily_plans_lost();
do $verify$
begin
  if exists(select 1 from public.daily_logs where plans_lost_today is not null or not net_members_legacy) then
    raise exception 'Historical rows changed during installation';
  end if;
  if (select md5(coalesce(jsonb_agg(to_jsonb(d)-'plans_lost_today'-'net_members_legacy' order by id)::text,'null')) from public.daily_logs d)
    <> current_setting('tm_ops.plans_rows_before') then raise exception 'Historical Daily Log data changed'; end if;
  if (select md5(coalesce(jsonb_agg(to_jsonb(p) order by policyname)::text,'null')) from pg_policies p where schemaname='public' and tablename='daily_logs')
    <> current_setting('tm_ops.plans_policies_before') then raise exception 'Daily Log RLS policies changed'; end if;
  if (select coalesce(relacl::text,'') from pg_class where oid='public.daily_logs'::regclass)
    <> current_setting('tm_ops.plans_acl_before') then raise exception 'Daily Log grants changed'; end if;
end;
$verify$;
commit;
