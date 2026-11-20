# Checklist question removal release

## Change

A confirmed Remove Question action edits only the local unpublished definition. Explicit Save Draft, full Preview and publication remain required. Existing optimistic revision/version locks, append-only published versions/revisions, restore and immutable submission/correction snapshots are reused. No delete operation or new endpoint is added.

The private validator permits omitted ordinary question IDs while preserving remaining identities and protected semantics. Required-signature questions, conditional follow-ups and their parents (including simultaneous whole-chain removal), and Weekly Administrative `weekly-9` (the form's section-photo dependency) cannot be removed. Empty checklists remain invalid. Protection is checked on save, preview, publish and restore, not only in the editor. Final checklist signatures, photo validation/integrity, deadlines, compliance and authorization code are unchanged. Removed questions remain in historical versions and submission snapshots; evidence is never deleted.

## Validation

- 11 focused Node checks: removal confirmation/cancellation, unsaved wording preservation, draft/preview/publish payloads, protected explanations, last-question guard, existing N/A/evidence behavior and Super Admin account safeguards.
- Four real in-memory PostgreSQL checks: ordinary/Store/anonymous/direct/legacy bypass denial and ACL preservation; removal/history/restore/stale-version handling; authenticated and QR new snapshots; original submission/evidence preservation; protected chains/signatures/system dependency; empty/forged definitions; renumbering and N/A/photo flags; repeat-install drift guard.
- Actual editor in isolated headless desktop Light and 360px mobile Dark: cancel/confirm, protected controls, save/preview/publish, previous version preservation, restore, stale-edit recovery and no horizontal overflow. Fictional fixtures only, no production client.
- Both GitHub Pages and Cloudflare build bases passed with inherited warnings. No dependencies added.

## Backend installation before frontend

Artifact: `app/supabase/migrations/20261120213643_checklist_question_removal.sql`.
SHA-256: `f2793dacb2ad8d7d6f4ca5936a8429b41c7d284fe9d202b705c97eac142aa824`.
Expected installed prior validator MD5: `431555f23b1069890b8c92cbb48ed9fb`.
Expected new validator MD5: `73c50c856116bba8bca568fa964af9f3`.

1. Confirm latest existing production recovery point. Run `docs/sql/checklist-question-removal-preflight-read-only.sql`; verify current source/ACL, all seven published templates, existing records, photo enforcement and configuration dependencies. Record metadata fingerprints only. Rerun Security Advisor against its inherited baseline.
2. Apply the reviewed migration once using established authorized access. One guarded transaction replaces only `configuration_private.validate_template(text,jsonb,boolean,integer)`. Three-second lock timeout; unexpected source hash stops the transaction. No DML, grants, RLS, account, template-content or Storage changes. CREATE OR REPLACE retains the existing private ACL.
3. Verify new function hash, unchanged other function/permission and template fingerprints, zero migration-written rows and unchanged photo enforcement. Verify all current Super Admins can read; ordinary active accounts cannot save/preview/publish/restore, anonymous/private direct paths are denied, and legacy immediate publishing remains disabled. Use read-only contexts or rollback-only checks; do not save/publish a real template or upload evidence. Pure validator checks can remove an ordinary question without persisting it and reject protected removals. Refresh Security Advisor.
4. Merge the frozen tested head with a normal merge commit. Let existing independent GitHub Pages and Cloudflare pipelines deploy; do not deploy Cloudflare manually. Verify both commit-bound checks and public host bundles/load without production writes.

## Recovery / rollback

If installation fails, stop and roll back its transaction; do not merge the frontend. If already installed, the existing frontend remains compatible. If frontend fails, revert its merge commit through the normal GitHub process; leave the additive validator change installed while investigating. Do not restore the entire production database or delete historical versions/evidence for a UI rollback.

If reverting validator behavior is genuinely needed, first freeze template publishing and inspect any saved removal drafts/new versions. Restore only the prior CREATE OR REPLACE function body from `20261120205632_checklist_na_configuration.sql`, with a reviewed guard against the new MD5 above and preserved ACL; do not rerun that old migration's original source guard. Earlier behavior rejects saving drafts that omit published questions, so preserve those drafts and explicitly review/restore through versioning rather than rewriting history. A checklist-content reversal is a separate authorized restore-to-draft/preview/new-version publication, never a historical update.

## Current release status

Local implementation and focused checks passed. Production connector SQL and Security Advisor are denied by the known connector permission limitation. No production operation has been attempted; backend verification/installation and frontend release remain pending established authenticated access. No desktop control is authorized for this task. This status must be superseded with actual production evidence before merge.
