# Location QR access and checklist period corrections

Current release status: hosted functional and conflict acceptance passed in `tm-ops-dev`, including the correction for a retry-loop defect found during the first pass. Keep this PR draft: precise in-transfer Storage timing, real browser/device acceptance and separate production authorization remain release gates. See the dated acceptance record below.

Development only. This work is isolated from Checklist Compliance PR #60.
No production database, Storage, account, QR grant, merge, or deployment is authorized by this document.

## Approved behavior

- A location QR holder can continue or correct any checklist at that location, including a checklist begun by a signed-in manager. Possession of a copied QR gives the same access; it does not prove identity or physical presence.
- The five existing templates and their snapshots, required answers, evidence, and signatures remain authoritative.
- An initial draft can remain unfinished across days or weeks. Its original daily date or Monday-based weekly occurrence is preserved.
- Daily corrections close at midnight after the immutable site-local occurrence date. Weekly corrections close at midnight Monday after the assigned Monday–Sunday week, even when first submitted earlier in that week. A late submission does not reopen an expired period.
- The first submission timestamp never resets. The authoritative server deadline derives from the immutable occurrence and timezone snapshot, ignoring legacy stored deadlines. Corrections keep the original submitted result official until a complete replacement version is finalized.
- Existing finalized answers, photos, and signatures remain preserved. A correction is a new version, not a destructive replacement.
- Each correction requires freshly drawn signatures for every applicable signature requirement, including the two item signatures and final auditor signature on Weekly PM. Old signatures remain available in the earlier version rather than attesting changed answers.
- QR access does not include reports, account administration, template editing, or permanent draft deletion.
- MonitorQA remains the official checklist system. No new mandatory assignments, reminders, or background cleanup are introduced.

## Access and evidence boundaries

Guest access uses a dedicated server endpoint and a revocable, random location capability. Anonymous direct table/Storage access stays denied. No shared manager password, fake authenticated user, public bucket, or reusable signed evidence URL is introduced.

`checklist-access` uses a 256-bit generated QR token, hashed with SHA-256 before the server-only RPC. The raw token is returned only when an Admin generates/replaces the code. Guest browsers remove it from the hash-router URL and retain it in tab session storage for reloads. Every request presents it again; no synthetic Supabase account or separate permanent guest session is created. A copied or photographed QR remains an access credential until revoked or replaced.

The server derives the permitted location from the token. Client-provided IDs are not authorization. Token rotation and revocation are checked on every protected operation, including fresh evidence access. Guest audit attribution identifies the access grant and the self-reported name; it does not claim a verified account identity.

The original creator remains attributed on account-created records. Nullable guest actor fields must be accompanied by null-safe authenticated authorization. In particular, SQL `created_by <> auth.uid()` is not a safe ownership rejection when `created_by` can be NULL.

Correction uploads must be bound to a particular working copy. The final Storage metadata guard and attachment finalization recheck lifecycle/authorization. Never use the original whole-submission discard cleanup on a submitted checklist or its correction: it removes the entire submission prefix and could destroy historical evidence.

## Implementation boundaries

- `checklist_private` contains QR grants, rate counters, correction working copies, immutable finalized versions, and upload intents. Browser roles cannot read or write these tables. The service-role-only wrapper is not callable by anonymous or authenticated browser clients.
- Existing submissions/attachments gain explicit guest creator references. Original authenticated creator IDs remain unchanged when someone uses the QR to continue their work.
- The authenticated legacy draft RPC routes through the shared validator with null-safe ownership checks. It does not gain a direct submitted-record overwrite path.
- The dedicated endpoint accepts either a QR capability or an account validated with `auth.getUser()`. It ignores supplied actor, token-hash, grant, and Storage-path fields. Account requests preserve existing creator editing and Admin review boundaries.
- The official submission remains `submitted` throughout a correction. A complete, valid correction updates it and appends the preserved version/audit entry in one database transaction. Original `submitted_at`, occurrence, and deadline are retained.
- New upload intents have a five-minute maximum lifetime, with correction uploads also capped at the correction deadline. The server generates paths; clients do not select paths. Limits bound request bytes, image size, upload count/rate, and context pagination.
- Guest downloads are proxied privately, rechecking authorization after Storage transfer. The browser checks access once more after receiving the bytes before creating a temporary Blob URL.
- QR management requires an active Admin and an expected generation. A stale Admin page cannot silently replace or revoke a newer QR. The UI generates the image locally and reveals a new link only for immediate copy/download/print.
- Guest navigation is outside the authenticated app shell. The location is fixed by the QR; there are no report, site-switcher, profile, or template-management controls. Account pages gain a separately paginated unfinished-work list.

The capability intentionally grants every holder access to the site's checklist answers and private checklist evidence, including account-created records. It does not give the holder an independently verified personal identity. Existing record copies already delivered to a browser cannot be remotely erased.

## Local verification and release gates

Required local coverage:

1. Valid and invalid QR capabilities; rotation/revocation; direct anonymous table, RPC, and Storage denial; cross-location IDs; tampered paths; authenticated NULL-ownership behavior.
2. Guest continuation of an authenticated creator's draft, all five templates, old daily/weekly draft discovery, and unique occurrence protection.
3. Daily occurrence-day and weekly Monday–Sunday corrections, expired-period rejection, midnight while waiting for a row lock, DST boundaries, timezone snapshots, and preservation of the first submission timestamp.
4. Concurrent correction sessions and stale revisions; original official result remains intact while a correction is incomplete.
5. Evidence requirements and fresh signatures; immutable original versions; revoked/expired or completed upload intents; uploads racing finalization and revocation; no deletion of original evidence.
6. Atomic version/audit updates and network ambiguity handling without blind retries.
7. Mobile, dark mode, navigation/recovery, QR rendering without third-party QR services, token removal from the browser address, and revocation/expiry messages.
8. Existing application/SQL regression suites and both production base-path builds.

Local fixtures cannot certify live Supabase Storage ordering, blob cleanup, hosted Auth/PostgREST, phone QR scanning, camera permissions, or stylus behavior. Those require a separately authorized isolated integration/acceptance session. The local Chromium launcher currently fails with an OS socket permission error; browser acceptance must be recorded as blocked unless completed through a supported browser-capable executor.

Before any release: review exact migration/function bytes and production metadata/timezones, confirm recovery and separately preserved evidence, authorize the backend change, verify it, then authorize the normal application release. Generate real location QR codes only after backend and client acceptance. Never push to main or trigger a Cloudflare deployment as part of development testing.

Recovery is application-first and non-destructive. Retain schema, original and corrected versions, audit history, and evidence. Revoking QR grants is a separate authorized access change. Database backup alone does not restore photo/signature objects.

## Development record

- Initial main: `3a478acd1f72028e6c2b88552668eb4d6e9f808a`.
- Separately inspected PR #60: draft and unmerged at `4633cf488d4a8c7ea359fb9ef48727ccde38cabb`.
- Baseline application suite before implementation: 461 tests passed.
- QR renderer: pinned `qrcode@1.5.4`, rendered locally. No QR token is sent to an image service.
- Final combined application suite: **491 passed**, no failures/skips.
- Final combined isolated PostgreSQL suite: **76 passed**, no failures/skips. Includes checklist, QR/correction, monthly-budget, November, and resource regression suites.
- Both production builds passed: default GitHub Pages base and `--base=/`. Existing large-bundle warnings remain.
- Whitespace check passed. No source input, environment file, real QR credential, user data, or screenshot was added.
- Independent review found no remaining actionable issues after fixes for discard compatibility, expired correction display, history evidence, fresh PM signatures, stale UI reads, QR-generation conflicts, and QR/location lock ordering. Browser, hosted integration, and genuine concurrent streaming-upload acceptance remain release gates.
- Compatibility with unmerged PR #60 was tested in a separate local integration worktree: automatic merge succeeded without conflicts, all **509 combined application tests** passed, and the root-base build passed. With both SQL migrations installed in the fictional fixture, **five reporting/integration groups** passed, including an unfinished guest correction retaining one official `submitted` occurrence and anonymous report access remaining denied. Neither feature branch was merged or pushed remotely.

Reproduce from repository root:

```sh
npm --prefix app test
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test \
  scripts/tests/checklist-sql.test.mjs scripts/tests/checklist-qr-sql.test.mjs \
  scripts/tests/monthly-budget-sql.test.mjs scripts/tests/november-sql.test.mjs \
  scripts/tests/november-goal-access.test.mjs scripts/tests/resource-sql.test.mjs
npm --prefix app run build
npm --prefix app run build -- --base=/
git diff --check
```

The SQL harness used `@electric-sql/pglite@0.5.15` outside the application dependencies. Ordered race tests and lock-order review do not replace real multi-connection Storage/database acceptance.

Reviewed backend SHA-256 values:

- Migration `20261112022829_checklist_qr_same_day.sql`: `0016191dc294056eba7b3f622d6e4471bab5107c6d8d19e35a488a798649fcf4`.
- `checklist-access/index.ts`: `04e71b2436495b9583e47b0961b4d4fd888169fde2e129efb4705195fa245f1f`.
- `checklist-access/handler.js`: `73b4a532a53ba9d6c63e361eef817bf0179eaa3f68d51d8d71ed1151e390a3f9`.

## Hosted development acceptance and corrective work: 2026-11-12

With explicit owner approval, the exact published tree `d826c24f90920adadca297856701b34dd01f5915` was installed only in the existing `tm-ops-dev` project. The original QR migration was recorded as `20261112141416_pr61_qa_checklist_qr_same_day`; `checklist-access` version 1 and its shared key helper matched the repository bytes. No production project, merge or production release was used. The earlier local review and test results above predate this hosted finding.

Four new, auto-confirmed fictional Auth accounts and three labelled fictional sites were used. Requests used genuine user JWTs or location QR capabilities, not forged JWTs or an extracted service key. The test covered:

- All five complete initial submissions, continued by a QR guest from account-created drafts, with real private photos/signatures.
- Complete same-day corrections for all five templates, fresh applicable signatures, preserved original timestamps/deadlines and earlier history/evidence.
- An older weekly draft for Monday 2026-10-26 discovered and continued by a QR guest without changing its occurrence.
- Cross-site and direct privileged-RPC denial, creator/account boundaries, image validation, no-cache evidence delivery and bounded request rejection.
- A real save started 1.995 seconds before a controlled fictional deadline, waited for a database row lock, and returned HTTP 403 after the deadline. Official, history and working-copy hashes were unchanged. This was a deliberately shortened deadline on a new fixture, not a change to an existing site's time zone. An earlier attempt hit the database statement timeout and was not counted as a pass.
- Both test QR grants were revoked. Old tokens were denied for context, read, save, download and upload. All four accounts were globally signed out, then made inactive, unassigned Store profiles. Database verification found zero active test grants/profiles and zero test sessions.

All pre-existing development profiles, locations, submissions, attachments, templates, Storage metadata and audit records matched their before-test counts and hashes. Newly added schema columns were excluded from comparisons of pre-existing record values. Labelled fixtures remain: three sites, nine submissions, eleven preserved versions and twenty-one registered private images. The existing development schema and endpoint remain installed; no data was deleted.

### Conflict defect found and corrected

Stale revision/generation conditions deliberately raised SQLSTATE `40001`, which denotes a retryable transaction serialization failure. Hosted PostgREST 14 repeatedly retried those business conflicts: a simultaneous pair committed only one update, but the losing request and a standalone stale request timed out instead of returning HTTP 409. Hosted logs recorded 377 `40001` errors during the pass. This is an application error-code defect, not a passed concurrency check or a confirmed client transport issue.

[Supabase's documented failure and remediation](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) recommends `PT409` for these conflicts. After access cleanup, no active checklist RPC session remained and a bounded log check found no further `40001` errors. No database restart or backend termination was needed.

The minimal correction is:

1. Apply new migration `20261112143325_checklist_conflict_http_409.sql` after the original QR migration. It preserves the dispatcher and permissions while changing only the three deliberate conflict codes: stale QR generation, stale begin-edit and stale save. The original migration is unchanged.
2. Update the endpoint's safe conflict mapping from `40001` to `PT409`.
3. Add regression coverage for the installed SQLSTATE, unchanged state after rejected conflicts, and one safe HTTP 409 response for edit/save/QR actions.

The owner separately authorized corrective development deployment, conflict retesting and this draft PR update. The two checklist migrations must remain ordered; do not reapply the original migration to a project where it is already installed. Production migration, function deployment, merge and application release still require separate authorization.

Local correction verification: **492 application tests**, **77 isolated PostgreSQL tests**, both production base-path builds and whitespace checks passed. Independent review confirmed the dispatcher differs only in the three conflict codes and `CREATE OR REPLACE`, with preserved permissions; it independently passed all eight endpoint tests and fifteen QR SQL groups. The original migration and published acceptance evidence remain unchanged. New corrective-migration SHA-256: `51ae2449993036b7440d61b13dbb3c2b36189eca983708062c4af7915dc2d88d`.

### Corrective hosted retest: passed on 2026-11-12

The reviewed correction was installed only in `tm-ops-dev`, recorded as `20261112144239_pr61_qa_checklist_conflict_http_409`, with `checklist-access` version 2. Retrieved function bytes matched the reviewed files. The dispatcher contains exactly three `PT409` conflict sites and no deliberate `40001` raises, with unchanged permissions. Deployment itself changed no submission, history, image or template values.

- Sequential stale save returned HTTP 409 in 0.172 seconds.
- Simultaneous account saves returned one HTTP 200 and one HTTP 409 in 0.206/0.226 seconds. The draft advanced exactly one revision; account draft audit behavior remained unchanged.
- Simultaneous guest saves returned one HTTP 200 and one HTTP 409 in 0.169/0.171 seconds. The draft advanced exactly one revision and wrote exactly one guest-save audit entry.
- Stale begin-edit returned HTTP 409 in 0.214 seconds. Stale QR rotate/revoke requests for both fictional sites returned HTTP 409 in 0.215–0.303 seconds without changing their grants.
- Hosted logs recorded exactly eight `PT409` errors and eight HTTP 409 responses for these eight rejected requests, with no `40001` errors in the retest window. No repeated-error storm or active checklist RPC session remained.
- All finalized versions, attachment metadata and Storage metadata matched their pre-retest hashes. All profiles and locations returned to their exact pre-retest state. Pre-existing submissions and unrelated audit records remained unchanged.
- Both new QR grants were revoked and all four accounts were globally signed out and made inactive/unassigned again. Database verification found zero active grants/profiles and zero QA sessions. No accounts or evidence were deleted.

Compatibility with latest draft PR #60 (`c5e59f5`) was rechecked: clean automatic merge and **510 combined application tests passed**. Corrected endpoint handler SHA-256: `9100b35864a07e5b87399fc127496e8c66552bea5c03c3187692d72379566012`.

Precise in-transfer upload/download revocation, the final Storage metadata insertion as distinct from its initial permission probe, and real browser/device acceptance remain unverified. Successful normal private uploads and post-revocation denial do not establish those timing guarantees.


## Local-only occurrence deadline correction: 2026-11-12

The owner clarified the required correction periods after the hosted acceptance recorded above. Those earlier results tested first-submission-day deadlines and do not certify the new rule.

New follow-on migration `20261112184148_checklist_occurrence_deadlines.sql` must follow both prior QR migrations. It replaces only the deadline helper and dispatcher: daily cutoffs use `period_date + 1`; weekly cutoffs use `period_date + 7` (the occurrence is already a Monday). Both convert midnight using the immutable template timezone snapshot. Unsigned initial drafts have no correction deadline, preserving multi-day/week draft saves and evidence uploads. All read capabilities, correction saves, evidence insertion and upload finalization use the authoritative helper; previously stored deadlines cannot override it. New submissions also store the corrected deadline. Existing stored rows are not backfilled.

The three `PT409` sites and existing function grants are preserved. No templates, attribution, initial submission timestamps, versions, attachments, Storage objects, or audit rows are migrated. UI copy describes the assigned day/week rather than a same-submission-day correction. Historical audit descriptions in the dated evidence above remain unchanged.

Local regression coverage includes late daily/weekly submissions, old weekly draft uploads and continuation, weekly corrections despite legacy early cutoffs, expired corrections despite legacy future cutoffs, unchanged original history/evidence/attribution, exact cutoff boundaries, spring/fall DST (23/25-hour days and 167/169-hour weeks), year/leap boundaries, and migration invariance for existing rows and function privileges.

This follow-up is local only, not pushed, installed in hosted development or production, or deployed. Hosted deadline checks and device acceptance must use this corrected revision after separate authorization. The hosted transfer-race and independent evidence-backup verification gates remain open.

Validation for this local follow-up: 493 application tests and 80 isolated PostgreSQL tests passed; both default-base and root-base production builds passed; `git diff --check` passed. The original two QR migrations and package manifests/lockfile are unchanged. No hosted validation is claimed for this follow-up.
