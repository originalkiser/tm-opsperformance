# Discard Draft — development review

Branch: `codex/checklist-discard-draft`, based on deployed main `61baad42183d688f0e504119b07fdf0ea6dd2ecb`. The backend was installed and integration-tested under separate authorization. This follow-up is development/testing only: no production changes, grants, merge or deployment.

## Actual save behavior

`ChecklistForm` writes changed answers/name to sessionStorage for explicit tab-local recovery. It does not autosave answers to the database. Server saves occur on Save Draft, Submit and immediately before uploading a photo/signature. Drawings are saved only with Save signature. Save Draft remains; the UI now states that answers are not autosaved to TM Ops. Existing saved notices and busy/disabled behavior remain.

## Minimal discard flow

An unfinished checklist has a separate phone-sized Discard Draft button above the existing sticky actions. Confirmation explicitly covers permanent removal of saved answers, photos and signature. Active Admins can discard reviewed drafts using their established companywide checklist authority; managers can discard only their own draft while existing pilot/location/date authorization remains valid. Submitted checklists have no discard action and are rejected server-side.

One Edge Function verifies the caller through auth.getUser, then calls begin_discard_checklist with the caller JWT. This locks the current draft, checks permissions/revision, and sets its existing status field to `discarding`. No new table or status column is added. Save/finalize/upload attachment RPCs already require draft status, so frozen drafts cannot be changed. Unique occurrence protection stays in place during cleanup. A narrowly bucket-scoped storage.objects INSERT trigger also locks/checks the draft on the final metadata write, including privileged Storage completion after an earlier permission probe. Other buckets are unchanged.

The endpoint uses its server-only project key and Storage API to list/remove only the frozen UUID prefix in manager-checklist-evidence. This includes photos/signatures whose upload completed but attachment registration failed. It deletes the first page repeatedly with bounded work, stopping on errors, unexpected paths or no progress. It never deletes Storage metadata using SQL. The final caller-JWT RPC rechecks current authorization and zero remaining Storage metadata, then atomically deletes attachment records and the draft and appends minimal deletion metadata to edit_audit_log (no answers or evidence copied into audit).

Storage and SQL are not one distributed transaction. On partial/ambiguous failure, the row stays frozen and retains its occurrence key until explicit Discard Draft resumption completes cleanup. Already removed files cannot be restored by rolling back SQL. No background job or automatic failure retry is introduced. A caller losing pilot access cannot resume; an active Admin can finish cleanup. The UI blocks edits/uploads after initiating discard until success or authoritative refresh. On confirmed success it clears tab recovery and closes. Another tab's stale save uses the deleted UUID and fails, never inserting a replacement. A deliberately new Start checklist remains available after successful discard.

Supabase Storage rejects late upload completion at the database guard and performs its own rejected-upload byte cleanup. Application cleanup removes all committed API-visible objects; physical deletion of an upload still streaming depends on managed Storage cleanup, not a SQL guarantee. This must be verified with the deployed Storage API in the separately authorized release test. See [Storage deletion guidance](https://supabase.com/docs/guides/storage/management/delete-objects) and [official upload implementation](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts). Database backups do not restore uploaded evidence.

## Changes / deployment gates

- ChecklistForm.jsx, ManagerChecklists.jsx: button, confirmation, frozen-draft handling, existing-save explanation.
- Migration 20261105212313_checklist_discard_draft.sql: allow `discarding`, two authorization RPCs, final-upload guard. No existing templates or operational data rewritten; no existing RLS policies or grants broadened.
- functions/discard-checklist-draft/index.ts and handler.js: authenticated orchestration; existing injected keys only. config.toml explicitly matches the established asymmetric-JWT workflow; auth.getUser is mandatory.
- UI, endpoint and isolated SQL tests.

Before any production approval: review SQL/function checksum, verify existing constraint, postgres TRIGGER privilege on storage.objects and Storage trigger installation compatibility, and confirm recovery point plus separately preserved evidence as appropriate. Test real Storage uploads interrupted before/after freezing in an isolated Supabase environment; PGlite fixtures and mocked API calls cannot certify physical object cleanup or live HTTP ordering.

Recommended separately authorized sequence: production read-only preflight → migration → deploy Edge Function → verify auth/cleanup with approved disposable data → application release via GitHub → both hosts/smoke test. Never enable this UI before the RPCs/function are installed. No paid services/new secrets required.

Recovery: revert application release if necessary; retain the additive migration and cleanup function until frozen drafts have been resolved. Do not reset `discarding` rows to draft, drop the upload guard, delete buckets, or delete Storage metadata directly. Preserve submitted checklists, other records and audit history. Routine rollback cannot resurrect permanently discarded drafts/evidence.

## Final local verification

- Application tests: 429 passed (UI, endpoint orchestration, existing feature regressions).
- Isolated PostgreSQL/authorization tests: 38 passed (all checklist, November and monthly-budget SQL suites).
- Production build: passed; existing Admin duplicate-title and bundle-size warnings remain.
- Diff whitespace check and feature-file secret/private-artifact scan: passed.
- Edge orchestration is tested locally with injected Auth/RPC/Storage clients; no real Storage uploads/deletions, Deno deployment or hosted migration was performed. SQL tests cover transaction rollback and ordered race interleavings, not a live multi-client Storage transfer.

Migration SHA-256: `bbaa9aa86b77a0effdf3089aee5b872291a89d890529987faac1d5b9c5d6be31`.

## Exact feature files (12)

- `app/src/components/ChecklistForm.jsx`
- `app/src/pages/ManagerChecklists.jsx`
- `app/src/utils/checklistEvidence.js`
- `app/supabase/config.toml`
- `app/supabase/migrations/20261105212313_checklist_discard_draft.sql`
- `app/supabase/functions/discard-checklist-draft/index.ts`
- `app/supabase/functions/discard-checklist-draft/handler.js`
- `app/tests/checklistDiscard.test.js`
- `app/tests/checklistsUi.test.js`
- `app/tests/checklists.test.js`
- `scripts/tests/checklist-sql.test.mjs`
- `docs/checklist-discard-draft.md`

## Focused stale-upload error correction

Root cause: the upload guard deliberately raises PostgreSQL P0001, which the live Storage service wraps as HTTP 500 / DatabaseError. Official [Storage database error mapping](https://github.com/supabase/storage/blob/master/src/storage/database/errors.ts) maps SQLSTATE 42501 to AccessDenied / 403; P0001 uses the generic database-error path. A deliberate permission SQLSTATE could improve the server HTTP response without weakening rejection, but would require a new backend migration. This correction keeps the installed migration, guard, RPCs, policies and Edge Function bytes unchanged.

Smallest correction: checklistUploadRejection in the existing evidence utility recognizes the observed Storage rejection, stale-save/no-row errors, and the existing immutable-draft rejection. Only then does it perform one fresh caller-authorized RLS SELECT of that draft's status, with Cache-Control: no-cache, no-store. Missing/inaccessible drafts show “This draft is no longer available. Uploads are no longer allowed.” The neutral wording avoids claiming deletion when RLS could instead reflect revoked access. A discarding row shows explicit cleanup-resumption guidance; submitted rows are read-only. There is no new endpoint, request retry, Storage removal path or happy-path network request.

The form stops further stale callbacks once unavailability is confirmed, never registers an attachment after a rejected upload, and preserves the explicit Discard Draft action for interrupted cleanup. A live draft, failed status read or unrelated server error retains the original error instead of being silently relabeled. Photo/signature uploads share this handling, including save-before-upload and register-after-upload races.

Correction files: ChecklistForm.jsx, checklistEvidence.js, checklistsUi.test.js, checklists.test.js, checklist-sql.test.mjs and this note. The two existing utility/test files expand the cumulative feature manifest from ten to twelve; no new infrastructure or backend component is introduced.

Verification: 40 focused UI/endpoint/SDK tests, 429 full application tests and 38 isolated SQL/authorization tests passed; production build and diff checks passed. Tests reproduce the actual locked SDK error shape with fictional fetch responses and confirm no retry, no attachment registration, no accepted Storage metadata after guard rejection, and explicit pending-cleanup resumption. No live production retest was performed in this correction.

Remaining limits: direct API clients and Storage logs still see the server's HTTP 500 mapping. If the known error format changes or the fresh RLS read fails, users receive the original error and refresh guidance; server protections still reject the upload. The prior independent physical-blob verification limitation is unchanged. Source migration checksum and both deployed Edge source checksums remain unchanged.
