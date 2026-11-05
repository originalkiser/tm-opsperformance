# Manager Checklists pilot — development review

Branch: `codex/manager-checklists-pilot`, based on deployed main `455772afbbf7b4fc79a7043c645e43bc99c60c7f`.
No production writes, migrations, bucket creation, test uploads, assignments, reminders, merge or deployment performed. Production compatibility was inspected read-only during readiness review.

## Workflow and approved templates

Manager Checklists appears in navigation for active Admins and enabled pilot participants only. Managers remain limited to their existing Store or legacy area-manager site assignments. Admin can enable one assigned user at a location, or all assigned users at a pilot location. No role changes. The migration enrolls nobody.

Four editable templates: Opening (31), Mid-Day (5), Closing (19), Monday administrative (16 tasks). The 55 daily questions retain the PDF wording/sections, approved completion normalization, original choices and 49 critical designations. Mid-Day waste bins are single-selection. Six photo-bearing items are mandatory: one Opening, three Closing, and the Communications/Membership Calendar boards in the Monday checklist. At least one image per requirement; users may upload additional images to cover multiple gauges/baskets. Weekly board evidence is attached to the newsletter and membership-board items, without inventing extra checklist questions.

Not Completed, Failed, No and Overflowing require a brief explanation. N/A is available only for Closing applicable cash handling, weekly outstanding onboarding/performance reviews, unavailable monthly webinar recap, and damage claims; a reason is required. Weekly dashboard reviews need completion confirmation, not narratives. Critical failures remain visible and require explanation; they do not silently block final submission or introduce a score.

All four checklists require typed manager full name and a directly drawn signature. Submission records contain authenticated account UUID, location, site-local business date/week, template/time-zone snapshot, saved answers/evidence and UTC completion timestamp; the UI displays site-local timestamps. All records have `is_pilot=true`, enforced by constraint. MonitorQA remains official, including its existing Power BI reporting.

A daily occurrence is unique per site/template/date; a weekly occurrence uses the Monday date. Monday is due at the end of that site's local calendar day; the following local day an unsubmitted weekly occurrence is shown as missing. No scheduler, auto-assignment or notification is installed. Missing/incomplete review is derived for enabled pilot grants and selected dates at/after enrollment. Weekly expectations begin on the first Monday on/after enrollment. Re-enabling a revoked grant restarts its enrollment date to avoid retroactive expectations. Disable all overlapping grants to revoke site-wide access.

## Drafts, evidence and reliability

Start creates one draft. Save Draft persists incomplete responses without requiring signature/evidence. Drafts are owned by the authenticated creator; other pilot users cannot read/edit them. Admin can review all drafts/submissions but cannot edit another user's draft. A duplicate occurrence asks Admin to review rather than creating another record. This is a deliberate pilot boundary, not a reassignment/correction workflow.

Unsaved answers have a per-user/per-draft recovery copy in browser-tab session storage; restoring is explicit and never overwrites the server automatically. Navigation/unload warnings protect unsaved changes; browser Back/Forward within the SPA can be canceled. Saved drafts reopen from the server. Photos/drawings must be saved explicitly before leaving. This is **not offline support**: uploads and saves require a connection, and tab-local recovery is not a server backup.

Photo capture and existing-file selection are separate tablet controls. JPEG, PNG and WebP are allowed, up to 10 MB each. Unsupported formats (including HEIC) must be converted or recaptured in a supported format. The signature pad uses pointer capture, scales input coordinates to its canvas and rejects a blank/tap-only drawing. It provides Clear and Save signature; there is no signature-file picker.

One private bucket, `manager-checklist-evidence`. Paths are submission UUID/file UUID, not public URLs. Every photo/signature view uses an authenticated SDK download with a fresh cache nonce and `cache: no-store`. New uploads use `cacheControl: 0`. Storage RLS checks current active-account, pilot, site and Admin/owner authorization. A post-transfer attachment SELECT requests `Cache-Control: no-cache, no-store` and rechecks the current session before any image is displayed, catching revocation during transfer as well. No public or signed evidence URLs are created. The image is displayed only via a local in-memory Blob URL, revoked when closed, replaced or unmounted; an unfinished download is aborted on unmount. Previously delivered copies cannot be remotely erased; these controls govern fresh server access. The locked SDK already supports these operations, so no dependency or global-client changes are needed. [SDK download reference](https://supabase.com/docs/reference/javascript/storage-from-download). Client uploads require an owned, authorized draft. SQL finalization locks the draft; upload authorization takes a shared row lock, so upload and submission serialize. Client object replacement/deletion is denied, even if pre-existing permissive Storage policies are broad. Unrelated buckets retain their existing policy behavior.

Uploads precede attachment registration; these are separate Storage/SQL operations. Final answers/status and the submission audit write commit atomically. Failed finalization leaves a resumable draft and saved evidence. An interrupted upload/registration can leave an unlinked private object; no background cleanup service is added. Any cleanup requires a separately reviewed operation, never deleting linked evidence. Ambiguous network failures are not retried automatically: refresh to determine server state first.

Submitted records and linked evidence are immutable to application clients, including Admin. No in-place correction UI is added; any correction requires a separately authorized process that retains the original. Template edits affect only new drafts; existing drafts and submissions retain snapshots. Admin can edit wording, photo instructions, always/conditional-photo requirements, and additional written-evidence requirements. Approved section order, choices, critical and N/A designations remain fixed.

## Proposed database change

Migration: `app/supabase/migrations/20261105173034_manager_checklists_pilot.sql`.

- Four tables: `checklist_templates`, `checklist_pilot_access`, `checklist_submissions`, `checklist_attachments`.
- A non-exposed `checklist_private` helper schema; all privileged functions have an empty search path and qualified references. PUBLIC/anon execution denied; only required predicates/RPCs granted to authenticated.
- RPCs: `save_checklist` (create/save/finalize), `attach_checklist_evidence` (register a completed upload), `configure_checklist_pilot` (active Admin only).
- Optimistic revisions prevent lost draft/template/grant edits. Unique scope/occurrence/object keys prevent duplicates. No direct client table writes.
- Existing `edit_audit_log` receives submission metadata (no answer/evidence contents) and pilot-access changes. Existing audits/policies remain unchanged. Template version/editor metadata plus immutable draft snapshots preserve attribution without a history screen.
- No changes to existing budget/actual tables, scoring, reporting, account roles, or authorization helpers. The new historical actor references introduce a permanent-account-deletion retention boundary, called out as a release decision below. New Storage policies restrict only the new bucket.

## Verification and remaining release gates

Automated tests use fictional in-memory PostgreSQL fixtures only. They cover templates, response rules, all six photos, N/A/explanations, signature, active Admin/pilot/Store/legacy-manager boundaries, inactive/deleted/anon denial, duplicate/conflicting drafts, immutable submissions/evidence, broad pre-existing Storage policies, conditional Admin evidence, template snapshots, atomic audit rollback and non-destructive application rollback, per-view revocation and real locked-SDK authenticated/cache transport with fictional fetch responses. UI tests cover recovery, duplicate clicks, stale errors, camera/file controls, signature strokes, read-only review and navigation visibility. Time-zone tests cover Monday end-of-day, DST, leap day and year boundaries.

Commands from repository root:

```sh
npm --prefix app test
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --test scripts/tests/checklist-sql.test.mjs
npm --prefix app run build
git diff --check
```

The SQL harness uses `@electric-sql/pglite@0.5.15`, installed outside this public repository. No application dependencies were added. Existing November/monthly-budget SQL tests can run with the same module.

Before production approval:

1. Obtain the small read-only metadata export in `docs/sql/checklists-pilot-PREFLIGHT-READ-ONLY.sql` through the authorized SQL Editor. Require `execution_role=postgres`, all absence flags true, and Storage RLS enabled. Verify referenced columns/types/constraints, authenticated Storage SELECT/INSERT privileges and no naming collisions; stop on any mismatch. Confirm normal authenticated Data API access to the new tables/RPCs after migration without broadening unrelated permissions. Production schema/Storage compatibility is **not claimed verified** by fixtures. Validate time zones for selected pilot sites; do not change unrelated locations.
2. Confirm database recovery point and existing-plan Storage capacity. Preserve object files separately from database recovery; a database backup alone is not photo/signature recovery.
3. After the separately authorized, safely deployed selected pilot, test camera permissions, native photo selection, signature input/orientation, interrupted uploads, access revocation and navigation recovery on the actual pilot tablets. This is a post-deployment pilot acceptance step, not a requirement to add infrastructure. Desktop pointer tests do not certify real camera/stylus behavior. A desktop visual check used a fictional, network-isolated local UI fixture: large controls, conditional explanations, Save Draft and canceling actual browser Back were verified; no production client was imported or contacted.
4. Retaining deactivated employee accounts during the pilot is approved. Historical creator/attachment/editor foreign keys preserve identity; do not hard-delete these accounts while evidence is retained. Deactivated and soft-deleted accounts fail the current database authorization checks even if they still hold a valid session token. No account-deletion workflow change is included. User-specific access grants alone cascade when an otherwise unreferenced profile is deleted.
5. Select pilot managers/sites. No production grants or submissions have been created.

## Deployment and rollback — separate approval required

Review exact migration/checksum and preflight results first. Apply the approved additive migration once via the authorized production workflow, stop on errors, then run `checklists-pilot-VERIFY-READ-ONLY.sql`. Expect four version-1 templates with question counts 31/5/19/16, critical counts 31/0/18/0 and photo counts 1/0/3/2; zero grants/submissions/attachments/evidence. Confirm bucket private, RLS enabled, anon denied, authenticated direct table writes denied and RPC privileges correct. Recheck existing operational data/security metadata against the before-image.

Deploy the reviewed application through the established GitHub workflow only after schema verification. Confirm both hosts' merge commit. First check Admin UI and nonpilot denial without starting real records. Separately authorize selected pilot grants and synthetic/approved pilot submissions. Keep MonitorQA official.

Application rollback: revert the feature release through GitHub; retain schema, drafts, submissions, audits and evidence. Optionally disable pilot grants through the authorized UI before reverting. The existing artifact `docs/sql/checklists-pilot-ROLLBACK-REVIEW-ONLY.sql` now contains concise application-first recovery instructions as SQL comments only. It contains no executable SQL, schema teardown, bucket deletion or protection bypass. Routine rollback preserves all database objects, records, audits and evidence; database backups do not include uploaded photo/signature contents. Production execution is not authorized by this document.

## Final development verification

- Application suite: **411 passed** (22 checklist tests).
- Isolated SQL/authorization suite: **34 passed** (13 checklist scenarios; prior November/monthly-budget suites included).
- Production build: passed; existing Admin duplicate-title and bundle-size warnings remain.
- Tracked diff and complete feature-file whitespace/credential scan: passed. Nothing staged or committed.
- Local desktop fixture: controls, conditional explanation, unfinished draft save, and canceling actual browser Back verified. Fixture imported no production client; CSP blocked external connections. Fixture tab closed and server stopped.
- Real tablet camera/stylus and live Supabase Storage/API integration remain unverified; these are not represented by the fixture tests.

Migration SHA-256: `6574f0d2f607173a275973bad792fc4aaa2188b6ad6be53fdc7261cdfe2636d9`.

## Files changed (19)

- `app/src/App.jsx`
- `app/src/components/NavBar.jsx`
- `app/src/components/ChecklistAdmin.jsx`
- `app/src/components/ChecklistForm.jsx`
- `app/src/components/ChecklistSignature.jsx`
- `app/src/hooks/useChecklistAccess.js`
- `app/src/pages/ManagerChecklists.jsx`
- `app/src/utils/checklistRules.js`
- `app/src/utils/checklistEvidence.js`
- `app/src/utils/checklistTemplates.js`
- `app/supabase/migrations/20261105173034_manager_checklists_pilot.sql`
- `app/tests/checklists.test.js`
- `app/tests/checklistsUi.test.js`
- `app/tests/locationHelpUi.test.js`
- `scripts/tests/checklist-sql.test.mjs`
- `docs/manager-checklists-pilot.md`
- `docs/sql/checklists-pilot-PREFLIGHT-READ-ONLY.sql`
- `docs/sql/checklists-pilot-VERIFY-READ-ONLY.sql`
- `docs/sql/checklists-pilot-ROLLBACK-REVIEW-ONLY.sql`

The source PDFs, November workbook, private exports, local fixtures and temporary tooling are excluded. No production SQL, account changes, merge, deployment or paid resources were performed.

## Final blocker correction scope

Only seven feature files changed in this correction: ChecklistForm.jsx, new checklistEvidence.js, checklists.test.js, checklistsUi.test.js, checklist-sql.test.mjs, this review note and the existing recovery artifact. All four templates, questions, critical flags, six photo requirements, signatures, drafts, Admin template editing, private bucket and database authorization design are unchanged. The forward migration bytes/checksum are unchanged. No privileged browser credentials, dependency additions, new service or broader permissions were introduced.

Fresh evidence requests are authorized by Storage RLS, not client-side role claims. The post-transfer RLS recheck also rejects a revocation that occurred while downloading. Tests cover prior-success-then-revocation, inactive/deleted accounts, unauthorized sites/nonpilot users, active/inactive/deleted Admins, session changes, canceled requests, memory cleanup and non-destructive recovery. In-memory images are not persisted to session storage or exposed as reusable remote links.

Recommendation after these corrections: **GO for final review and separately authorized migration/application release**. Reconfirm the project/recovery point at execution time, apply the additive migration only after approval, run the prepared read-only verification, then release through GitHub and verify both hosts. Enable only selected pilot grants and perform actual tablet acceptance afterward. MonitorQA remains official. No production migration, upload, access change, merge or deployment has been executed in this correction.
