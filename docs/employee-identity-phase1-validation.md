# Phase 1 pre-deployment validation — 2026-10-24

PR #37 remains draft. No production migration, data change, ID assignment, merge or
deployment occurred. The administrator ran three reviewed SELECT-only inventory
steps in confirmed production project `tm-opsperformance` (`qbdvixxooofdlfurcpqy`).
They read catalogs and global ID-integrity counts, not names or individual sales.
The initial metadata query preceded global aggregate approval/execution. No further
production query is needed for the current inventory. Refresh before execution.

## Production evidence

| Check | Result |
| --- | --- |
| PostgreSQL | 17.6 |
| Employees / Daily Logs | 457 / 24,514 |
| NULL / non-NULL employee IDs | 24,514 / 0 |
| Missing / cross-location references | 0 / 0 |
| Non-NULL employee-hour duplicate groups | 0 |
| Existing indexes | All four valid and ready |
| Relevant constraints | Validated, non-deferrable, comments NULL |
| Table sizes at metadata capture | Logs 10,625,024 bytes; employees 147,456 bytes |
| Migration ledger | `supabase_migrations.schema_migrations` absent |

The estimates (24,471 logs/440 employees) from metadata were not exact counts;
use the subsequent exact aggregates above. Inventory has separate statement
snapshots; normal writes can change counts between captures.

## Isolated execution evidence

Portable PostgreSQL binaries were checksum-verified against the Maven distribution
of Zonky embedded PostgreSQL; no app dependency was added. Tests used synthetic
UUIDs, a dedicated disposable database, fake API roles, a private Unix socket,
`listen_addresses=''`, and no production credentials or connection strings.
PostgreSQL 17.11 was tested first; all scenarios were repeated on production's
17.6. Python test-only requirements: psycopg2-binary 2.9.11, pglast 7.21.

All 13 scenarios passed on 17.6; machine-readable timings are in
[validation results](employee-identity-phase1-validation-results.json):

- Reviewed three-step inventory executes in a READ ONLY transaction without changes.
- Rollback scope gate rejects the wrong role before acquiring table locks.
- Prepared migration/functional/RLS/Plans Lost regressions and all-NULL rollback.
- Non-NULL rollback refusal without changes; preserved IDs, metric edits and
  assignment guards remain operational afterward (guard-preserving recovery hold).
- Reapplication, schema-comment drift and rollback-body drift refuse atomically.
- A preexisting cross-site ID aborts the transaction without rewriting any row.
- Busy writer causes lock timeout after 2.0025s; unchanged baseline; retry after
  writer rollback succeeds. No automatic production retry is proposed.
- Queued legacy writer succeeds after commit; queued non-NULL-ID writer fails
  with SQLSTATE 23514. No race enables assignments.
- Eleven supplied production-policy cases give identical before/after outcomes;
  Admin, assigned manager, store and service-role non-NULL assignments all fail.
- Synthetic blocking-DDL measurements: 24,514 rows/7.3 MB: 0.0048s;
  100,002 rows/29.3 MB: 0.0106s. Two fixture employees, mostly NULL IDs, warm local
  SSD, no network or production workload. These are lower-bound observations,
  NOT production timing predictions. Production's 457 employees and wider rows,
  cold cache, concurrent load, storage and catalog dependencies can increase time.

The policy fixture deliberately reproduces existing gaps: inactive/deleted users
can still pass old location helpers, and role-only employee writes are not scoped
to assigned locations. No policies/helpers are changed in this foundation. These
are blockers to the later identity writer, not evidence to enable it now.
These tests execute actual PostgreSQL roles/RLS, but do not test Supabase Auth,
PostgREST caches, Realtime or HTTP request serialization.

Reproduce only in an explicitly authorized disposable local cluster. Create fake
roles `anon`, `authenticated`, `service_role` (last with BYPASSRLS) and database
`tm_identity_foundation_test`, owned by `identity_test_admin`. Install the pinned
Python test packages outside the app. Run:

```sh
python3 app/tests/sql/run_employee_identity_validation.py \
  --socket /private/tmp/YOUR_PRIVATE_SOCKET --port YOUR_PORT \
  --expected-data-directory /private/tmp/YOUR_DISPOSABLE_DATA \
  --output /private/tmp/identity-validation-results.json --reset-disposable-db
```

The runner intentionally DROPS/recreates only that named test database, after
checking the server data-directory and absence of a TCP server address. Never
point fixture, runner, migration or rollback tests at production. The fixtures
contain deliberate bad IDs, trigger bypass tests and synthetic renames rolled
back or discarded; none represent authorized production operations.

## Writer and API compatibility

Current repository DailyLogTable (two paths) and dailyMemberships anchor saves
use `(location_id,log_date,time_slot,split_index)` and omit employee_id. The key
and name-only upsert behavior are tested; split/checkpoint identity remains intact.
Existing IDs survive metric-only updates; explicit clearing, reassignment or ID
inserts/upserts fail by design. Same-location references are validated, while
repeated same-ID splits are structurally supported for a future approved writer.
Historical name-based scoring/qualification/ranks and numeric formulas are intact.
External tools, old builds, offline queues, imports and deployed API cache behavior
remain unverified; an administrator must identify them before rollout.

## Ledger and practical maintenance procedure — review only

No remote migration ledger exists. Blind `supabase db push`, `db pull` or migration
repair is prohibited. Review either exact SQL execution with an external immutable
record (project, operator, SQL hash, start/end, before/after evidence), or separate
baseline adoption. This PR does not create/repair migration history.

Before a future separately authorized run:
1. Name operator, observer and recovery owner; confirm recoverable backup/PITR
   availability and retention without creating/changing production configuration.
2. Approve exact candidate hash and mechanism. Refresh the read-only inventory,
   constraints, helpers/triggers, RLS/grants, views/dependencies and writer list.
   Any drift/unknown writer stops execution. Do not guess or repair records.
3. Announce a short low-traffic maintenance window and pause known writers/imports
   with administrator approval. Coordinate unsent/offline saves; don't discard
   them. Have an authorized observer ready to cancel this transaction if needed.
4. Execute the entire reviewed transaction once, stop on first error. The locks
   block reads/writes; 2s acquisition timeout and 15s PER-STATEMENT timeout are
   retained. Set a practical operator whole-transaction ceiling of 30 seconds
   for this small baseline; cancel and roll back if exceeded. This is an
   operational deadline, not a SQL-enforced total timeout. Never leave an open
   idle transaction or widen timeouts to force completion.
5. On any error/timeout: issue ROLLBACK or close the same session, confirm locks
   released and original schema restored; investigate before another authorized
   attempt. Transactional DDL and refusal cases are tested locally.
6. After commit, inspect the strengthened validated FK, checkpoint key, enabled
   guards, unchanged RLS/ACL/views/Plans Lost, counts and existing reporting.
   Mutation probes belong in staging, never unsolicited production test rows.
   Review schema-cache refresh separately if required; do not assume CLI handles
   it when executing SQL manually. Resume writers only after checks pass.

## Recovery and rollback decision

All global IDs are NULL now, so restoring the old constraints has no current ID
collision. Nevertheless the original full rollback removes both identity guards,
contradicting the requirement that assignments stay disabled. It is not an
approved production recovery. The reviewed reference rollback now hard-refuses
outside the named isolated test database, fake admin and Unix socket.

Before commit, transaction rollback preserves the original schema/data. After
commit, the application has no release change to revert. Keep the strengthened
FK, checkpoint key, employee-key guard and assignment guard; pause any incompatible
external writer, preserve its queued work, and diagnose the precise failure.
Prepare a narrowly scoped forward repair under new review/authorization. Never
clear/reassign IDs, disable guards, drop integrity checks or restore the obsolete
employee-hour uniqueness to achieve recovery. Existing name-only writes and
preexisting-ID metric updates remain available; refusal/recovery tests prove it.
If a later authorized writer introduces IDs, preserve every ID and alias: the
full rollback remains forbidden. Backup restoration affecting live writes is a
separate incident decision requiring explicit approval and reconciliation, not an
automatic step in this PR.

## Remaining release blockers

- External/deployed writer attestation and non-production Supabase API/cache tests.
- Review of execution/ledger mechanism, backups, maintenance ownership and recovery.
- Fresh pre-execution metadata/integrity evidence and separately explicit production
  migration authorization. No approval is requested until these are resolved.

No manager roster UI, historical consolidation or identity assignment is begun.

## Application verification

Complete Node suite: **282 passed, zero failed**. Both production Vite builds
passed (GitHub Pages base and root base); existing >500 kB chunk warnings remain.
No app runtime source, dependency/lockfile or forward migration changed during
pre-deployment validation. `git diff --check` passed.

Candidate forward SQL SHA-256: `4cf175c7a58795047f76b51b271e39180b09952fa3dc2f8f43f0930b6119c20a`.
