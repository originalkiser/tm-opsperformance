-- REVIEW ONLY: do not apply without separate migration authorization.
-- Reuses production's UUID employee_id and strengthens its EXISTING named FK.
-- No backfill, roster mutation, RLS replacement, scoring or writer enablement.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Fence both relations while checking/replacing keys. A timeout aborts everything.
-- Explicitly review maintenance timing; this is NOT a lock-free migration.
lock table public.employees, public.daily_logs in access exclusive mode;

do $preconditions$
declare
  e_id smallint; e_site smallint;
  d_site smallint; d_employee smallint; d_date smallint; d_time smallint; d_split smallint;
begin
  if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('employees','daily_logs')
        and c.relkind='r' and c.relrowsecurity) <> 2 then
    raise exception 'Expected ordinary employees/daily_logs tables with RLS enabled; inspect schema drift';
  end if;
  select attnum into e_id from pg_catalog.pg_attribute where attrelid='public.employees'::regclass and attname='id' and atttypid='uuid'::regtype and attnotnull and not attisdropped;
  select attnum into e_site from pg_catalog.pg_attribute where attrelid='public.employees'::regclass and attname='location_id' and atttypid='uuid'::regtype and attnotnull and not attisdropped;
  select attnum into d_site from pg_catalog.pg_attribute where attrelid='public.daily_logs'::regclass and attname='location_id' and atttypid='uuid'::regtype and attnotnull and not attisdropped;
  select attnum into d_employee from pg_catalog.pg_attribute where attrelid='public.daily_logs'::regclass and attname='employee_id' and atttypid='uuid'::regtype and not attnotnull and not attisdropped;
  select attnum into d_date from pg_catalog.pg_attribute where attrelid='public.daily_logs'::regclass and attname='log_date' and atttypid='date'::regtype and attnotnull and not attisdropped;
  select attnum into d_time from pg_catalog.pg_attribute where attrelid='public.daily_logs'::regclass and attname='time_slot' and atttypid='time'::regtype and attnotnull and not attisdropped;
  select attnum into d_split from pg_catalog.pg_attribute where attrelid='public.daily_logs'::regclass and attname='split_index' and atttypid='integer'::regtype and attnotnull and not attisdropped;
  if e_id is null or e_site is null or d_site is null or d_employee is null or d_date is null or d_time is null or d_split is null then
    raise exception 'Verified production column contract does not match; no column will be created';
  end if;
  if exists(select 1 from pg_catalog.pg_attrdef where adrelid='public.daily_logs'::regclass and adnum=d_employee) then
    raise exception 'employee_id must retain its verified NULL default';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.employees'::regclass
      and conname='employees_pkey' and contype='p' and conkey=array[e_id] and convalidated) then
    raise exception 'Expected employees UUID primary key';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_employee_id_fkey' and contype='f' and conkey=array[d_employee]
      and confrelid='public.employees'::regclass and confkey=array[e_id]
      and convalidated and not condeferrable and confmatchtype='s'
      and confupdtype='a' and confdeltype='a') then
    raise exception 'Expected original employee FK; stop on missing, changed or already-applied foundation';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_location_id_log_date_time_slot_employee_id_key' and contype='u'
      and conkey=array[d_site,d_date,d_time,d_employee] and convalidated and not condeferrable) then
    raise exception 'Expected original employee-based uniqueness constraint';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_location_id_log_date_time_slot_split_index_key' and contype='u'
      and conkey=array[d_site,d_date,d_time,d_split] and convalidated and not condeferrable) then
    raise exception 'Current split-index upsert conflict target must remain present';
  end if;
  if exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname in ('daily_logs_employee_id_fkey','daily_logs_location_id_log_date_time_slot_employee_id_key')
      and pg_catalog.obj_description(oid,'pg_constraint') is not null) then
    raise exception 'Original constraint comments require an explicitly preserving migration/rollback revision';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.daily_logs'::regclass
      and tgname='guard_daily_plans_lost' and not tgisinternal and tgenabled='O'
      and tgfoid=pg_catalog.to_regprocedure('public.guard_daily_plans_lost()')) then
    raise exception 'Verified Plans Lost guard missing/changed; inspect before migration';
  end if;
  if pg_catalog.to_regprocedure('public.guard_daily_employee_assignment_phase1()') is not null
     or pg_catalog.to_regprocedure('public.guard_employee_key_phase1()') is not null
     or pg_catalog.to_regclass('public.employees_location_id_id_phase1_key') is not null
     or pg_catalog.to_regclass('public.daily_logs_location_employee_phase1_idx') is not null
     or exists(select 1 from pg_catalog.pg_trigger where not tgisinternal
       and tgname in ('guard_daily_employee_assignment_phase1','guard_employee_key_phase1')
       and tgrelid in ('public.employees'::regclass,'public.daily_logs'::regclass)) then
    raise exception 'Foundation objects already exist; do not overwrite or blindly re-run';
  end if;
end;
$preconditions$;

-- ID is globally unique already; this key supports the composite same-site FK.
alter table public.employees add constraint employees_location_id_id_phase1_key
  unique (location_id, id);

-- Replace the definition transactionally under the SAME FK name. No parallel FK
-- and no unconstrained commit window. Existing same-site ID rows remain untouched.
alter table public.daily_logs drop constraint daily_logs_employee_id_fkey restrict;
alter table public.daily_logs add constraint daily_logs_employee_id_fkey
  foreign key (location_id, employee_id) references public.employees(location_id, id)
  match simple on update restrict on delete restrict not valid;
-- Fail, rather than repair, any pre-existing orphan/cross-site reference anywhere.
alter table public.daily_logs validate constraint daily_logs_employee_id_fkey;
comment on constraint daily_logs_employee_id_fkey on public.daily_logs
  is 'employee-identity-foundation/phase1-v1: same-location existing FK';

create index daily_logs_location_employee_phase1_idx
  on public.daily_logs(location_id, employee_id) where employee_id is not null;

-- The checkpoint key is authoritative. The older key would reject the same
-- employee in two splits of one hour. RESTRICT refuses unknown dependents.
alter table public.daily_logs
  drop constraint daily_logs_location_id_log_date_time_slot_employee_id_key restrict;

create function public.guard_daily_employee_assignment_phase1() returns trigger
language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op='INSERT' then
    if new.employee_id is not null then
      raise exception 'Employee ID assignments are disabled pending reviewed writer authorization'
        using errcode='23514';
    end if;
  elsif new.employee_id is distinct from old.employee_id then
    -- Also reject clearing/reassigning an existing ID; do not erase attribution.
    raise exception 'Employee ID changes are disabled pending reviewed writer authorization'
      using errcode='23514';
  end if;
  return new;
end;
$function$;
comment on function public.guard_daily_employee_assignment_phase1()
  is 'employee-identity-foundation/phase1-v1';
revoke all on function public.guard_daily_employee_assignment_phase1() from public, anon, authenticated, service_role;
create trigger guard_daily_employee_assignment_phase1
  before insert or update on public.daily_logs for each row
  execute function public.guard_daily_employee_assignment_phase1();

create function public.guard_employee_key_phase1() returns trigger
language plpgsql security invoker set search_path = '' as $function$
begin
  if new.id is distinct from old.id or new.location_id is distinct from old.location_id then
    raise exception 'Employee UUID and location are permanent identity keys'
      using errcode='23514';
  end if;
  return new;
end;
$function$;
comment on function public.guard_employee_key_phase1()
  is 'employee-identity-foundation/phase1-v1';
revoke all on function public.guard_employee_key_phase1() from public, anon, authenticated, service_role;
create trigger guard_employee_key_phase1
  before update on public.employees for each row
  execute function public.guard_employee_key_phase1();

-- Deliberately no role exceptions, enablement flags, SECURITY DEFINER, RPC,
-- table grants, RLS replacements, name mapping or historical data mutations.
commit;
