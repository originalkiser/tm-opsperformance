> Controlled release authorized November 16, 2026, conditional on final gates passing. Assignment corrected to Opening. See [mapping correction](checklist-photo-opening-mapping-correction.md).

# Checklist photo integrity staged release

Draft PR #68. The user separately authorized controlled production backend preparation: the disabled bootstrap, compatible endpoint deployment and historical registry writes have now completed. **Duplicate-photo enforcement remains disabled. Final activation, Opening publication, frontend deployment and merge are now conditionally authorized by the user; stop at any failed gate.** See [backend execution record](checklist-photo-integrity-backend-2026-11-15.md). The sequence below is the reviewed runbook; it does not itself grant permission for any remaining step.

## Artifacts and scope

- Bootstrap: `app/supabase/migrations/20261116023332_checklist_photo_integrity.sql`, revised before any production installation. It creates private state with enforcement **false** and queues both existing and transition-era photos.
- Endpoint: existing `checklist-access` only. The new handler accepts the old dispatcher before bootstrap; bootstrap accepts original hash-less endpoint requests while staging. Updated endpoint requests carry a server-owned protocol marker and compute SHA-256 from image bytes.
- Historical maintenance: existing `scripts/hash-checklist-photo-history.mjs`; service-only `checklist_photo_history` actions reconcile, batch, record and report. No object, submission, snapshot, signature or QR mutation is performed by hashing.
- Activation: service-only `checklist_photo_history('activate',...)`, serialized against all photo registration/verification writers. It is not invoked by bootstrap, endpoint traffic, frontend loading or a timer.
- Prospective Opening template: separate `app/supabase/migrations/20261116031924_opening_trap_door_inspections.sql`, which refuses execution before backend activation. Existing snapshots remain unchanged.

The change remains limited to the approved five operational checklists, photo integrity and Opening replacements, plus their targeted tests/release instructions. Both Management Audits retain their definitions, native picker options, authorization and QR exclusion. No Admin editor, dependency, bucket-policy or unrelated application changes are included. Source SHA-256 values are recorded with the frozen reviewed head before any future hosted step.

Frozen staged artifact checksums (SHA-256 of local source only):

| Artifact | SHA-256 |
| --- | --- |
| `20261116023332_checklist_photo_integrity.sql` | `85fa94be7ca20791da0afeb6e99cb87e44c5e67deb5f8cd5de53720fd99a04d4` |
| `20261116031924_opening_trap_door_inspections.sql` | `93696671f683557ac50347294cd1e7b04ed4e696af041624143dc0b87c489616` |
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

1. **Finish recovery and device acceptance.** Verify a current, synchronized AES-256 evidence copy and its metadata/checksum manifest, isolated photo/signature restoration, complete operational-photo readability, and database recovery point. Preserve all previous backups and keep passwords in macOS Keychain. Complete the physical iPhone/Android capture-save-reopen-submit acceptance before frontend release; the user separately authorized backend preparation while device acceptance remains pending. Freeze the reviewed source/artifact checksums.
2. **Obtain separate bootstrap approval.** Execute only `20261116023332_checklist_photo_integrity.sql` once in the confirmed production project `qbdvixxooofdlfurcpqy`; do not run `db push` over the historical directory. The production CLI migration ledger is absent. Verify by actual objects/functions/ACLs: enforcement false, normal old-client upload/submission, queue creation, and original records/snapshots/policies preserved. No history gate or PM change is installed at bootstrap.
3. **Obtain separate endpoint deployment approval.** Deploy only the frozen `checklist-access` files. Keep the existing `verify_jwt=false` configuration, account/QR validation and all other functions/secrets unchanged. Use the established authenticated Supabase Dashboard function editor/deployment workflow for the reviewed existing function, preserving all entry files and configuration. The following previously inspected CLI command is only an optional equivalent for an already authorized CLI session; do not install or authenticate a CLI as a prerequisite:

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

   The established authenticated Dashboard can also run the maintenance SQL under an explicitly scoped `SET LOCAL ROLE service_role` transaction after separate write approval. For that route, export the current batch, download and verify each object through the established Storage workflow, and prepare bounded `record` calls from those bytes. Recheck attachment identity/path and current Storage ID/size/eTag against the downloaded snapshot before each batch; any drift or failed read stops that batch. This uses the same maintenance function and no new credential. Reconcile and download new arrivals before readiness. The script route above remains optional and requires an existing secure server credential; lack of a CLI session is not a blocker.

   Repeat default batches without a cursor until pending work drains. Newly uploaded photos are queued automatically or verified by the compatible endpoint. Run reconciliation and catch-up again after initial batches. UUID cursors are optional; a final run without a cursor is required to catch arrivals that sort before an earlier cursor. Explicit failed-read retries use `--retry-inaccessible`. Preserve originals; never delete evidence to obtain readiness.
5. **Verify readiness for every eligible location.** The report must include the reviewed complete set (currently 20), zero unverified retained operational photos, zero inaccessible/missing objects, zero in-flight photo uploads, the attested deployment and `endpoint_drained=true`. A busy instant may postpone activation without affecting uploads. Reconcile legitimate operational changes against the preflight inventory; do not claim that old counts are still current.
6. **Obtain separate activation approval.** Submit the exact reviewed location-ID list. Activation locks the phase row and repeats readiness checks atomically; do not bypass them.

   ```sql
   select public.checklist_photo_history('activate',jsonb_build_object(
     'expected_location_ids','<reviewed complete JSON array of eligible UUIDs>'::jsonb));
   ```

   Verify enforcement true, safe retries, duplicate rejection, retained draft/correction evidence, QR restrictions and unchanged audits. Only after backend verification, separately apply `20261116031924_opening_trap_door_inspections.sql` to publish the prospective Opening version. This second artifact also checks activation and the exact old question before changing the template.
7. **Obtain separate merge/frontend release approval.** Merge the frozen reviewed head with a normal message; let the existing GitHub Pages/Cloudflare production integrations deploy. Do not add a second deployment path. Inspect both hosts and perform approved non-destructive smoke checks. Branch preparation commits use `[CF-Pages-Skip]`; never dispatch deployment workflows during preparation.

## Current verification and limits

18 focused SQL checks and 13 endpoint/worker checks passed, plus both native concurrency scripts. The focused correction checks cover old QR/account photos and final submissions during staging, observation duplicates, late arrivals/reconciliation, readiness across 20 fictional eligible sites, missing/inaccessible files, endpoint/drain gating, in-flight uploads, unauthorized activation, retained corrections and deferred prospective PM. Native PostgreSQL uses genuinely overlapping sessions to prove activation cannot miss a concurrently committing historical photo, a new upload can continue after activation, and unique claims still reject simultaneous new duplicates. No broad suite or frontend rebuild was repeated.

Prior read-only production preflight found matching current-main function bodies and expected private Storage/QR/audit controls, the compatible version-1 PM baseline and no installed registry. All counted evidence had Storage metadata records. Sampled bytes rendered, but a sample did not certify the full inventory. The existing encrypted OneDrive copies were present and encrypted but predated later uploads; database backups exclude Storage bytes. Production inventory, credentials, file paths and images are not published in this repository.

The existing authenticated Edge Supabase Dashboard and restricted company OneDrive sessions remain available. The earlier CLI-only backup attempt was abandoned; missing CLI authentication was not a production-access blocker. The established browser workflow exports Storage folder ZIPs and a read-only metadata snapshot into AES-256 staging, then reconciles paths, source checksums and SHA-256 values locally. No new production credentials, authentication method or infrastructure is required for backup verification. Historical registry writes remain separately authorized; local backup checksums do not activate or populate production enforcement.

The authorized refresh verified all 361 evidence objects (170 operational photos and 191 signatures) against their source sizes and Storage eTag/MD5 checksums, reread SHA-256 values, and decoded every image. All 20 eligible locations were included; none had a missing Storage metadata record, inaccessible photo or decoding failure. Four sites currently have no operational photos. The before/after metadata snapshots at 03:51:04 and 03:57:42 UTC on November 16 matched for objects, attachments, 137 submissions, 104 versions, 303 upload intents, 506 checklist audit entries, seven templates and zero correction working copies. Twelve server draft records remained present despite the reported browser autosave cleanup; neither drafts nor evidence were removed during verification. Under the subsequent controlled-backend authorization, all 170 retained operational photos were recorded successfully in the production registry. See the execution record for final reconciliation and readiness; enforcement remains disabled.

The new AES-256 backup and its full private manifest preserve object paths and associated metadata. The restricted company OneDrive web session confirmed synchronization; an independently downloaded cloud copy matched the sealed archive SHA-256. All 361 archived files passed SHA-256 verification again from that copy. A photo and signature were restored and decoded in a separate encrypted volume. Access remains limited to the two existing owners with no sharing links. The existing Keychain credential remains separate; both previous verified backups are preserved. Temporary encrypted staging is detached and removed after verification, and the original browser download destination is restored. Private inventory, checksums and evidence remain outside this repository. The managed database recovery point at November 15, 10:56:08 UTC was reconfirmed immediately before bootstrap installation; recheck its recency before later hosted changes. This evidence backup supplements, rather than replaces, managed database recovery.

## Recovery

Before activation, stop maintenance if a read fails; staging remains available. Do not restore production or delete evidence. Preserve pending/inaccessible results for resolution.

After activation, an application-only rollback cannot remove server enforcement. Any server backout or endpoint rollback requires a fresh reviewed, data-preserving authorization; never silently route back to a hash-less endpoint. Retain the private registry, source images, drafts, completed records, original snapshots, corrections, versions and audit trails. A whole-database restore is not routine recovery and does not restore deleted Storage bytes.
