# Management Audits release preparation

Approved implementation: `33da5543bf48af28816b87fa8fcc87ea7bbf92c1`. This document changes no application or migration code. Its documentation-only commit uses `[CF-Pages-Skip]` to prevent an automatic branch preview. A future approved merge commit must not contain a CI/Pages skip tag.

Migration: `app/supabase/migrations/20261112222936_management_audits.sql`. Prerequisite: all three released PR61 migrations, including occurrence deadlines, plus PR60 reporting. No Edge Function source change or redeployment is required; the existing endpoint delegates authorization to the database.

## Minimum remaining hosted security check (not yet authorized)

Use only the existing `tm-ops-dev` project, two newly labelled fictional audit fixtures with fictional photo/signature evidence, one temporary fictional-site QR grant, and one original-checklist positive control. Preserve existing development records. No physical device, public preview or account activation is required for these QR denial checks.

1. Read-only dev drift check, then separately approved installation of the exact migration once.
2. A valid dev QR context returns only the original five templates and no audit records. An original-checklist control remains accessible.
3. For each audit, the valid same-site QR must receive authorization denial for start, known-ID read/history, begin-edit, save/submit, photo/signature download and multipart upload. Also exercise upload authorization/finalization, including a synthetic stale guest intent. Assert no changed submissions, versions, evidence or audit state after denials.
4. Verify the installed final Storage INSERT guard rejects a guest-intent audit object at final insertion, with no object or attachment registration. This is an audit-exclusion check, not a repeat of the already completed in-transfer revocation race campaign.
5. Revoke the one temporary grant, remove transient credentials/local copies, verify no active temporary access/sessions and preserve pre-existing data. Record only results/fingerprints, never raw capabilities or evidence.

## Exact production sequence (separate authorization required)

1. Freeze approved PR head and migration checksum. Confirm hosted security results, refresh read-only production drift/recovery checks and recheck the 20 eligible-site roster. Stop if any expected definition, function, permission or prerequisite differs.
2. Confirm an available database recovery point and a separately verified encrypted evidence recovery copy covering the evidence present immediately before release. The earlier one-time evidence export is not a backup of later uploads. Take no new export or paid service action without approval.
3. Capture read-only before fingerprints: original five template definitions/versions, QR grant IDs/hashes/generations/activation states (never print secrets), submissions, attachments, versions, working copies, upload intents, Storage metadata, audit records, RLS/ACLs and reporting functions/results. Record migration installation outside production if no migration ledger exists; do not invent a ledger.
4. Apply `20261112222936_management_audits.sql` exactly once, in its existing transaction, after PR61's `20261112184148_checklist_occurrence_deadlines.sql`. Stop on any error; inspect outcome before considering any retry.
5. Before releasing the frontend, verify the two new definitions, key/cadence constraints, canonical periods, timezone deadlines, optional comments, corrected Failed triggers, private helper privileges, QR context/known-ID/evidence rejection and final Storage guard. Compare all existing data/grant/reporting fingerprints with the before snapshot, reconciling legitimate concurrent operational writes rather than overwriting them.
6. If database/security verification passes, mark the PR ready and merge the frozen approved head with a normal merge message (no skip tag). Allow the existing GitHub Pages and Cloudflare integrations to deploy normally. Do not introduce a second deployment path.
7. Verify both deployments/production configuration, authenticated audit availability at all 20 eligible sites, existing checklist workflows and Daily/Weekly Compliance. Existing QR links must remain unchanged and expose only the original five templates. Use read-only production smoke checks; do not create fictional operational submissions in production.

## Recovery and rollback

- A migration error rolls back its transaction. Do not assume failure/success from a disconnected client; inspect installed objects before any retry. Do not blindly replay.
- If post-install verification fails, do not merge. Keep frontend unchanged, preserve data, report the exact failure and obtain authorization for a reviewed forward correction. Backend-first installation remains compatible with the released frontend.
- If the frontend release fails, revert only its approved merge commit through the normal deployment pipeline, after authorization. Retain the audit schema and the new server authorization restrictions.
- Never restore the old PR61 `actor_allowed`/dispatcher/Storage guard over installed audits: that removes the new server exclusion and could expose audits to QR holders.
- Do not drop audit templates, narrow key/cadence constraints, remove versions, delete evidence or reset QR tokens as rollback. A whole-database restore is a separately authorized last resort; prefer isolated restoration and selective reconciliation from verified database/evidence recovery copies.

Production preflight results are recorded separately as aggregate checks and fingerprints. This public document contains no production records, evidence or access credentials.
