# Phase 1 employee identity foundation — draft implementation

Status: review only. No migration, database regression script, production query,
backfill, employee change, merge or deployment was executed for this PR. The
approved architecture does not authorize production execution. This document
supersedes the earlier assumption that production lacked employee_id.

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

## Migration safety and proposed production sequence — NOT AUTHORIZATION

Before asking for production authorization:
- Independently refresh the supplied metadata, index validity, server version,
  exact constraint/helper/trigger definitions and ACL/policy snapshots. Check
  inbound dependencies and realtime/replication behavior. The submitted migration
  checks core preconditions, not every possible external integration.
- Obtain explicit authorization for GLOBAL aggregate ID integrity/size counts;
  the Carencro-only scope is insufficient. A separate read-only preflight is
  prepared at docs/sql/employee-identity-foundation-preflight-READ-ONLY.sql and
  has not been executed. Any cross-site IDs block validation; no automatic repair.
- Review applied migration history without changing it. Do not run db pull or
  migration repair as an inventory shortcut; either may change remote history.
- Run the prepared SQL suites and authenticated-role tests in a separately approved
  isolated, representative PostgreSQL environment; test concurrent locks/writes,
  guard permissions, FK checks and stale/offline writers. No migration was applied
  even to a local database under this task's no-execution instruction.
- Measure lock/index/validation duration in that environment and choose a reviewed
  maintenance window. This draft builds indexes and validates under blocking locks.
  If it cannot finish within the bounds, abort and design a separately reviewed
  concurrent/staged rollout; do not silently increase timeouts or leave NOT VALID
  constraints as a claimed complete deployment.
- Record backups/recovery ownership, exact SQL revision/hash, source-ID/name/counter
  baseline and rollback decision. Obtain separate approval of SQL execution and
  any later application release. No merge/deployment is requested by this PR.

On a future authorized run, capture preflight evidence, execute the complete
transaction once using stop-on-error handling, and verify one same-location FK,
validated state, unchanged checkpoint key and existing guards/views/RLS/ACLs, no
raw data changes, NULL legacy saves, identity-write refusal, and report parity.
Any timeout/error aborts the transaction. ROLLBACK/close the failed session and
review; do not retry blindly or use CASCADE. Re-running a successful migration
fails preconditions instead of replacing evolved objects.

## Rollback and recovery

Prepared separately, outside the automatic migration folder:
`docs/sql/employee-identity-foundation-ROLLBACK-REVIEW-ONLY.sql`.
It is not executed. Under the same lock bounds it verifies phase1 markers,
trigger identities and exact guard-body hashes, then refuses ANY non-NULL employee
ID globally (including legitimate IDs predating phase1). This conservative path
is intentionally limited to an all-NULL baseline. If IDs exist, a tailored
preserving forward-repair/rollback design is a production blocker; never clear
IDs to make rollback run.

When eligible, restore the original single-column FK and employee-based unique
constraint; remove only phase1 guard/support objects. Preserve source columns,
rows, names, metrics, current checkpoint key, views, RLS, grants and Plans Lost.
Unknown dependent objects abort with RESTRICT. An operator must also compare the
full current metadata against approved before/after snapshots; marker checks alone
are not sufficient evidence to undo later changes. Any later writer/identity
change requires forward repair or a new reviewed reversal plan, not this script.
The application itself is unchanged, so it needs no version rollback here.

## Verification and remaining blockers

Node tests cover SQL contract safeguards and name-based reporting parity with NULL,
absent and unresolved IDs, split-hour deltas, zero/missing data and corrections.
Offline PostgreSQL SQL/PLpgSQL parsing checks syntax without database execution;
it does not validate catalog types, permissions, locking, upsert behavior or RLS.

Prepared, unexecuted SQL suites:
- employee-identity-foundation.fixture.sql: guarded synthetic local baseline and
  the existing Plans Lost guard; no real production IDs or employee facts.
- employee-identity-foundation.regression.sql: applies the candidate only after
  fixture safety checks when a future tester explicitly runs it; checks raw-row/
  policy parity, preserved preexisting IDs, rejected assignment/clear/reassignment,
  same-location FK, permanent keys, referenced deletion, split upserts, future
  same-ID split structure in a rolled-back test-only bypass, Plans Lost and RLS.
- employee-identity-foundation.rollback.sql: separate fresh all-NULL fixture and
  successful rollback assertions. The refusal case, schema drift, reapplication,
  lock/concurrency timeouts and actual production-like role policy matrix also
  require the documented isolated validation before release.

These files have never been sent to Supabase or a database by this task. Test
scripts WILL mutate their disposable fixture if deliberately executed later;
never paste them into production SQL Editor. No live database advisors were run,
since this task does not authorize further project inspection or mutation.

Remaining production blockers: global ID integrity/coverage and rollback baseline;
external writer conflict targets/nonnull behavior and PostgREST schema-cache compatibility; exact deployment/ledger order;
isolated SQL/RLS/concurrency and rollback execution; measured DDL lock budget;
compatibility of existing helpers/guards with the supported PostgreSQL version.
Do not request production execution authorization until these are reviewed.

Later independently reviewed PRs remain: audited compatible writer/authorization,
identity-aware reporting preserving supported legacy ranks, manager roster review
and selection-only UI, audited renames, merge proposals, Admin finalization/reversal,
and explicitly confirmed historical attribution. None is implemented here.

References: PostgreSQL constraints and ALTER TABLE documentation; Supabase local
migration workflow and database trigger/function guidance. This migration was
prepared from administrator-supplied production metadata, not a live schema dump.

### Checks completed for this draft

- Full Node suite: **281 passed, 0 failed** (271 existing + 10 foundation checks).
- Both production Vite builds passed; existing >500 kB chunk warnings remain.
- Six SQL files passed offline PostgreSQL SQL and PL/pgSQL syntax parsing with
  temporary pglast 7.21; psql directives were excluded from grammar parsing.
- SQL runtime, RLS, lock/concurrency and rollback executions: **not run**, because
  no migrations or database changes were authorized, including on a local database.
- No application source, dependency/lockfile, seed, existing role helper, Plans
  Lost function, view or scoring implementation was changed.
