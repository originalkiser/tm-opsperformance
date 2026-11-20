# N/A configuration and operational photo library release

## Scope and guarantees

Super Admins can toggle Allow N/A for existing or new choice questions (completion, Yes/No, Passed/Failed), then use the existing unpublished draft, full preview, optimistic conflict detection, publish, revision history and restore workflow. Free-text response types remain unchanged. No current template is automatically edited or published by installation.

Every N/A response already requires a reason server-side and client-side, including non-Critical questions; this stricter existing rule is retained. Published permissions are enforced from each submission's immutable snapshot. Unconditional photo minimums, item signatures and final signatures still apply to N/A. Failure-only photos and conditional follow-ups retain their stated triggers: N/A does not activate a failure trigger. The editor/preview explicitly explain that evidence needed for every response must have an unconditional required-photo count. No mandatory evidence rule or response/conditional type is weakened.

All five operational checklists offer a separate library file picker alongside the existing live camera. Both call the same existing form upload and authenticated/QR transport, without re-encoding library bytes or adding a direct Storage path. JPEG/PNG/WebP and 10 MB limits remain. Both Management Audit library controls are unchanged. Server SHA-256 verification, same-location duplicate rejection, upload intent binding, final Storage/attachment protections, private evidence, snapshots, drafts/corrections, QR audit restrictions and history are unchanged.

## Prepared backend artifact

`app/supabase/migrations/20261120205632_checklist_na_configuration.sql` replaces only `configuration_private.validate_template(text,jsonb,boolean,integer)`. It makes boolean `na_allowed` an editable choice-question field, including newly generated questions; all other protected fields remain protected. There is no table/schema/data/grant change. Existing function ACL, definer mode and empty search path are retained by CREATE OR REPLACE.

The migration stops if the installed function body differs from the reviewed baseline. Old function MD5: `c3ca5d022a8da862dfc990b9e8d74845`; installed new body must be `431555f23b1069890b8c92cbb48ed9fb`. Migration SHA-256: `2e175f0f06d57f18d7e82c6bb78043ce4e46b6b7557711c36173b0d429ca5aa8`. Run once, backend first. A second application stops on the drift guard.

## Focused validation

- 24 focused Node tests: N/A reasons/permissions/photos/signatures, actual editor save/preview/publish payloads, camera lifecycle, protected-account behavior and existing server endpoint hashing/authorization.
- Five actual in-memory PostgreSQL tests: private ACL preservation, Super Admin-only configuration, denied direct/legacy paths, N/A save/preview/publish/restore, protected fields/types/IDs, boolean validation, old snapshots/drafts, actual server-side N/A reasons and two-photo minimum, Weekly PM per-item/final signatures, QR restrictions and migration drift guard.
- Ten existing PostgreSQL photo-integrity tests pass: same-location reuse across dates/checklist types, verified fingerprints, idempotency, actor binding, direct API/table/Storage bypass rejection, legacy/history preservation and required evidence.
- Three targeted existing form tests pass for all operational camera+library controls, audit library controls and Opening photo/instruction preservation.
- Isolated headless Chromium with simulated live camera and iPhone/Android user agents/viewports: camera and native library upload, exact preservation of library bytes, duplicate error handling for both sources, N/A reason UI, audit library preservation, unavailable/denied-camera fallback and draft saving. This is not physical iPhone/Android verification.
- Actual headless Super Admin editor checks N/A toggle/order/save/preview/publish/restore, protected structure, stale conflicts, photo counts, mobile/dark layout, with fictional RPC state and hosted traffic blocked.

## Production access and release sequence

Background production SQL and Security Advisor were attempted through the established connector; both returned permission denial. This is an integration-access limitation, not evidence of a database defect. No CLI authentication, new infrastructure, production schema/record/permission change or desktop interaction was performed.

1. With separately approved limited Dashboard access, confirm the production recovery point, run `docs/sql/checklist-na-library-preflight-read-only.sql`, and rerun Security Advisor. Verify seven published templates, the exact baseline function, unchanged private ACL/authorization, active photo enforcement/endpoint attestation, and no unexpected drift.
2. Apply the approved migration exactly once. Re-run the metadata/provenance preflight: expected new body hash, unchanged ACL/other function fingerprint and template fingerprint, zero submission/attachment/template rows written by that migration transaction, photo enforcement still active. Do not test by publishing templates or uploading real evidence.
3. Merge the validated PR with a normal merge commit, verify GitHub Pages and Cloudflare deployments and live app/assets. No endpoint deployment or account grant is needed. N/A remains unchanged on all existing templates until an authorized Super Admin explicitly publishes a version later.

Recovery: the old frontend works with the additive validator change, so prefer a normal frontend revert through both pipelines. Preserve any later N/A drafts/versions/submissions; never rewrite templates or delete evidence to roll back. Reverting the private validator to its exact earlier source is only appropriate after separately reviewing any N/A configurations created since release, since the old validator would reject such edits. Production backup restore is not a routine rollback step for this change.
