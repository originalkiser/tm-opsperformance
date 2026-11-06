# PR #37 remaining blockers — 2026-10-24

Status: **NO-GO for production authorization**. Technical validation is accepted;
the remaining evidence is incomplete. PR stays draft. No production query/change,
development mutation, migration, merge, deployment or assignment enablement occurred
during this blocker review. No completed app test/build was repeated for docs changes.

## Writer investigation

Administrator reports the current TM Operations application is the only known
actively used Daily Log entry system, and knows of no Zapier/Make/n8n/import/script
writers. They cannot attest to Kiser's older apps, integrations or credentials.
This is partial knowledge, not evidence that unknown writers are absent.

Repository search of the current candidate tree confirms:
- DailyLogTable provides the two checkpoint upsert paths and deletion paths;
  dailyMemberships provides the daily-loss anchor upsert. All three upserts use
  `(location_id,log_date,time_slot,split_index)` and omit employee_id.
- Other direct Daily Log references are readers/reporting. The checked-in Edge
  Function sources contain no direct Daily Log references. The only checked-in
  workflow builds/deploys Pages on main/manual dispatch; no scheduled data job is
  defined. This says nothing about functions deployed from another checkout,
  older releases, dynamic writers or another repository/account.

The connected Supabase account exposes only development. A production project
metadata request returned permission denied. No attempt was made to bypass that
boundary. Administrator SQL Editor/deployed-function inspection is required.

Next administrator steps, one at a time:
1. Execute the provided metadata-only writer inventory in confirmed production:
   list public trigger/function identities, fingerprints of functions mentioning
   daily_logs, and presence of cron.job. It returns no source bodies, webhook
   arguments, employee data or sales. Review its result before further queries.
2. In production Dashboard > Edge Functions, report deployed function names and
   the code owner. Inspect their source locally/in Dashboard for Daily Log writes,
   related RPCs, outgoing calls or queued work; do not paste keys/source secrets.
   A deployed list is not certified by this repository's source list.
3. In Database > Webhooks and Integrations > Cron (or Dashboard search for these
   pages), report whether enabled jobs/hooks exist and who owns them. Keep URLs,
   tokens and raw command text private; review any relevant job/hook with its
   owner. Metadata query follow-ups depend on step 1; do not guess table shapes.
4. Ask Kiser/the account owner to list old app URLs, automation hosts, service
   accounts and any direct database/API credential holders; confirm each can be
   accounted for. Do not rotate keys or disable apps/jobs under this review.
5. Compare live Cloudflare/GitHub app URLs and their releases, old previews,
   installed mobile/PWA versions and pending offline saves with the current
   checkpoint writer. Assign an owner to pause/drain each actual writer.

No log retention interval proves a dormant credential or scheduled writer absent.
Do not turn an unanswered owner question into a passing check.

## Authorized non-production inspection

Administrator authorized `tm-ops-dev` (`bmfvcnsuduttebxbjvwx`) for scoped synthetic
API tests, conditional on compatible prerequisites and no effect on existing data.
Production reference remains `qbdvixxooofdlfurcpqy`.

Read-only development findings:

| Item | Actual development baseline |
| --- | --- |
| Server | PostgreSQL 17.11 |
| Existing data | 6 locations, 3 employees, 12 Daily Logs |
| employee_id / employee FK | Absent |
| Old employee-hour unique key | Absent |
| Split checkpoint unique key | Present |
| Plans Lost fields / guard | Absent / no Daily Log triggers |
| Production computed/rollup views | Absent |
| Employees | Additional created_at field |
| Location foreign keys | ON DELETE CASCADE, unlike supplied production baseline |
| RLS | Different tmdev policies; manager-scoped employee writes |
| Migration ledger | Present, zero entries |
| cron.job / deployed Edge Functions | Absent / none |
| Inbound employee/log foreign keys | None returned |

No names, individual sales, credentials or existing records were exported/changed.
No API write, fixture creation, candidate execution, schema-cache refresh or
configuration update was performed. The forward candidate intentionally refuses
this baseline. Adding missing columns/constraints, replacing guards/policies/views
or retrofitting history would affect a shared schema and is not authorized merely
as a test prerequisite. Existing records cannot be discarded/reset.

**API gate remains open.** Recommended next decision: administrator provides or
separately approves a disposable Supabase test project with the reviewed production
schema/permissions and synthetic data only. Alternatively prepare a separately
reviewed development-baseline alignment plan that preserves its existing data and
consumers. Neither path is executed/implemented in PR #37. A local PostgREST emulator
or service-role-only request cannot be reported as successful hosted authenticated
Supabase compatibility validation.

Once a compatible baseline is authorized, follow the focused API matrix in the
[execution checklist](employee-identity-phase1-execution-checklist.md). Record
actual authenticated HTTP outcomes, FK embedding, current supabase-js upserts,
existing RLS boundaries and schema-cache behavior. Do not infer these from SQL tests.

Current official cache documentation supports `NOTIFY pgrst, 'reload schema'`;
a notification is not proof of successful reload. It must be followed by API
verification and separately included in any production operational authorization.
No new event triggers, API exposure changes or guard bypasses are proposed.

## Remaining approval evidence

- Completed production writer inventory plus named owners/attestation.
- Compatible authorized hosted test baseline and passing API/cache evidence.
- Completed named operator/observer/backup/recovery responsibilities, verified
  backup/PITR procedure, accepted exact-SQL/external-record handling of the absent
  production ledger, maintenance window and fresh pre-execution preflight.

Until then: NO-GO. No production migration approval is requested.

References: [Supabase cache refresh](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema),
[PostgREST cache behavior](https://docs.postgrest.org/en/stable/references/schema_cache.html).
