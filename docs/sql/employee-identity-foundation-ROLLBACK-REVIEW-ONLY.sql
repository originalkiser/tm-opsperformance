-- ISOLATED-TEST REFERENCE ONLY. NOT A PRODUCTION RECOVERY SCRIPT.
-- Full rollback removes assignment guards, contrary to the approved production
-- disablement policy. Production recovery must retain guards and use forward repair.
-- Conservative rollback: refuses ANY non-NULL employee IDs, including IDs that
-- predate Phase 1. If those exist, review a tailored forward-repair plan instead.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

do $rollback_preconditions$
begin
  if current_database()<>'tm_identity_foundation_test' or current_user<>'identity_test_admin'
     or inet_server_addr() is not null then
    raise exception 'Full rollback is isolated-test-only; production requires guard-preserving recovery';
  end if;
  lock table public.employees, public.daily_logs in access exclusive mode;
  if exists(select 1 from public.daily_logs where employee_id is not null) then
    raise exception 'Non-NULL employee IDs exist: preserve them and review forward repair; no automatic rollback';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_employee_id_fkey' and contype='f' and convalidated
      and pg_catalog.obj_description(oid,'pg_constraint')='employee-identity-foundation/phase1-v1: same-location existing FK') then
    raise exception 'Expected Phase 1 FK marker and validated state';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_location_id_log_date_time_slot_split_index_key' and contype='u' and convalidated)
     or exists(select 1 from pg_catalog.pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_location_id_log_date_time_slot_employee_id_key') then
    raise exception 'Checkpoint/legacy uniqueness drift: manual review required';
  end if;
  if pg_catalog.obj_description(pg_catalog.to_regprocedure('public.guard_daily_employee_assignment_phase1()'),'pg_proc')
       is distinct from 'employee-identity-foundation/phase1-v1'
     or pg_catalog.obj_description(pg_catalog.to_regprocedure('public.guard_employee_key_phase1()'),'pg_proc')
       is distinct from 'employee-identity-foundation/phase1-v1' then
    raise exception 'Phase 1 guard markers missing/changed';
  end if;
  if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.guard_daily_employee_assignment_phase1()') and not prosecdef and pg_catalog.md5(prosrc)='daae2cf878d10072a4e2cd96483c175d')
     or not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.guard_employee_key_phase1()') and not prosecdef and pg_catalog.md5(prosrc)='bc4c80f204725bae16a2eb51834cba78') then
    raise exception 'Guard implementation drift: separately reviewed forward repair required';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.daily_logs'::regclass
      and tgname='guard_daily_employee_assignment_phase1' and not tgisinternal and tgenabled='O'
      and tgfoid=pg_catalog.to_regprocedure('public.guard_daily_employee_assignment_phase1()'))
     or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.employees'::regclass
      and tgname='guard_employee_key_phase1' and not tgisinternal and tgenabled='O'
      and tgfoid=pg_catalog.to_regprocedure('public.guard_employee_key_phase1()')) then
    raise exception 'Phase 1 trigger drift: no blind rollback';
  end if;
end;
$rollback_preconditions$;

-- Do not CASCADE. Any later dependency must stop this rollback.
drop trigger guard_daily_employee_assignment_phase1 on public.daily_logs;
drop trigger guard_employee_key_phase1 on public.employees;
drop function public.guard_daily_employee_assignment_phase1();
drop function public.guard_employee_key_phase1();
alter table public.daily_logs drop constraint daily_logs_employee_id_fkey restrict;
alter table public.daily_logs add constraint daily_logs_employee_id_fkey
  foreign key (employee_id) references public.employees(id)
  on update no action on delete no action;
alter table public.daily_logs add constraint daily_logs_location_id_log_date_time_slot_employee_id_key
  unique (location_id,log_date,time_slot,employee_id);
drop index public.daily_logs_location_employee_phase1_idx;
alter table public.employees drop constraint employees_location_id_id_phase1_key restrict;
-- Existing UUID columns, rows, snapshots, checkpoint key, RLS/grants, views,
-- audit data and guard_daily_plans_lost remain in place.
commit;
