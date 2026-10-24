-- PREPARED ONLY; NOT EXECUTED. Separate authorization required for GLOBAL counts.
-- The previously approved Carencro/date scope does NOT authorize this scan.
-- Operator must confirm production project, database version, baseline schema,
-- migration ledger and all external writers before proceeding. No row IDs/names.
begin transaction isolation level repeatable read read only;
set local statement_timeout='15s';
set local lock_timeout='2s';
select jsonb_build_object(
  'server_version',current_setting('server_version'),
  'read_only',current_setting('transaction_read_only'),
  'employee_rows',(select count(*) from public.employees),
  'daily_log_rows',(select count(*) from public.daily_logs),
  'global_nonnull_ids',(select count(*) from public.daily_logs where employee_id is not null),
  'cross_site_or_missing_references',(select count(*) from public.daily_logs d
    where d.employee_id is not null and not exists(select 1 from public.employees e where e.id=d.employee_id and e.location_id=d.location_id)),
  'employees_bytes',pg_total_relation_size('public.employees'),
  'daily_logs_bytes',pg_total_relation_size('public.daily_logs'),
  'migration_ledger',to_regclass('supabase_migrations.schema_migrations')
) as foundation_preflight;
rollback;
-- A SQL Editor may expose only the final result; capture the SELECT result using
-- an approved admin client that retains result sets. Never remove safety clauses
-- merely to work around an export issue. Stop on timeout; do not auto-widen limits.
