-- REVIEWED READ-ONLY INVENTORY. Administrator executed the three SELECT steps
-- separately in confirmed production on 2026-10-24; results documented in
-- docs/employee-identity-phase1-validation.md. This file is not a migration.
-- Confirm project before every execution. Global aggregate scope requires approval.
-- SQL Editor: execute ONE numbered SELECT at a time; capture its result before
-- proceeding. No names, employee IDs, individual activity or sales are returned.
-- For an admin client supporting multiple result sets, use this READ ONLY wrapper.
-- Stop on error/timeout; do not widen limits. The final ROLLBACK may hide results
-- in SQL Editor; select only the numbered query for that workflow.
begin transaction isolation level repeatable read read only;
set local statement_timeout='15s';
set local lock_timeout='2s';

-- 1. Catalog metadata; no application rows.
SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'execution_role', current_user,
  'migration_ledger', to_regclass('supabase_migrations.schema_migrations'),
  'ledger_columns', (
    SELECT jsonb_agg(jsonb_build_object('column', a.attname,
      'type', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('supabase_migrations.schema_migrations')
      AND a.attnum > 0 AND NOT a.attisdropped
  ),
  'tables', (
    SELECT jsonb_agg(jsonb_build_object('table', c.relname,
      'estimated_rows', c.reltuples, 'total_bytes', pg_total_relation_size(c.oid),
      'rls_enabled', c.relrowsecurity) ORDER BY c.relname)
    FROM pg_class c
    WHERE c.oid IN ('public.employees'::regclass, 'public.daily_logs'::regclass)
  ),
  'indexes', (
    SELECT jsonb_agg(jsonb_build_object('table', c.relname,
      'valid', i.indisvalid, 'ready', i.indisready,
      'definition', pg_get_indexdef(i.indexrelid)) ORDER BY c.relname, i.indexrelid)
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.oid IN ('public.employees'::regclass, 'public.daily_logs'::regclass)
  )
) AS preflight_metadata;

-- 2. Global ID integrity aggregates, only after global scope authorization.
WITH ids AS MATERIALIZED (
  SELECT location_id, employee_id FROM public.daily_logs WHERE employee_id IS NOT NULL
), references_checked AS (
  SELECT i.location_id AS log_location, e.id AS referenced_employee,
         e.location_id AS employee_location
  FROM ids i LEFT JOIN public.employees e ON e.id = i.employee_id
)
SELECT jsonb_build_object(
  'employee_rows', (SELECT count(*) FROM public.employees),
  'daily_log_rows', (SELECT count(*) FROM public.daily_logs),
  'global_nonnull_ids', (SELECT count(*) FROM ids),
  'global_null_ids', (SELECT count(*) FROM public.daily_logs WHERE employee_id IS NULL),
  'missing_employee_references', (SELECT count(*) FROM references_checked WHERE referenced_employee IS NULL),
  'cross_location_references', (SELECT count(*) FROM references_checked
    WHERE referenced_employee IS NOT NULL AND log_location IS DISTINCT FROM employee_location),
  'employee_hour_duplicate_groups', (SELECT count(*) FROM (
    SELECT location_id, log_date, time_slot, employee_id FROM public.daily_logs
    WHERE employee_id IS NOT NULL GROUP BY location_id, log_date, time_slot, employee_id
    HAVING count(*) > 1
  ) duplicate_groups)
) AS global_identity_preflight;

-- 3. Catalog constraint definitions/comments, no application rows.
SELECT jsonb_agg(jsonb_build_object(
  'table', c.conrelid::regclass::text, 'name', c.conname,
  'definition', pg_get_constraintdef(c.oid), 'validated', c.convalidated,
  'deferrable', c.condeferrable, 'initially_deferred', c.condeferred,
  'comment', obj_description(c.oid, 'pg_constraint')
) ORDER BY c.conrelid::regclass::text, c.conname) AS constraint_preflight
FROM pg_constraint c
WHERE c.conrelid IN ('public.employees'::regclass, 'public.daily_logs'::regclass);
rollback;
