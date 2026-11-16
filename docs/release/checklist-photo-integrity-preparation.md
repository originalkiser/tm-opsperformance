# Checklist photo integrity release preparation

Status: draft PR #68, **NO-GO for production deployment as currently packaged**. This document authorizes no migration, production hashing, enforcement activation, endpoint deployment, merge or release. No broad suites were repeated during this preparation.

## Frozen proposal

Base: `origin/main` `ffc5b6f2f1de2bfeaca0906c761eabffe886da71`.
Implementation: `2e80960211c910bbbe2eb0b2a970cbef6477bc95` on `codex/checklist-photo-integrity`.

Reviewed diff contains only the five-checklist camera controls, server duplicate protection, historical hash maintenance, prospective PM replacement, and their focused tests/documentation. Audit questions/pickers, dependencies, other features and Storage policies are unchanged. No Admin editor was added. Branch commits use `[CF-Pages-Skip]`; GitHub Pages triggers only for main or explicit workflow dispatch. Do not dispatch a workflow. A separately authorized future merge must use a normal non-skip message.

Frozen file SHA-256 values (source artifacts only, not production evidence):

| Artifact | SHA-256 |
| --- | --- |
| `app/supabase/migrations/20261116023332_checklist_photo_integrity.sql` | `79677c952df43824388b4c2d1531f425df31f3d5dc7f47a44a2b4e38c8f4d488` |
| `scripts/hash-checklist-photo-history.mjs` | `7ff5b37646dc3a102a22e9f9047d70d648858170df5f32147f48c5b5544295d3` |
| `app/supabase/functions/checklist-access/handler.js` | `3a0b14520050b434134a9de4ee9023be2ab2cae8b34dfc8864506ad25babec4a` |

## Read-only production preflight

Production was independently identified in the signed-in Dashboard as `tm-opsperformance`, main PRODUCTION, reference `qbdvixxooofdlfurcpqy`. The connected MCP and CLI did not have production read access, so database checks used SELECT-only Dashboard queries. No `access_action` requests were issued: even guest read/context requests can update rate counters. No records, QR grants or policies were changed. Unsaved query text was discarded without saving a shared query.

All 13 inspected checklist function-body fingerprints match current main's owning migrations: dispatcher, account/QR actor helper, assignments, deadlines, evidence selection, Storage insertion guard, QR template allowlist, version recorder, reply, final validation, legacy attachment/save RPCs and service wrapper. Inspected SECURITY DEFINER functions retain empty search paths and expected execute grants; dispatcher/service wrapper remain unavailable to browser roles. Private/checklist tables have RLS. Seven evidence Storage policies retain authenticated assignment checks, anonymous exclusion and direct update/delete guards. The bucket remains private, 10 MB, JPEG/PNG/WebP.

All 20 QR grants are active. Both Management Audit keys return false from the QR allowlist; the five operational keys return true. The deployed checklist-access endpoint's observed upload/finalization logic matches the current baseline and still uses immutable uploads and server intents. Its Dashboard reported no errors since deployment at the time inspected. No live submission, correction, token rotation or authorization mutation was tested.

Weekly PM is version 1 with 80 items and the exact generic `weekly-pm-conveyer-10` expected by the replacement assertion. The proposed version becomes 81 items. Both audits remain version 1, with 78 and 43 items. No hash registry/claims tables are installed. There is no Supabase CLI migration ledger; production installations must be checked by actual definitions, not `db push` against the complete historical migration directory.

Evidence metadata has matching object records, supported MIME types and positive sizes; there were no unattached object records. An operational JPEG and a signature rendered through the existing Dashboard preview. **This sample does not certify that every historical photo's bytes are readable.** Full byte-level accessibility remains unverified without batch read access. No production image bytes were hashed or exported, and no inaccessible photo has been positively identified. Per-site counts and the private backup-coverage assessment are retained outside the repository; no object paths, tokens, submissions or images are published here.

Clearing browser recovery copies is distinct from discarding saved server drafts. Current server counts still include drafts and a small amount of draft evidence. Prior values cannot be reconstructed from a later count alone; ordinary concurrent activity may also add new drafts. Completed evidence remains in scope for hashing. Do not delete further records as preparation.

## Blocking rollout conflict

**Do not execute the frozen migration unchanged.** It seeds historical fingerprints as pending and immediately replaces `upload_begin` with a pending/inaccessible-history gate. Sites with existing photos would lose the ability to add new photos until backfill completes. Installing it before the old endpoint is updated also makes its hash-less `upload_finish` requests fail. This conflicts with the user's uninterrupted-submission requirement; it is not evidence that historical files are missing.

The hashing script itself only downloads existing bytes and records fingerprints/results in the new private registry. Its maintenance SQL writes only `photo_fingerprints` and `photo_claims`. It does not overwrite/delete Storage objects, alter submitted answers or snapshots, or change QR grants. The problem is activation timing in the bundled migration, not destructive hashing.

## Required staged sequence — local revision not yet authorized or implemented

The exact current artifacts are frozen above, but a deployable no-interruption sequence cannot use that single migration. The next step is a narrowly scoped local staging revision and targeted cutover tests, followed by another review of exact artifact checksums. No replacement migration filenames or activation commands are invented in this preparation.

1. **Before hosted work:** finish physical iPhone/Android acceptance; refresh and verify the existing encrypted evidence backup to cover the current object inventory; confirm a current database recovery point; freeze revised bootstrap/activation SQL and endpoint bytes. Restore verification must be isolated, never a production restore.
2. **Bootstrap only, enforcement inactive:** install the additive fingerprint queue/maintenance surface and a nonblocking mechanism that captures *every new operational attachment* during backfill. Preserve old upload/finalize clients and all existing authorization. Do not install the current pending-history gate or switch the PM template yet.
3. **Deploy only checklist-access in compatible observation mode:** compute and persist hashes for new photos, with safe retries, while accepting legitimate pre-activation duplicates as historical evidence. The bootstrap and endpoint must work in either transition order, including in-flight uploads. This deployment requires separate authorization. Other functions/secrets/JWT settings remain unchanged.
4. **Historical hashing:** after explicit hashing authorization, run bounded batches of the existing script against the frozen production origin using credentials supplied through the established secure execution mechanism. Repeated default runs process only pending objects; `--retry-inaccessible` is explicit. Capture each report and run catch-up batches for concurrent arrivals. Original images, drafts, submissions and versions remain untouched. Do not skip inaccessible retained evidence or mark it verified without reading it.
5. **Readiness check:** all 20 locations must have zero unverified retained operational photos, no inaccessible objects, current backup coverage and compatible in-flight upload handling. Stale/unfinished genuine draft evidence must be retained, not deleted to clear readiness. Counts will have changed if operations continued.
6. **Separate atomic activation:** after a fresh explicit GO, activate duplicate checks only once the registry is complete, with transaction-safe serialization against concurrent registration and preserved retries/retained correction evidence. Apply the prospective Weekly PM template replacement here or in its separately reviewed release transaction. This step needs a reviewed activation artifact and its own authorization.
7. **Frontend release:** after explicit merge/release authorization, merge the frozen reviewed head with a normal message, allow the existing GitHub Pages/Cloudflare production integrations to deploy, then perform non-destructive account/QR/audit/camera/retention smoke checks. Do not create a second deployment path.

Future bounded hashing command, **not run and not authorized now**, after its revised bootstrap prerequisites are installed:

```sh
# CHECKLIST_HASH_URL and CHECKLIST_HASH_SERVICE_KEY must already be supplied securely.
node scripts/hash-checklist-photo-history.mjs --execute --expected-origin=https://qbdvixxooofdlfurcpqy.supabase.co
# Retry failed reads explicitly, without silently skipping them:
node scripts/hash-checklist-photo-history.mjs --execute --expected-origin=https://qbdvixxooofdlfurcpqy.supabase.co --retry-inaccessible
```

The inspected CLI v3.0.0 syntax for deploying only the endpoint, **not run**, is:

```sh
# From app/, only after separate approval and frozen compatible endpoint review:
supabase functions deploy checklist-access --remote=qbdvixxooofdlfurcpqy --use-api
```

Retain `verify_jwt=false` from the existing function configuration because this endpoint performs its own account/QR validation. Do not deploy every function, use `--prune`, expose service keys, or replace audit-aware helpers with older definitions.

## Backup and recovery

Both existing OneDrive encrypted DMGs were located and encryption independently verified without unlocking them. The latest file is the November 12 refresh. Production has evidence created after that backup, so it is **not a current complete evidence recovery copy**. Its contents/manifest and restore password availability were not reverified; no password was requested or inspected. A November 15 database backup is visible, but Supabase explicitly excludes Storage object bytes from database backups.

Keep both existing backups. A separately authorized encrypted refresh and isolated verification are needed before release. Routine recovery remains application-first and non-destructive: preserve submissions, template snapshots, correction versions, QR grants, evidence and registry. An application-only revert cannot remove a server-side gate; the staging/activation revision must include a reviewed data-preserving server backout. Do not drop tables, reset QR grants, delete evidence or restore production wholesale as routine rollback.

Recommendation: GO for draft review, NO-GO for the current deployment package. Next authorization should cover only the local nonblocking staging revision/targeted tests and a separately scoped current encrypted-backup refresh/read verification. Production execution, hashing, activation and release remain withheld.
