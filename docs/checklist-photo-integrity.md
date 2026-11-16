# Checklist photo integrity and Weekly PM replacement

Implementation is published in draft PR #68. See [release preparation](release/checklist-photo-integrity-preparation.md) for the nonblocking staged sequence, read-only preflight and current release gates. The separately authorized production backend preparation is complete: disabled bootstrap, compatible endpoint and 170 verified historical fingerprints. See the [execution record](release/checklist-photo-integrity-backend-2026-11-15.md). Enforcement, template publication, frontend release and merge remain on hold.

## Baseline and scope

Fetched `originalkiser/tm-opsperformance` `origin/main` at `ffc5b6f` (PR #67). Dedicated branch: `codex/checklist-photo-integrity`. Worktree: `/Users/christopherwilliams/Developer/tm-ops-checklist-photo-integrity`. The original `codex/operations-consistent-colors` checkout and its untracked work are preserved.

Current source includes the Management Audits migration, scoped QR grants, correction working copies and immutable versions, occurrence deadlines, mobile validation feedback, draft reopening and conflict handling. This is source verification, not a claim that live database objects were inspected during this task.

Changes apply to Opening, Mid-Day, Closing, Weekly Manager Administrative and Weekly PM. Monthly Site Assessment and Quarterly Safety Audit retain their library/camera picker, templates, validation and authenticated-only access. No Admin editor was built or extended.

## Capture and verification

Operational photo controls use `getUserMedia`, a camera preview, Take photo and Cancel camera. No file picker or library fallback is rendered. HTTPS and camera permission are required. Cancellation, denied/unavailable cameras, late permission responses, leaving the form and disabled upload state release camera tracks. Camera failures do not prevent saving incomplete answers. Existing previews, recovery copies, signatures and correction forms use their existing paths.

The existing `checklist-access` Edge Function validates image type, signature bytes and size, then computes SHA-256 from image bytes. Caller-provided hashes are not whitelisted. Immutable Storage uploads and server-owned upload intents remain in place. During staging, uploads remain accepted and the insertion trigger queues every operational photo, including legacy RPC uploads. Once separately activated, the service-only SQL finish action atomically claims `(location_id, sha256)` before registering a new operational attachment. Its unique constraint resolves competing transactions; rejected work rolls back both the fingerprint and attachment. Signatures and Management Audit photos do not participate.

A table trigger blocks the legacy attachment RPC and direct attachment insertion from registering an operational photo without a matching server verification and upload intent. After activation, final submission verifies operational evidence against the registry, in addition to existing required-photo checks. Staging retains normal draft/submission behavior. No Storage policies, bucket settings, existing image objects, answers, signatures, authorization rules, QR allowlist or deadlines are rewritten.

Stable photo request UUIDs let the same upload/verification finish repeat safely during its authorized draft/correction lifecycle. If an interrupted response left an object uploaded, the server downloads and hashes that object before completing registration; it never overwrites it. Registered-photo retries return the existing attachment after checking hash and authorization. New attachment IDs cannot reuse the same hash, even within the same checklist. Retaining the original attachment during reopening/correction is allowed. No automatic browser retry is introduced. Request IDs are held only while the transport/file object remains in memory; reload uses existing server evidence and draft recovery.

## Historical coverage

The bootstrap migration snapshots existing operational photo attachment IDs into a private pending queue and continuously tracks staging arrivals. Enforcement defaults to disabled. `scripts/hash-checklist-photo-history.mjs` downloads and hashes at most 25 existing photos per invocation, persisting each result before advancing. Run again without a cursor to resume pending work; use `--retry-inaccessible` to retry failures. Cursor paging is also available via `--after=<attachment UUID>`.

Every failed download or unsupported image is recorded as `inaccessible`, with an attachment/location ID and bounded reason in the report. Historical duplicates are indexed without rejecting or rewriting their evidence. Repeated successful records are idempotent; conflicting hashes are rejected. The maintenance RPC is executable only by `service_role` and is not exposed through checklist-access or QR access. The operator script requires explicit execution, an exact expected origin and separately provided server credentials; it never prints credentials or image bytes.

Historical verification never blocks submissions during staging. Pending, inaccessible or missing retained photos block **activation**, with affected locations listed in the service-only readiness report. Activation also requires the verified endpoint deployment, a ten-minute worker-drain interval, the exact reviewed eligible-location set, and zero in-flight photo uploads. All phase-sensitive writers acquire a shared control-row lock; activation takes its exclusive lock and rechecks readiness before changing the flag. No application role can attest deployment, reconcile the queue or activate enforcement. Authorized discard removes its unhashed draft queue entry; verified fingerprints remain available to detect later reuse. No new production deletion is part of preparation.

## Opening prospective version — corrected assignment

Release preparation is paused. Production read-only comparison confirms Opening version 1 has 31 questions. Update only `opening-9` and `opening-10`, the first two Tunnel Inspection items, in place with the approved wording, Critical status, one required photo each and the grate-removal instruction. Keep the existing `opening-6` gauge photo, giving three required photos total.

The separate `20261116031924_opening_trap_door_inspections.sql` artifact replaces the unapplied, incorrect Weekly PM proposal. It requires verified backend activation and the exact Opening version-one baseline before publishing version two. It changes only these two items; saved snapshots, drafts, corrections and submissions remain unchanged. The existing server validator rejects final submission without each required photo; incomplete drafts remain valid.

Weekly PM remains exactly its production version-one definition: 80 items (62 main and 18 conditional), including the original generic trap-door condition/bolt question. Its two item signatures and final auditor signature remain required. No Q28/Q29 additions are proposed. See [verified mappings and signature findings](release/checklist-photo-opening-mapping-correction.md).

## Focused staging verification

The staging correction ran only the directly affected suites: 18 isolated SQL checks (staging/activation and photo integrity), 13 endpoint/historical-worker checks, and two native PostgreSQL concurrency scripts. These cover old QR/account uploads and final submission with pending history; observation-mode duplicate acceptance; queue reconciliation; all 20 eligible fictional locations; inaccessible/missing history; endpoint deployment/drain gating; in-flight upload gating; unauthorized activation denial; saved-photo corrections; deferred prospective template publication; atomic activation racing uploads; and post-activation duplicate races.

The earlier implementation's 138 focused UI/rules tests, mobile browser simulations, 24 SQL tests and build remain historical evidence. No broad suite or frontend rebuild was repeated for this SQL/endpoint staging correction. Physical iPhone/Android acceptance is still required. The earlier full app run had the same 46 pre-existing harness failures as main; these were not rerun or repaired here.

```sh
PGLITE_MODULE=/path/to/pglite/dist/index.js node --test scripts/tests/checklist-photo-staging-sql.test.mjs scripts/tests/checklist-photo-integrity-sql.test.mjs
node --test app/tests/checklistGuestEndpoint.test.js app/tests/checklistPhotoHistory.test.js
PHOTO_TEST_TOOLS=/path/to/temp/node_modules node scripts/tests/checklist-photo-staging-concurrency.mjs
PHOTO_TEST_TOOLS=/path/to/temp/node_modules node scripts/tests/checklist-photo-concurrency.mjs
```

Temporary test dependencies remain outside the repository: PGlite 0.3.14, embedded-postgres 18.6.0-beta.19 and pg 8.16.3. No runtime dependencies were added.

## Browser limits and release blockers

`getUserMedia` removes the normal library path from this application's UI. It does not provide the server with proof of physical camera provenance, scene freshness, removed grates or actual inspection. Modified clients, virtual cameras or photographing an old image remain possible. SHA-256 detects identical bytes, not visually equivalent images: cropping, recompression, metadata edits and screenshots can evade it. No AI recognition, face recognition or device location tracking is introduced. See [camera API requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [limited support for the HTML capture attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture); this implementation does not rely on `capture` alone.

Before any release, separately authorize and coordinate the migration, updated existing Edge Function and frontend; verify installed production definitions/ACLs against the release baseline; run database advisors and production-safe preflight checks; hash all historical operational photos and resolve inaccessible objects; perform actual iPhone Safari and Android Chrome camera/permission/correction acceptance. Backfill completion gates only the later atomic activation; bootstrap and observation do not stop new submissions. The ten-minute drain exceeds the currently documented 400-second paid Edge worker lifetime; recheck [runtime limits](https://supabase.com/docs/guides/functions/limits) before release. The full app test suite's 46 baseline failures also remain visible for the release decision. Controlled backend preparation has now completed under separate user authorization. Enforcement remains disabled; PM template publication, frontend release and merge have not occurred.
