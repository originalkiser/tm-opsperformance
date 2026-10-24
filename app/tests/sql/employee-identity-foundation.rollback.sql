-- PREPARED, Authorized isolated tests only. Separately authorized disposable LOCAL database only.
-- Run in a FRESH empty test database, not after the other fixture suite.
\set ON_ERROR_STOP on
\ir employee-identity-foundation.fixture.sql
-- All-NULL synthetic baseline enables the conservative rollback. This is a test
-- fixture preparation BEFORE installing phase1, not a production backfill.
update public.daily_logs set employee_id=null;
\ir ../../supabase/migrations/20261024222502_employee_identity_foundation.sql
\ir ../../../docs/sql/employee-identity-foundation-ROLLBACK-REVIEW-ONLY.sql
do $$ begin
  if to_regprocedure('public.guard_daily_employee_assignment_phase1()') is not null
      or to_regprocedure('public.guard_employee_key_phase1()') is not null then raise exception 'Rollback left guards'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_employee_id_fkey' and cardinality(conkey)=1 and convalidated) then raise exception 'Original FK not restored'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.daily_logs'::regclass
      and conname='daily_logs_location_id_log_date_time_slot_employee_id_key' and contype='u') then raise exception 'Original unique key not restored'; end if;
  if (select count(*) from public.daily_logs)<>2 then raise exception 'Rollback changed historical row count'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.daily_logs'::regclass and tgname='guard_daily_plans_lost' and tgenabled='O') then raise exception 'Plans Lost guard changed'; end if;
end $$;
-- Refusal case (separate fresh DB): install normal fixture+forward migration,
-- run rollback expecting its non-NULL-ID exception, then verify its transaction
-- left both guards, composite FK and every source ID/name intact. ON_ERROR_STOP
-- intentionally terminates that command; the next verification uses a new session.
