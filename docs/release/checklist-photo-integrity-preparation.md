# Checklist photo integrity staged release

Draft PR #68. The nonblocking staging correction is authorized locally; the encrypted production-evidence backup refresh and read-only accessibility check are authorized separately. **No production database migration, historical registry write, activation, endpoint/frontend deployment or merge is authorized.** All commands below are future runbook instructions, not execution records.

## Artifacts and scope

- Bootstrap: `app/supabase/migrations/20261116023332_checklist_photo_integrity.sql`, revised before any production installation. It creates private state with enforcement **false** and queues both existing and transition-era photos.
- Endpoint: existing `checklist-access` only. The new handler accepts the old dispatcher before bootstrap; bootstrap accepts original hash-less endpoint requests while staging. Updated endpoint requests carry a server-owned protocol marker and compute SHA-256 from image bytes.
- Historical maintenance: existing `scripts/hash-checklist-photo-history.mjs`; service-only `checklist_photo_history` actions reconcile, batch, record and report. No object, submission, snapshot, signature or QR mutation is performed by hashing.
- Activation: service-only `checklist_photo_history('activate',...)`, serialized against all photo registration/verification writers. It is not invoked by bootstrap, endpoint traffic, frontend loading or a timer.
- Prospective PM template: separate `app/supabase/migrations/20261116031924_weekly_pm_trap_door_inspections.sql`, which refuses execution before backend activation. Existing snapshots remain unchanged.

The change remains limited to the approved five operational checklists, photo integrity and PM replacements, plus their targeted tests/release instructions. Both Management Audits retain their definitions, native picker options, authorization and QR exclusion. No Admin editor, dependency, bucket-policy or unrelated application changes are included. Source SHA-256 values are recorded with the frozen reviewed head before any future hosted step.

Frozen staged artifact checksums (SHA-256 of local source only):

| Artifact | SHA-256 |
| --- | --- |
| `20261116023332_checklist_photo_integrity.sql` | `85fa94be7ca20791da0afeb6e99cb87e44c5e67deb5f8cd5de53720fd99a04d4` |
| `20261116031924_weekly_pm_trap_door_inspections.sql` | `a01a0f8aaae84f297c569eccc3830def024f85a0bc9eba7122b22d632d176972` |
| `handler.js` | `6528a9e5b32bb2b465466985b8ec439a744e9a026144491d24d20a614f3ea4e3` |

## Transition guarantees

Staging photos are accepted even when other photos are pending or inaccessible. A BEFORE INSERT trigger tracks each operational attachment, including old endpoint and legacy authenticated attachment-RPC traffic. The trigger is installed before seeding the initial queue, so its relation lock closes the bootstrap insertion gap. Reconciliation is idempotent and only adds missing queue entries.

Verified staging duplicates remain legitimate historical evidence. After activation, the unique location/hash claim rejects identical **new** attachments. Saved evidence and authorized correction retention remain valid. Signatures, required-photo rules, accounts, QR scope, deadlines and version recording retain their existing behavior.

Every phase-sensitive photo writer takes a SHARE lock on the singleton rollout row. Activation takes UPDATE, then rechecks all retained operational photos and all eligible locations before changing `enforced`. It refuses when any of these conditions holds:

- The compatible deployed endpoint has not been independently attested.
- Its ten-minute drain interval has not elapsed. This exceeds Supabase's currently documented 400-second maximum paid-worker lifetime and lets earlier original endpoint requests finish while staging still accepts them. Recheck [official limits](https://supabase.com/docs/guides/functions/limits) before executing the rollout.
- The supplied, reviewed eligible-location IDs differ from the current complete set.
- Any retained operational photo lacks a verified fingerprint or Storage object record, including any newly arriving photo.
- Any operational photo upload intent remains unregistered and unexpired.

A refusal leaves staging active and normal submissions available. Pending/inaccessible/missing files are reported per location; there is no skip, force, clock override or automatic activation API for application users. Endpoint attestation is a privileged operator assertion after checking the actual deployed version and compatibility; it is not inferred from a frontend claim. Test-only clock changes live solely in fictional fixtures.

## Exact future sequence

1. **Finish recovery and device acceptance.** Verify a current, synchronized AES-256 evidence copy and its metadata/checksum manifest, isolated photo/signature restoration, complete operational-photo readability, and database recovery point. Preserve all previous backups and keep passwords in macOS Keychain. Complete the physical iPhone/Android capture-save-reopen-submit acceptance. Freeze the reviewed source/artifact checksums.
2. **Obtain separate bootstrap approval.** Execute only `20261116023332_checklist_photo_integrity.sql` once in the confirmed production project `qbdvixxooofdlfurcpqy`; do not run `db push` over the historical directory. The production CLI migration ledger is absent. Verify by actual objects/functions/ACLs: enforcement false, normal old-client upload/submission, queue creation, and original records/snapshots/policies preserved. No history gate or PM change is installed at bootstrap.
3. **Obtain separate endpoint deployment approval.** Deploy only the frozen `checklist-access` files. Keep the existing `verify_jwt=false` configuration, account/QR validation and all other functions/secrets unchanged. The inspected CLI v3 syntax, from `app/`, is:

   ```sh
   supabase functions deploy checklist-access --remote=qbdvixxooofdlfurcpqy --use-api
   ```

   Inspect the actual deployment version and compatibility results. Then a separately authorized privileged operator may attest that exact deployment:

   ```sql
   select public.checklist_photo_history('attest_endpoint',jsonb_build_object(
     'version','sha256-v1','deployment_id','<verified deployment identifier>'));
   ```

   Reattesting the same deployment is idempotent and does not restart its drain window. A changed deployment restarts it. Continue accepting submissions throughout the window.
4. **Obtain separate historical-hashing approval.** Reconcile existing/new rows, then process bounded batches. Credentials must already be supplied through the established secure execution mechanism; never put them in this file, PR, logs or shell command arguments.

   ```sql
   select public.checklist_photo_history('reconcile');
   select public.checklist_photo_history('report');
   ```

   ```sh
   node scripts/hash-checklist-photo-history.mjs --execute --expected-origin=https://qbdvixxooofdlfurcpqy.supabase.co
   ```

   Repeat default batches without a cursor until pending work drains. Newly uploaded photos are queued automatically or verified by the compatible endpoint. Run reconciliation and catch-up again after initial batches. UUID cursors are optional; a final run without a cursor is required to catch arrivals that sort before an earlier cursor. Explicit failed-read retries use `--retry-inaccessible`. Preserve originals; never delete evidence to obtain readiness.
5. **Verify readiness for every eligible location.** The report must include the reviewed complete set (currently 20), zero unverified retained operational photos, zero inaccessible/missing objects, zero in-flight photo uploads, the attested deployment and `endpoint_drained=true`. A busy instant may postpone activation without affecting uploads. Reconcile legitimate operational changes against the preflight inventory; do not claim that old counts are still current.
6. **Obtain separate activation approval.** Submit the exact reviewed location-ID list. Activation locks the phase row and repeats readiness checks atomically; do not bypass them.

   ```sql
   select public.checklist_photo_history('activate',jsonb_build_object(
     'expected_location_ids','<reviewed complete JSON array of eligible UUIDs>'::jsonb));
   ```

   Verify enforcement true, safe retries, duplicate rejection, retained draft/correction evidence, QR restrictions and unchanged audits. Only after backend verification, separately apply `20261116031924_weekly_pm_trap_door_inspections.sql` to publish the prospective PM version. This second artifact also checks activation and the exact old question before changing the template.
7. **Obtain separate merge/frontend release approval.** Merge the frozen reviewed head with a normal message; let the existing GitHub Pages/Cloudflare production integrations deploy. Do not add a second deployment path. Inspect both hosts and perform approved non-destructive smoke checks. Branch preparation commits use `[CF-Pages-Skip]`; never dispatch deployment workflows during preparation.

## Current verification and limits

18 focused SQL checks and 13 endpoint/worker checks passed, plus both native concurrency scripts. The focused correction checks cover old QR/account photos and final submissions during staging, observation duplicates, late arrivals/reconciliation, readiness across 20 fictional eligible sites, missing/inaccessible files, endpoint/drain gating, in-flight uploads, unauthorized activation, retained corrections and deferred prospective PM. Native PostgreSQL uses genuinely overlapping sessions to prove activation cannot miss a concurrently committing historical photo, a new upload can continue after activation, and unique claims still reject simultaneous new duplicates. No broad suite or frontend rebuild was repeated.

Prior read-only production preflight found matching current-main function bodies and expected private Storage/QR/audit controls, the compatible version-1 PM baseline and no installed registry. All counted evidence had Storage metadata records. Sampled bytes rendered, but a sample did not certify the full inventory. The existing encrypted OneDrive copies were present and encrypted but predated later uploads; database backups exclude Storage bytes. Production inventory, credentials, file paths and images are not published in this repository.

The newly authorized backup/accessibility work requires a production-authorized read session. The connected MCP is development-scoped and the installed CLI was not signed in when the refresh was attempted. No replacement backup, new password, source export, production hash registry write or accessibility success is claimed before that read access is established. The prepared private operator workflow uses only read-only database transactions and Storage downloads, stores a fresh password directly in Keychain, creates a new AES-256 DMG without replacing the old ones, verifies all image checksums plus isolated photo/signature restores, then requires independent OneDrive synchronization confirmation.

## Recovery

Before activation, stop maintenance if a read fails; staging remains available. Do not restore production or delete evidence. Preserve pending/inaccessible results for resolution.

After activation, an application-only rollback cannot remove server enforcement. Any server backout or endpoint rollback requires a fresh reviewed, data-preserving authorization; never silently route back to a hash-less endpoint. Retain the private registry, source images, drafts, completed records, original snapshots, corrections, versions and audit trails. A whole-database restore is not routine recovery and does not restore deleted Storage bytes.
