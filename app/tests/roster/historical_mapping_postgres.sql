-- DESTRUCTIVE DISPOSABLE TEST FIXTURE ONLY. NEVER run in Supabase/production.
-- psql -X -v ON_ERROR_STOP=1 -h /private/tmp/<local-socket> \
--   -d tm_employee_mapping_test -f app/tests/roster/historical_mapping_postgres.sql
-- Requires an empty disposable PostgreSQL 17 database and local superuser.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'tm_employee_mapping_test' OR inet_server_addr() IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') THEN
    RAISE EXCEPTION 'Only an empty, local-socket tm_employee_mapping_test database is permitted';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE locations(id uuid primary key);
CREATE TABLE user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz);
CREATE TABLE manager_locations(manager_id uuid,location_id uuid);
CREATE TABLE employees(id uuid primary key,location_id uuid,name text,is_active boolean);
CREATE TABLE daily_logs(id uuid primary key,location_id uuid,log_date date,employee_name text,employee_id uuid,basic int);
INSERT INTO locations VALUES ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
INSERT INTO auth.users VALUES ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002'),('20000000-0000-0000-0000-000000000003'),('20000000-0000-0000-0000-000000000004');
INSERT INTO user_profiles VALUES
('20000000-0000-0000-0000-000000000001','admin',NULL,true,NULL),
('20000000-0000-0000-0000-000000000002','store','10000000-0000-0000-0000-000000000001',true,NULL),
('20000000-0000-0000-0000-000000000003','store','10000000-0000-0000-0000-000000000002',true,NULL),
('20000000-0000-0000-0000-000000000004','store','10000000-0000-0000-0000-000000000001',false,NULL);
INSERT INTO employees VALUES
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Official',true),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other',true);
INSERT INTO daily_logs VALUES
('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-01-01','Alias',NULL,2),
('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','2026-01-02','Alias',NULL,3);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_read ON user_profiles FOR SELECT TO authenticated USING(id=auth.uid());
GRANT SELECT ON user_profiles,employees TO authenticated;
CREATE TEMP TABLE originals AS SELECT (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM daily_logs d) AS logs,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM employees e) AS roster;
\ir ../../supabase/migrations/20261027140000_historical_employee_name_mappings.sql
CREATE FUNCTION pg_temp.check_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN actual:=SQLSTATE; END;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Expected %, got %: %',expected,actual,statement; END IF;
END $$;
GRANT USAGE ON SCHEMA pg_temp TO authenticated,anon;
-- Role/assignment, protected decisions, cross-location target and direct-write checks.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.check_true(can_propose_employee_mapping('10000000-0000-0000-0000-000000000001'),'Store own location');
SELECT pg_temp.check_true(NOT can_propose_employee_mapping('10000000-0000-0000-0000-000000000002'),'Store cross-location denied');
SELECT pg_temp.expect_error($q$SELECT change_employee_name_mapping('propose','10000000-0000-0000-0000-000000000002',NULL,NULL,'Alias','30000000-0000-0000-0000-000000000002',NULL,NULL,'Evidence',true)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT change_employee_name_mapping('approve','10000000-0000-0000-0000-000000000001',NULL,1,'Alias','30000000-0000-0000-0000-000000000001',NULL,NULL,'Evidence',true)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT change_employee_name_mapping('propose','10000000-0000-0000-0000-000000000001',NULL,NULL,'Alias','30000000-0000-0000-0000-000000000002',NULL,NULL,'Evidence',true)$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT change_employee_name_mapping('propose','10000000-0000-0000-0000-000000000001',NULL,NULL,'Alias','30000000-0000-0000-0000-000000000001',NULL,NULL,'Evidence',false)$q$,'22023');
SELECT pg_temp.expect_error($q$INSERT INTO employee_name_mappings(id) VALUES(gen_random_uuid())$q$,'42501');
SELECT pg_temp.expect_error($q$DELETE FROM employee_name_mapping_audit$q$,'42501');
SELECT (change_employee_name_mapping('propose','10000000-0000-0000-0000-000000000001',NULL,NULL,'Alias','30000000-0000-0000-0000-000000000001',NULL,'2026-01-01','Verified first date',true)).id AS mapping_id \gset
COMMIT;
-- Another Store cannot see proposal/evidence/audit even with company reporting.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.check_true((SELECT count(*)=0 FROM employee_name_mappings),'Cross-location proposals hidden');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM employee_name_mapping_audit),'Cross-location audit hidden');
SELECT pg_temp.check_true(approved_employee_name_mappings(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])='[]'::jsonb,'Unapproved proposals not reported');
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.check_true(NOT can_propose_employee_mapping('10000000-0000-0000-0000-000000000001'),'Inactive user denied');
SELECT pg_temp.expect_error($q$SELECT approved_employee_name_mappings(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])$q$,'42501');
ROLLBACK;
-- Approve, optimistic concurrency, lock, audited correction and revocation.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
SELECT change_employee_name_mapping('approve','10000000-0000-0000-0000-000000000001',:'mapping_id',1,'Alias',NULL,NULL,NULL,'Reviewed evidence',true);
SELECT pg_temp.expect_error(format($q$SELECT change_employee_name_mapping('lock','10000000-0000-0000-0000-000000000001',%L,1,'Alias',NULL,NULL,NULL,'Stale',true)$q$,:'mapping_id'),'40001');
SELECT change_employee_name_mapping('lock','10000000-0000-0000-0000-000000000001',:'mapping_id',2,'Alias',NULL,NULL,NULL,'Lock verified identity',true);
SELECT change_employee_name_mapping('correct','10000000-0000-0000-0000-000000000001',:'mapping_id',3,'Alias','30000000-0000-0000-0000-000000000001',NULL,'2026-01-01','Corrected evidence',true);
SELECT pg_temp.check_true((SELECT status='locked' AND version=4 FROM employee_name_mappings WHERE id=:'mapping_id'),'Correction preserves lock');
SELECT (change_employee_name_mapping('propose','10000000-0000-0000-0000-000000000001',NULL,NULL,'Alias','30000000-0000-0000-0000-000000000001','2026-01-02',NULL,'Separate date evidence',true)).id AS second_id \gset
SELECT change_employee_name_mapping('approve','10000000-0000-0000-0000-000000000001',:'second_id',1,'Alias',NULL,NULL,NULL,'Approved separate dates',true);
SELECT (change_employee_name_mapping('propose','10000000-0000-0000-0000-000000000001',NULL,NULL,'Alias','30000000-0000-0000-0000-000000000001',NULL,NULL,'Overlapping proposal',true)).id AS overlap_id \gset
SELECT pg_temp.expect_error(format($q$SELECT change_employee_name_mapping('approve','10000000-0000-0000-0000-000000000001',%L,1,'Alias',NULL,NULL,NULL,'Overlap must fail',true)$q$,:'overlap_id'),'23P01');
SELECT change_employee_name_mapping('reject','10000000-0000-0000-0000-000000000001',:'mapping_id',4,'Alias',NULL,NULL,NULL,'Identity now ambiguous; revoke locked decision',false);
SELECT pg_temp.check_true((SELECT count(*)=8 FROM employee_name_mapping_audit),'Every committed decision has one audit event; failed overlap has none');
COMMIT;
SELECT pg_temp.check_true((SELECT logs=(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM daily_logs d) AND roster=(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM employees e) FROM originals),'Original roster and Daily Logs byte-preserved');
-- Approved report payload contains no private evidence/audit fields.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.check_true(jsonb_array_length(approved_employee_name_mappings(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[]))=1,'Company report approved interpretation visible');
SELECT pg_temp.check_true(NOT ((approved_employee_name_mappings(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])->0) ? 'note'),'Evidence remains private');
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT approved_employee_name_mappings(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])$q$,'42501');
ROLLBACK;
SELECT 'PASS: synthetic mapping SQL checks' AS result;
-- Also run a two-connection probe before deployment: concurrent approvals for
-- the same location/name/date must serialize and only one may commit. This
-- single-connection fixture does not establish concurrency behavior by itself.
