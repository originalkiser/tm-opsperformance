# Checklist photo integrity and Weekly PM replacement

Local implementation only. No hosted SQL, function deployment, production upload, release, push or merge is authorized by this document.

## Baseline and scope

Fetched `originalkiser/tm-opsperformance` `origin/main` at `ffc5b6f` (PR #67). Dedicated branch: `codex/checklist-photo-integrity`. Worktree: `/Users/christopherwilliams/Developer/tm-ops-checklist-photo-integrity`. The original `codex/operations-consistent-colors` checkout and its untracked work are preserved.

Current source includes the Management Audits migration, scoped QR grants, correction working copies and immutable versions, occurrence deadlines, mobile validation feedback, draft reopening and conflict handling. This is source verification, not a claim that live database objects were inspected during this task.

Changes apply to Opening, Mid-Day, Closing, Weekly Manager Administrative and Weekly PM. Monthly Site Assessment and Quarterly Safety Audit retain their library/camera picker, templates, validation and authenticated-only access. No Admin editor was built or extended.

## Capture and verification

Operational photo controls use `getUserMedia`, a camera preview, Take photo and Cancel camera. No file picker or library fallback is rendered. HTTPS and camera permission are required. Cancellation, denied/unavailable cameras, late permission responses, leaving the form and disabled upload state release camera tracks. Camera failures do not prevent saving incomplete answers. Existing previews, recovery copies, signatures and correction forms use their existing paths.

The existing `checklist-access` Edge Function validates image type, signature bytes and size, then computes SHA-256 from image bytes. Caller-provided hashes are not whitelisted. Immutable Storage uploads and server-owned upload intents remain in place. The service-only SQL finish action atomically claims `(location_id, sha256)` before registering a new operational attachment. Its unique constraint resolves competing transactions; rejected work rolls back both the fingerprint and attachment. Signatures and Management Audit photos do not participate.

A table trigger blocks the legacy attachment RPC and direct attachment insertion from registering an operational photo without a matching server verification and upload intent. Final submission verifies operational evidence against the registry, in addition to existing required-photo checks. No Storage policies, bucket settings, existing image objects, answers, signatures, authorization rules, QR allowlist or deadlines are rewritten.

Stable photo request UUIDs let the same upload/verification finish repeat safely during its authorized draft/correction lifecycle. If an interrupted response left an object uploaded, the server downloads and hashes that object before completing registration; it never overwrites it. Registered-photo retries return the existing attachment after checking hash and authorization. New attachment IDs cannot reuse the same hash, even within the same checklist. Retaining the original attachment during reopening/correction is allowed. No automatic browser retry is introduced. Request IDs are held only while the transport/file object remains in memory; reload uses existing server evidence and draft recovery.

## Historical coverage

The migration snapshots the existing operational photo attachment IDs into a private pending queue. `scripts/hash-checklist-photo-history.mjs` downloads and hashes at most 25 existing photos per invocation, persisting each result before advancing. Run again without a cursor to resume pending work; use `--retry-inaccessible` to retry failures. Cursor paging is also available via `--after=<attachment UUID>`.

Every failed download or unsupported image is recorded as `inaccessible`, with an attachment/location ID and bounded reason in the report. Historical duplicates are indexed without rejecting or rewriting their evidence. Repeated successful records are idempotent; conflicting hashes are rejected. The maintenance RPC is executable only by `service_role` and is not exposed through checklist-access or QR access. The operator script requires explicit execution, an exact expected origin and separately provided server credentials; it never prints credentials or image bytes.

New operational photo uploads are blocked **at a location with pending or inaccessible legacy photos** until its queue is verified. This prevents claiming complete protection while earlier files are unindexed. Answers, incomplete draft saves, retained evidence and Management Audits remain available. This temporary gate is a release coordination requirement. Inaccessible retained files are genuine blockers to full historical coverage; there is no silent skip or enable override. Authorized discard removes an unhashed legacy draft's queue entry so a deliberately deleted draft cannot strand a location. Verified fingerprints are retained if draft evidence is discarded; image bytes are removed through the existing discard flow.

## Weekly PM prospective version

The baseline has one noncritical `weekly-pm-conveyer-10` generic trap-door question and no two Critical Tunnel Equipment questions. Per the user's clarification, the new template removes only that generic item and adds two completion items at the end of Tunnel Equipment (28 and 29), preserving every other item, section, ID, number and instruction.

1. Entry Trap Door: “Remove the front grate(s) and inspect the entry trap door and carriage for proper tension. Listen for any air leaks. Check the trap door’s condition and confirm its bolts are tight.”
2. Exit Trap Door: “Remove the last two grates at the tunnel exit. Inspect the exit trap door, sprockets for wear and proper alignment, and the HECO drive for chemical leaks or debris. Check the trap door’s condition and confirm its bolts are tight.”

Both are Critical, require a separate photo and display: “Photo must clearly show the inspected components with the grate(s) removed.” The added sentence retains the generic item's explicit door-condition and bolt-tightness requirements. Inventory becomes 63 main items, 18 conditional follow-ups and 38 Critical items (including one Critical follow-up).

The migration updates only `checklist_templates` for Weekly PM and increments its version. A baseline assertion stops if the generic item no longer matches. Existing drafts, completed records and original template/version snapshots are untouched. Required-photo validation runs only for final submission; incomplete drafts remain valid. Existing corrections retain their original template snapshots and legitimate saved photos, while the existing new-signature rules still apply.

## Verification

- 138 focused checklist/Weekly PM JavaScript tests passed, including camera permission/cancellation, uploads, duplicate messaging, draft continuation, correction retention, signatures and QR behavior.
- 24 isolated PostgreSQL tests passed: 10 photo-integrity tests plus all 14 existing Management Audit SQL regression cases with the new migration enabled where applicable.
- Native PostgreSQL test with two separate sessions confirmed genuine overlap: one claim/attachment committed; the competing identical photo was rejected atomically.
- Chromium with simulated camera passed at 390px iPhone and 360px Android viewports/user agents: live preview, cancel, JPEG capture, duplicate message, no operational library picker, audit picker retained, camera denial/unavailability and incomplete draft save. Screenshots were visually inspected. This is not physical iOS/Android or Safari verification.
- Existing mobile feedback browser regression passed at 360px/390px (seven scenarios each), with external requests blocked.
- Production build passed. Existing duplicate JSX attribute and bundle-size warnings remain.
- Full JavaScript suite: 581 tests, 535 passed, 46 failed. A clean `origin/main` archive produced the same 46 failing test names (all report `DailyLogRevenueGoal is not defined` in existing harnesses); this change adds no failures. Those unrelated failures were not repaired.

Focused commands (temporary dependencies are outside the repository):

```sh
node --test app/tests/checklist*.test.js app/tests/weeklyPm.test.js
CHECKLIST_PHOTO_INTEGRITY=1 PGLITE_MODULE=/path/to/pglite/dist/index.js node --test scripts/tests/checklist-photo-integrity-sql.test.mjs scripts/tests/management-audit-sql.test.mjs
PHOTO_TEST_TOOLS=/path/to/temp/node_modules node scripts/tests/checklist-photo-concurrency.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/tests/checklist-photo-browser.mjs
```

The temporary native test tool versions were `embedded-postgres@18.6.0-beta.19` and `pg@8.16.3`; PGlite `0.3.14`; Playwright `1.56.1`. No runtime or package-lock dependency changes were made.

## Browser limits and release blockers

`getUserMedia` removes the normal library path from this application's UI. It does not provide the server with proof of physical camera provenance, scene freshness, removed grates or actual inspection. Modified clients, virtual cameras or photographing an old image remain possible. SHA-256 detects identical bytes, not visually equivalent images: cropping, recompression, metadata edits and screenshots can evade it. No AI recognition, face recognition or device location tracking is introduced. See [camera API requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [limited support for the HTML capture attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture); this implementation does not rely on `capture` alone.

Before any release, separately authorize and coordinate the migration, updated existing Edge Function and frontend; verify installed production definitions/ACLs against the release baseline; run database advisors and production-safe preflight checks; hash all historical operational photos and resolve inaccessible objects; perform actual iPhone Safari and Android Chrome camera/permission/correction acceptance. The migration's per-location new-photo gate makes backfill completion part of rollout, not optional follow-up work. The full app test suite's 46 baseline failures also remain visible for the release decision. No production change or historical hashing has been executed here.
