# Super Admin and checklist editor

Local implementation on `codex/super-admin-checklist-editor`, based on `origin/main` at `af7f85d` (PR #70). No production writes, grants, migration installation, endpoint deployment, merge or app deployment were performed. Budget labels, compliance layout and DRB imports are outside this change.

## Capability and account verification

Super Admin is an additional private capability on existing Admin profiles. The Admin/Store role hierarchy, location assignments and unrelated functionality are unchanged. The migration creates an EMPTY capability table. Neither ordinary Admins nor Super Admins have a grant-management API or direct access to that table. A trusted database operator must provision verified accounts separately after explicit release authorization.

The user initially approved two accounts and subsequently added Steven. Three existing active Admin Auth/profile pairs were verified read-only through the existing authenticated production SQL Editor. The requester and additional account matched exact user-supplied login addresses and consistent profile emails. Kiser's profile lacked an email; a unique linked Auth record was retrieved privately and the user confirmed the masked login address. Account identifiers, addresses, UUID fingerprints and credentials are intentionally absent from repository artifacts and reports. Freshly verify the same identities before any grant; stop on ambiguity. Do not identify people solely by display name or create replacements.

The connector denied production SQL access; the documented SQL Editor fallback was used. Read-only inspection also confirmed seven templates (Opening v2, the other six v1) and enabled operational photo-integrity enforcement. No privileged account rows were modified.

## Server authorization

Private functions require a capability-listed, active, undeleted Admin. User-editable settings and Auth user metadata are not authorization sources. Exposed editor/capability/account-authorization functions are security invoker wrappers; privileged implementations have an empty search path and live in a private schema. Private tables have RLS and revoked client/service-role grants. Clients have no direct template INSERT/UPDATE/DELETE rights. The old `configure_checklist_pilot` immediate publisher is disabled for everyone; a Super Admin must use the audited workflow too.

A profile trigger denies ALL updates and deletes of protected profiles to actors without active Super Admin capability, including direct API calls and service calls without an authenticated end-user identity. This covers deactivation, deletion, role/email/name/ID/settings changes and similar takeover attempts. It leaves other accounts unchanged. Super Admins can continue maintaining protected profiles. Permanent deletion of a capability-listed account also requires trusted capability removal first; there is no application grant/revoke UI.

The existing `admin-users` endpoint validates the caller, including active/deleted state, and calls the authorization RPC using the CALLER'S JWT before password reset, email change or permanent deletion. Missing/unavailable authorization fails closed. It uses the caller's authenticated client to synchronize profile email, preserving identity for the new trigger. If Auth succeeds but profile synchronization fails, the endpoint reports that partial outcome explicitly. Password generation and credentials stay server-side. Other-account user management retains existing behavior.

## Editor workflow and version isolation

In Admin View, open Manager Checklists → Manage checklist configuration. QR management remains available to ordinary Admins. Only capability holders see the template editor. Manager View is read-only, and write requests also pass the existing view guard.

Select one of the seven existing templates, edit, **Save unpublished draft**, **Preview complete checklist**, enter a publication note, and **Publish new version**. Preview is a pure component: it shows every question, conditional trigger, signature requirement and photo count, and never creates submissions, queries evidence or uploads anything. The server requires a preview of the current saved draft revision. Edits invalidate preview. Expected published version plus shared-draft revision prevent overwrites between Super Admins. Publication, history insertion and current-template replacement are one transaction. Failures preserve the prior state.

The editor permits text, instructions, section headings, Critical flags, ordering, new preset questions and photo counts. Existing IDs are retained. New questions use generated UUID-based IDs and fixed completion/yes-no/pass-fail/text presets. Arbitrary database fields, response semantics, N/A permissions, conditional rules, signatures, deadlines, cadence, QR eligibility and template creation/deletion are unavailable and rejected by the server. Sections must remain contiguous and follow-ups must remain after their parent. Existing audit evidence and explanation rules are protected. The Weekly section photo retains its attachment ID and section placement after a heading rename.

Wording-only edits retain intentional source numbering, including Weekly PM. Structural reorder/addition edits regenerate display numbers within sections. Existing snapshots retain their original numbers and definitions. Initial published definitions are archived exactly at installation; earlier history is not fabricated. Later published versions and all saved draft revisions are append-only through the API. Restoring a published version creates a shared unpublished draft; preview and publication create a NEW higher version, leaving prior versions and submitted/in-progress snapshots unchanged. Restore lineage is recorded. Saved restored drafts can be edited before publication without reintroducing questions added in a later version.

## Photo counts and existing limits

New questions can be added to any existing section. Move controls reorder questions within a section or move a complete section while preserving its grouping. The server rejects invalid conditional ordering. Question numbers are generated for structural edits and cannot be set arbitrarily through the API.

New `photo_min_count` values are integers 0–10 per question when that question applies. Existing conditional failure-photo rules still require at least one photo on failure; they cannot be disabled by setting an unconditional minimum to zero. Historical snapshots without the new field use their unchanged `photo_required` boolean semantics.

The new validator layers a count check over the existing signature/evidence/photo-integrity validator. It counts DISTINCT registered attachment IDs for the exact item/submission, among the effective evidence IDs for the saved draft/correction, joined to existing private Storage objects. Wrong-item photos, missing objects and duplicate references do not satisfy the count. Operational verification, hashes and camera-only capture remain intact. Both Management Audits retain library upload support. Existing corrections still require fresh signatures.

Existing limits remain 200 upload intents per checklist and 30 upload intents per minute per actor. Template validation allows at most 180 potential required evidence uploads including signatures/final signature, reserving 20 intents for retries/corrections. It conservatively counts conditional requirements. Each question can require ten photos when the overall template budget fits. This does not promise unlimited retries or multiple correction cycles; all existing intent/rate limits still apply. No upload/storage permission expansion is included.

## Prepared release sequence — not authorized to execute

1. Run `docs/sql/super-admin-preflight-READ-ONLY.sql` on the intended production project and compare installed grants, function fingerprints, constraints and snapshot fingerprints with reviewed expectations. Confirm backups and current `admin-users` source. Stop on unexplained drift. The repository is not a complete production schema rebuild.
2. After separate authorization, install `20261118145030_super_admin_checklist_editor.sql` once. Its transaction creates the private capability/history/draft objects, guards profiles, disables immediate publishing and layers photo-count enforcement. It intentionally grants nobody. Verify default denial and unchanged existing snapshots/assignments/operational access; run security advisors.
3. Deploy the updated existing `admin-users` endpoint BEFORE granting capabilities. Preserve its gateway configuration and `auth.getUser()` check. Test protected/nonprotected authorization with authorized, controlled release checks. Do not test resets or email changes on real people.
4. Deploy the client through the existing GitHub pipeline after separate merge/deployment authorization; do not deploy manually to Cloudflare. Do not publish count-based templates before compatible backend and client are installed.
5. Pause/drain account-management operations before the initial grants. Freshly reverify all three approved Auth/profile pairs privately. Supply an ephemeral hashed verification manifest to `docs/sql/super-admin-grants-PARAMETERIZED-REVIEW-ONLY.sql` using the trusted workflow; it rejects missing, duplicated, ambiguous or changed accounts and existing capability grants. It assigns only capability rows, with no role/profile/assignment changes. No real manifest is included in this repository.
6. Verify all three approved accounts can edit and another Admin cannot use any editor, private-table or legacy publishing path. Verify Store/QR restrictions and ordinary Admin operational access. Publish an actual checklist change only when authorized and reviewed by the business owner. Compare snapshot fingerprints to confirm existing work was not rewritten.

Safe disable is prepared in `docs/sql/super-admin-editor-disable-REVIEW-ONLY.sql`; it revokes editor calls without deleting history or weakening account protection. Do not revert to an account endpoint that lacks the protection check. A full database backout requires a separately reviewed plan.

## Local validation

* App checks: `cd app && node --test tests/superAdminTemplates.test.js tests/checklistsUi.test.js tests/managementAudits.test.js tests/twoRoleEndpoints.test.js` plus existing checklist, camera, correction, mobile-feedback and Manager View tests.
* Database/security regression: set `PGLITE_MODULE` to an installed PGlite 0.3.14 module and run `node --test scripts/tests/super-admin-template-sql.test.mjs scripts/tests/checklist-photo-integrity-sql.test.mjs scripts/tests/checklist-photo-staging-sql.test.mjs scripts/tests/checklist-compliance-sql.test.mjs`. Disposable fictional fixture only; no hosted requests or production data.
* Browser: start Vite on 127.0.0.1:5188; set `PLAYWRIGHT_MODULE` to the bundled Playwright module and run `node scripts/tests/super-admin-editor-browser.mjs`. It uses a separate headless Chrome profile, fictional RPC data and blocks non-local requests. Covers draft/preview/publish/restore, conflicts, question addition/reorder, Critical/photos, and mobile/dark layouts. It does not substitute for the real PostgreSQL authorization tests.
* Production build and `git diff --check`.

The full application suite has pre-existing failures. Compare failing names against unchanged `origin/main`; do not claim the full suite passes. Hosted advisors, migration installation, account grants, deployed-endpoint verification, real-device capture and live acceptance remain release checks, not completed local validation.

Validation results: 158 focused application tests, 30 isolated SQL/security regression tests (including eight new capability/editor/provisioning tests), browser workflow/layout checks, build and diff checks passed. The full suite retained the same 47 failing test names as unchanged `origin/main`; there were no new failures. Existing build warnings about Admin's duplicate title attribute and large chunks remain.
