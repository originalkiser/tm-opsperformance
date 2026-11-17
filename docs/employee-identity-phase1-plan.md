# Phase 1 employee identity foundation — draft implementation

Status: draft, pre-deployment validation only. The administrator executed approved
read-only production inventory. Candidate SQL was executed only in an authorized
isolated synthetic PostgreSQL database. No production mutation, backfill, merge,
deployment or ID enablement occurred. Production execution remains withheld.

## Verified inventory and corrected foundation

The administrator confirmed production tm-opsperformance and supplied metadata
from its SQL Editor. Production already contains daily_logs.employee_id UUID NULL
and validated daily_logs_employee_id_fkey -> employees(id), with default NO ACTION
and no deferral shown. employees has only id, location_id, name and is_active;
there is no created_at column. Do not run the obsolete inventory query requesting
that field. The following live keys were supplied:

- employees_pkey(id), employees_location_id_fkey -> locations(id).
- daily_logs_employee_id_fkey(employee_id) -> employees(id).
- daily_logs_location_id_log_date_time_slot_employee_id_key UNIQUE
  (location_id, log_date, time_slot, employee_id).
- daily_logs_location_id_log_date_time_slot_split_index_key UNIQUE
  (location_id, log_date, time_slot, split_index), the application's upsert target.
- Existing daily-log primary/location keys and Plans Lost CHECK remain unchanged.

Both tables have RLS enabled. The supplied policies include broad authenticated
reads, role-only employee writes and legacy helpers without active/deleted checks.
The audit table allows client inserts and has no returned verification trigger.
Those facts do not establish trustworthy identity-change audit or the desired
manager scope. This PR does not alter those existing authorization rules or claim
to repair them; the separately reviewed writer must supply appropriate controls.
New guard functions are invoker functions, not privileged reporting/mutation RPCs.

The existing guard_daily_plans_lost protects calculated days and historical Net
Members. daily_logs_computed and monthly_rollup already reference employee_id,
with security_invoker=true; retain their definitions, grants and numeric formulas.

Accepted scoped evidence, October 1–24, 2026, 1527-Carencro: seven active Cam roster
records; 305 checkpoints, all with NULL employee_id; 296 named and nine unnamed;
three Cam-name checkpoints, all NULL IDs; none referencing a Cam roster UUID.
This does not establish global ID coverage or prove the seven names are one person.
No production employee/log UUIDs or individual data are committed as test fixtures.

## Scope and SQL design

Forward candidate:
`app/supabase/migrations/20261024222502_employee_identity_foundation.sql`.
The official Supabase CLI generated the empty local filename; no database/link/
push/pull/reset/repair command was run. The repository has legacy numbered scripts,
not a verified timestamped baseline: do not assume this folder is safe to push
against an unknown remote migration ledger.

The migration:
1. Starts one transaction with 2s lock_timeout and 15s statement_timeout; locks
   employees then daily_logs in ACCESS EXCLUSIVE mode. Preconditions verify the
   known column/key/trigger/RLS shape and refuse conflicts or reapplication.
2. Reuses employee_id, employees.id and the existing FK name. Adds only the parent
   UNIQUE(location_id,id) support key and an ID lookup index.
3. Replaces daily_logs_employee_id_fkey under its SAME name with a composite
   (location_id,employee_id) -> employees(location_id,id) FK, MATCH SIMPLE,
   ON UPDATE/DELETE RESTRICT. The original standalone FK is not retained as a
   duplicate. Because PostgreSQL cannot change an FK's columns in place, this is
   a transactional DROP/ADD under locks. The new FK is validated before commit;
   any existing cross-site/invalid relationship aborts rather than repairs data.
4. Removes only the obsolete employee-based unique constraint using RESTRICT.
   Keeps the split-index key unchanged. The old key would prevent the same
   employee from appearing twice in one hour at different split indices; it is
   incompatible with future ID-based split entry. This is an intentional reviewed
   constraint replacement, not a purely additive rollout.
5. Adds an INSERT/UPDATE guard: reject non-NULL IDs on inserts, and ANY ID change
   on updates, including reassignment or clearing. Unchanged preexisting IDs can
   survive metric-only updates. NULL-to-NULL/name-only operations remain allowed.
   There is no Admin/service-role exception, RPC enablement or client-settable flag.
6. Adds an UPDATE guard freezing employee UUID and location. It performs no rename,
   status, merge or record update. Existing roster create/delete/name/status flows
   are not implemented or rewritten by this SQL; referenced employee deletion is
   constrained by the FK as before, with stronger same-location integrity.

The guards use empty search_path and SECURITY INVOKER. EXECUTE is revoked only on
these NEW trigger functions; existing table grants, policies and helpers are not
rewritten. Trigger invocation does not provide an alternative authorized writer.
Owner-level trigger disabling, replication bypass or superuser writes are not
supported client workflows; inventory them before rollout. Re-enabling ID writes
requires a separately reviewed migration plus compatible audited application code.

## Operation and reporting compatibility

The two DailyLogTable save paths and dailyMemberships anchor save use the preserved
split-index conflict target. No repository writer uses the employee-based key or
sets employee_id. External tools, older releases, imports and offline queues are
not certified by this repository search. They must be checked before production:
any insert/upsert explicitly sending a non-NULL ID will be refused, even when its
intent is to update an existing row; writers omitting employee_id can preserve an
existing ID through checkpoint upsert when the UPDATE list does not clear it.

Different splits remain separate checkpoints. Duplicate same-location/date/hour/
split remains forbidden, regardless of employee. Repeated days/hours and same-name
employees at different locations are not consolidated by this PR. The obsolete
key's removal enables future structural compatibility but does not enable any new
ID assignment now.

Supported historical name-based Team Member Sales reporting, qualification and
rankings remain unchanged. Unresolved identity alone cannot exclude an existing
ranked entry. Raw names and every sales/opportunity counter are untouched. There
is no ID backfill, name-to-ID inference, identity-aware reporting switch or view
rewrite. Existing numeric missing-data/correction rules still apply. Site KPI and
Budget scoring remain unchanged. Current read projections do not need new table
access or an RLS bypass.

Existing Daily Log deletions and editing validation continue under existing RLS
and the Plans Lost guard; this foundation does not secretly replace those rules
with a new attendance or archival policy. No historical names/IDs are rewritten
by a normal save in this PR. A later writer must audit deliberate attribution
changes and handle inactive/merged historical references explicitly.

## Pre-deployment validation and production blockers

See [validation evidence and maintenance/recovery procedure](employee-identity-phase1-validation.md).
The global inventory is complete: 457 employees, 24,514 logs, all employee IDs NULL,
no invalid/cross-location references or employee-hour duplicate groups. PostgreSQL
17.6; all four existing indexes valid/ready; known constraints validated,
non-deferrable, with NULL comments. These are point-in-time results, not an
execution authorization or guarantee against later changes.

No supabase_migrations.schema_migrations relation exists. Do not push, pull, repair
or create a ledger as an inventory shortcut. Production needs a separately approved
exact-SQL execution mechanism and durable external execution record, or a separate
baseline adoption plan. Neither has been executed.

The forward migration remains unchanged. Its 2s lock timeout bounds lock acquisition;
15s statement timeout is per statement, NOT a whole-transaction deadline. It builds
indexes/validates under ACCESS EXCLUSIVE locks. Use a maintenance window and the
recovery procedure; do not silently extend limits or leave constraints unvalidated.

The full rollback SQL is now restricted to the disposable test database/admin and
Unix socket. Although the all-NULL production baseline is structurally reversible,
that rollback removes ID-disablement guards and is therefore NOT policy-safe for
production. Production recovery retains guards, IDs, stronger FK and checkpoint
key while a specific forward repair is separately reviewed. Never clear IDs,
disable guards or restore incompatible uniqueness to make rollback succeed.

Remaining blockers before production authorization:
- Administrator confirmation of external/old/offline/import writers and maintenance
  ownership; repository search cannot certify deployed integrations.
- PostgREST/Supabase schema-cache and API compatibility validation in an authorized
  non-production Supabase environment; local PostgreSQL does not emulate that layer.
- Review of exact execution/ledger handling, backup/recovery ownership and practical
  lock window. No automatic ledger initialization or production rollback is approved.
- Fresh preflight immediately before any separately authorized execution, including
  schema/ACL/trigger/view/dependency drift. Stop on any unexpected result.

Later independently reviewed PRs: compatible audited identity writer and controls,
identity-aware reporting preserving supported legacy ranks, roster review and
selection-only UI, audited renames, Admin-confirmed merges/reversals, and confirmed
historical attribution. None is implemented or enabled here.

## Final authorization gate tracking

See [execution checklist](employee-identity-phase1-execution-checklist.md) and
[blocker investigation](employee-identity-phase1-blocker-review.md). The designated
non-production project has an incompatible existing schema; no migration was
applied there. Production writer absence is not attested; investigation remains
open. The accepted isolated SQL validation is unchanged.
