# Phase 1 final authorization checklist — PR #37 remains draft

This checklist is preparation, not production execution authorization. The accepted
technical validation remains unchanged. Do not execute migrations, change production
data/configuration, merge/deploy or enable employee ID assignments under this task.

## 1. Production writer attestation — administrator to complete

Check each source, record `none` or writer name/owner, and its actual behavior:

- [ ] Current app URLs, old deployments/bookmarks, desktop/mobile/PWA installs,
  offline browser sessions and pending unsent saves.
- [ ] Supabase Dashboard Cron/scheduled jobs, deployed Edge Functions/webhooks,
  database triggers/functions that can insert/update/delete Daily Logs.
- [ ] Zapier, Make, n8n, scheduled server/desktop scripts, spreadsheets/CSV imports,
  vendor/POS integrations, GitHub Actions or other scheduled workflows.
- [ ] Direct SQL/API tools and all people/systems with production database or
  write API credentials. Do not paste keys/passwords into this checklist.
- [ ] For each writer: does it write `daily_logs` (including via views/RPCs)? Does
  it send/clear employee_id, mutate employee UUID/location, or use the removed
  `(location_id,log_date,time_slot,employee_id)` conflict target? Who can pause,
  drain/reconcile queued work and restart it?
- [ ] An administrator explicitly signs off the complete list, including any
  unowned/unknown writer. Unknown behavior means NO-GO; name similarity is not
  employee identity evidence. Recent logs alone cannot prove no dormant writer.

Repository evidence: DailyLogTable's two upserts and dailyMemberships anchor save
omit employee_id and use `(location_id,log_date,time_slot,split_index)`. This is
not certification of external jobs, deployed versions or cached offline payloads.
Inspect job definitions/configuration with their owners; no employee/sales export
is needed. This task does not authorize additional production inventory queries.

## 2. Non-production Supabase API/cache gate

Candidate discovered: `tm-ops-dev`, ref `bmfvcnsuduttebxbjvwx`; production is
`qbdvixxooofdlfurcpqy`. Different references alone do not establish permission to
alter a shared dev project. Obtain confirmation of intended project/test locations
and synthetic data permissions first. No new project, branch, paid resource or
production copy is required or authorized by this checklist.

- [ ] Verify project identity and baseline metadata before changes; stop on drift
  or existing foundation objects. Inventory current development RLS/grants/guards,
  views, constraints, API exposure and migration state; do not overwrite them.
- [ ] Use approved synthetic locations/employees and scoped test credentials only.
  Record existing-data baselines; never reuse real employee/log records for probes.
- [ ] Exercise pre-migration API reads and name-only checkpoint saves with the
  application's actual supabase-js options/JSON shapes, authenticated role and
  location boundary. Include split entries and Plans Lost anchor save.
- [ ] Apply the exact reviewed candidate only if baseline preconditions match.
  Record SQL hash and change responsibility; no automatic ledger repair/reset.
- [ ] Observe automatic cache reload; test table reads, both views and named FK
  embedding before/after. Confirm composite relationship uses BOTH location and
  employee ID and introduces no ambiguous duplicate relationship.
- [ ] If refresh is needed, record it and use only the official non-production
  `NOTIFY pgrst, 'reload schema'` mechanism; verify HTTP success afterward rather
  than assuming the notification is proof. Do not change Data API configuration.
- [ ] API tests: legacy insert/upsert/update/delete as permitted by existing
  validation; repeated split saves update one checkpoint; omitted IDs remain NULL;
  NULL/name-only rows remain readable; unchanged preexisting IDs are retained.
- [ ] ID insert/reassignment/clear are rejected, including upserts; cross-location
  access stays blocked by existing applicable RLS. No ID enablement/bypass for
  API tests. Synthetic existing-ID fixture must precede candidate and be approved.
- [ ] Exercise roster/current report projections and authenticated/unauthenticated
  boundaries. Service-role-only requests do not certify application RLS behavior.
- [ ] Record statuses/error codes and cleanup only owned synthetic records under
  existing guards. Do not weaken guards or delete protected Plans Lost anchors
  merely to clean up; pre-plan disposable fixture/recovery ownership.

Status: **pending confirmed project/test scope and actual HTTP evidence**. SQL
role tests already passed, but are not a substitute for these HTTP checks.

## 3. Production execution record — fill before requesting authorization

| Responsibility | Required evidence / named owner |
| --- | --- |
| Approving administrator | Explicit authorization of exact SQL revision/project/window |
| SQL operator | Named authorized administrator; exact reviewed transaction |
| Observer/cancellation owner | Separate session; 30-second operational ceiling |
| Backup/recovery owner | Verified backup/PITR availability, retention, recovery point and access |
| Writer owners | Pause/drain/reconcile/restart list and contact for each writer |
| Verification owner | Catalog/data-integrity/API/report checks and go/no-go to resume |
| Incident decision owner | Preserving forward repair; any restore requires new explicit approval |

Do not infer backup coverage from subscription tier. Administrator verifies current
Dashboard backups/PITR and a practical restore procedure; no restore, backup setting
change or paid enablement is authorized here. Document RPO/RTO, restoration impact
on intervening writes, and who owns reconciliation if a restore is ever approved.

**Absent ledger:** production inventory found no
`supabase_migrations.schema_migrations`. Preferred proposal is one exact reviewed
SQL transaction through the confirmed project's SQL Editor/authorized admin client,
with an external durable execution record: project, operator, candidate commit,
SHA-256, start/end/time zone, complete outcome and before/after evidence. Do not
create/populate a ledger, mark versions applied, or run db push/pull/repair. Ledger
adoption remains separate work. Administrative approval of this execution mechanism
is still required; this document does not select/execute it on their behalf.

**Fresh preflight:** immediately before any authorized attempt, capture the reviewed
read-only aggregate/catalog results and approved metadata comparison: existing FK,
checkpoint/employee keys, indexes, triggers/helpers, RLS/grants, invoker views and
inbound dependencies. Verify no foundation already exists; counts/ID coverage may
have changed since 2026-10-24. Zero broken/cross-site references; unexpected drift,
unknown dependency/writer or changed ID coverage stops execution. No automatic repair.

**Window:** propose a short low-traffic maintenance window after writer owners can
pause and preserve unsent work. Do not schedule until owners agree. Blocking locks
can affect reads too. Keep 2s lock acquisition and 15s per-statement timeout. Local
synthetic timings are not a production SLA. Observer cancels at a 30s total ceiling;
ROLLBACK/close failed session and verify locks released. No automatic retries or
increased limits. Do not leave idle transactions open.

**Execution:** operator verifies project reference and SQL hash again, executes the
complete reviewed transaction once with stop-on-error behavior, saves all messages,
and confirms commit/abort. Do not run rollback/test fixture scripts in production.
Schema-cache notification, if needed, must be explicitly included in production
authorization as a separate reviewed operational step; no event-trigger/config edits.

**Post-commit, before resuming writers:**
- [ ] Exactly one strengthened same-location FK under the existing name, validated.
- [ ] Current split checkpoint unique key preserved; only obsolete employee-hour
  unique removed; support key/index valid and ready.
- [ ] Assignment/key guards enabled; existing Plans Lost trigger unchanged.
- [ ] Existing RLS/policies/grants/helper/view definitions unchanged; source data
  counts/approved integrity baselines unchanged while writers are paused.
- [ ] Existing app API reads, roster selection and report scores/ranks work for
  authorized users. Check FK embedding/cache and errors; do not insert production
  test rows or modify employee records as a probe.
- [ ] Observe the first approved real name-only save after controlled resume;
  verify normal refresh and no assignment errors, without changing its content.
- [ ] Resume remaining writers only on verification-owner approval; reconcile
  preserved queues without silently adding/clearing IDs. Record completion/errors.

**Recovery:** pre-commit failure is atomic; ROLLBACK/close and inspect. Post-commit,
retain guards, source identities, same-location FK and checkpoint key; pause the
incompatible writer and review a narrow forward repair. Full rollback is isolated-
test-only and policy-unsafe for production even when all IDs are NULL. Never clear
IDs, disable guards or rewrite history to recover. Any restore is a separately
approved incident action with explicit write reconciliation.

## Authorization decision

GO recommendation requires all three gates signed off: writer attestation, actual
authorized non-production API evidence, and named execution/backup/recovery owners
with accepted absent-ledger handling/window. Otherwise NO-GO, stating the missing
evidence. A GO recommendation does not itself authorize production execution,
merging, deployment or employee ID assignments. PR #37 stays draft until instructed.

References: [Supabase cache refresh](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema),
[PostgREST cache](https://docs.postgrest.org/en/stable/references/schema_cache.html).
