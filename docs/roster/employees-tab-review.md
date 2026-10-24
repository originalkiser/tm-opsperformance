# Employees tab — separate draft stacked on PR #38

PR #38 remains draft, unmerged and unauthorized for production. This draft bases
on its branch so its review diff contains only the Employees UI, name guard/review
RPC and focused tests. Retarget to main only after separately approved base work;
do not deploy the frontend without both approved employee migrations. PR #37 is
paused and none of its identity migration, FK changes or fixtures is used here.

## Behavior

Employees navigation opens an assigned-location roster for store/area managers,
and all current authorized locations for Admin. It loads existing records without
initialization/backfill, supports Add, confirmed rename, Activate/Deactivate and
Active/Inactive/All filters. NULL legacy status appears inactive. No report lookup,
name change or status operation edits a Daily Log or employee_id.

The page checks current database roster-maintenance permission before scoped,
fully paginated roster reads. PR #38's database rules enforce writes even if the
client has stale assignments. Existing broad authenticated employee SELECT remains
for legacy reporting; this page never offers unassigned locations. Read failures
clear the list and disable writes while keeping Reload usable. Location/user keys
remount state, and late reads are ignored. Mutations check original name/status
snapshots and report RLS zero-row results as failure, never success.

Admin can choose 2–100 records, review original IDs/names/status, choose one retained
active record and explicitly confirm all selected records represent one actual
person. One SECURITY INVOKER RPC locks selected records in UUID order, checks current
Admin status and current reviewed names/status, and updates only is_active atomically.
Stale/cross-site/missing selections fail without partial updates. Managers cannot
invoke it. Cancel performs no write. No renaming, deletion, alias or historical
attribution happens during duplicate review. Records are retained and can later be
reactivated deliberately; there is no claim to reverse intervening edits.

Rename confirmation explains that historical sales retain their originally recorded
names and may appear separately in Team Member Sales. No ranking/calculation code,
Daily Log entry UI, Budget or KPI formula is changed. The selection-only hourly
Daily Log dropdown remains the next PR. Historical-name suggestions are optional,
not automatically created/imported here. Existing rosters are used immediately.

## Duplicate prevention and concurrency

The employee-only BEFORE trigger normalizes newly inserted/edited names by trimming
ECMAScript whitespace and applying database lowercase; includes inactive records
within the same location. Backend collation is authoritative. Names at different
sites remain independent. Exact name-preserving status updates remain allowed for
legacy duplicate groups; cosmetic changes with the same normalized old name are
allowed. No existing rows are normalized or deleted by migration.

New-name and changed-key writes use a transaction-level advisory lock per location.
The VOLATILE trigger obtains a fresh READ COMMITTED snapshot after waiting, then
checks all current active/inactive roster records. Concurrent insert and rename
races are exercised by independent connections: one commits, one fails 23505.
Bulk multirow inserts see their own prior inserted names. Snapshot-isolation name
changes explicitly fail 25000 rather than risk stale checks; ordinary PostgREST
READ COMMITTED is supported. Status-only operations still support other isolation
levels. Deadlocks/timeout errors abort, never bypass validation. Hash collisions
can over-serialize sites but cannot admit duplicates. No new unique index/backfill
is attempted against existing duplicate names.

## Executed validation

- 36 PR #38 PostgreSQL 17.6 authorization checks rerun against synthetic local data.
- 23 additional local SQL checks: whitespace/case/inactive duplicates, blank names,
  same name other site, legacy duplicate edits, concurrent insert/rename, isolation,
  Admin confirmation/atomic review, stale/cross-site selection refusal and unchanged
  historical log/source rows. See machine-readable result file.
- 287 Node tests passed (274 base + 13 new service/UI interaction checks), zero failed.
  Includes cancellation/positive confirmation, role/location/filter behavior,
  atomic payload/count handling, errors and late-read cleanup.
- Both production builds passed; existing >500 kB chunk warnings remain.
- Authorized hosted development SQL-role checks exercised actual employees schema,
  including created_at/default UUID with permitted insert columns, current creation
  payload/status/rename, duplicate prevention, atomic Admin review, no-delete and
  cross-location/store-review refusal. All test writes rolled back.
- Hosted record fingerprints before/after match: 3 original employees, 12 Daily Logs;
  unrelated policies and original helper functions also match. No production query
  or change. Development has only the explicitly approved roster adapter plus name
  trigger/review function and migration-ledger execution records added.
- Anonymous actual PostgREST calls resolve both new/required RPCs and are denied with
  HTTP 401, code 42501. This verifies cache resolution/anonymous denial only.
- Supabase advisors reviewed; existing general definer/password-protection advisories
  remain, with no unrelated remediation. New helper has fixed search_path, reads only
  caller-bound authorization, and denies anonymous execution. Review RPC is invoker.

## Outstanding release gates

**Signed-in Supabase Auth/PostgREST and authenticated visual tests are not completed.**
The approved existing synthetic accounts are present, but no reusable authenticated
session/configuration was found. A fresh dev-only preview using the current public
key was started at http://127.0.0.1:5175/tm-opsperformance/#/login. It explicitly
rejects production URLs and inherited VITE configuration. Administrator private
sign-in with synthetic Admin/store accounts is needed; no credentials in chat or Git.
No SQL impersonation, anonymous denial, or locally mocked UI is called real login.
Do not create test users through SQL or enable anonymous Auth as a shortcut.

Also required: fresh production employee-policy/ACL preflight, review the small SQL
migrations together, named execution/recovery owner and explicit production approval.
No blind db push/pull/repair or migration-ledger initialization (production ledger
was absent). No production changes, merges or deployments are requested by this draft.
New migrations and the dev adapter are not production execution authorization.
