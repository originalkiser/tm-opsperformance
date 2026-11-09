# Companywide Manager Checklists — development review

Branch: `codex/checklists-companywide-access`, isolated worktree based on production main `1f061d459076bd23822db8143f86e3d0922d35e4` (PR #52).

## Production inspection before preparing migration SQL

On November 9, 2026, the connected Supabase MCP denied access to production `qbdvixxooofdlfurcpqy` and listed only inactive `tm-ops-dev`. Inspection instead used the existing authenticated Supabase SQL Editor, confirmed project `tm-opsperformance`, branch `main PRODUCTION`, execution role `postgres`. All executed SQL was enclosed in `BEGIN READ ONLY` / `COMMIT` and selected system metadata only. No customer answers, images, signatures, or credentials were exported.

Read `pg_get_functiondef` for the 11 checklist functions and compared whitespace-normalized `prosrc` MD5 fingerprints against the repository migrations; all matched:

| Function | Body fingerprint |
| --- | --- |
| active_admin | bd3b9589363cf6bc33916ba3fe95c106 |
| assigned | 1285e14881a3d47d00267393bb02ff94 |
| can_access | d18311c88b5b4586eb487fa1ee3b3399 |
| can_read_submission | fdfcb3dfd464742a73812d7fff1a407c |
| can_upload | 2fbab7cdad5fda4487242cde131a9088 |
| save_checklist | 3b994e4dfbf8b91b8ccfd2e786c49cb4 |
| attach_checklist_evidence | 0db79758d7a90a47b013ccff8256ca2d |
| configure_checklist_pilot | f5b1fee6c5441ae65b23239eb7c19f0a |
| begin_discard_checklist | 7edb46bd07f064df4dbb18dff7e41fd8 |
| finish_discard_checklist | b1e3cd05fe286a3cd394cb4727943d54 |
| guard_evidence_insert | 459e227a0558cbf977d413ee22b2356b |

All functions were postgres-owned, empty-search-path, and denied anon EXECUTE. Confirmed all four checklist tables have RLS enabled; authenticated INSERT/UPDATE/DELETE/TRUNCATE privileges are absent; evidence bucket is private. Inspected checklist policies, submission constraints, and columns. Confirmed `checklist_submissions_is_pilot_check CHECK(is_pilot)`, `is_pilot boolean NOT NULL DEFAULT true`, draft/discarding/submitted statuses, submitted timestamp consistency, unique site/template/period, and original foreign keys. Template reads currently depend on pilot grants; submission/attachment/evidence reads retain Admin-or-owner authorization and upload checks retain owned-draft authorization.

The SQL Editor automatically saved the metadata-query text as an untitled private snippet. No production schema, operational records, grants, objects, or evidence changed.

## Small migration

`app/supabase/migrations/20261109172331_checklist_companywide_access.sql`:

- Replace `can_access(uuid,date)` with the existing active-account assignment predicate. Retain its signature for existing callers. Admin remains companywide; Store remains profile-assigned-site only; legacy area managers remain limited to `manager_locations`.
- Add private `can_read_templates()` using that same assignment predicate, and update only the template SELECT policy. This avoids relying on unrelated location-table SELECT privileges or RLS. PUBLIC/anon execution denied, authenticated execution allowed.
- Drop only the pilot-only CHECK and set the new-row default to false. No existing row backfill; historical pilot drafts/submissions remain true even when resumed/submitted later.
- Replace the existing configuration RPC to reject pilot access changes while preserving its template-edit branch. Retain the RPC name to avoid a parallel management endpoint.
- Replace the save RPC only to use neutral authorization/audit wording. Its answer, photo, explanation, signature, ownership, revision, occurrence, snapshot and finalization checks remain unchanged.
- Retain all existing grants, audits, templates, attachments, Storage policies, discard protections, submission protection, and unrelated role policies. No new tables, schedulers or services.

## Application

Navigation no longer reads grants. Active authenticated Admin/Store/legacy-area-manager accounts retain existing location scope; direct page access also checks active/deleted/role status. Four existing templates, form, recovery, evidence capture, signature and discard workflows are reused. Admin manages templates and reviews actual records for Monday through the selected date, including records at sites with no current grant. Historical pilot records have a visible label. Empty occurrences say Available; no rows are synthesized for missing/overdue review. MonitorQA remains official. No notifications, obligations, penalties or scoring changes.

## Validation

Tests use fictional data and disposable in-memory PostgreSQL only. Commands:

```sh
npm --prefix app test
PGLITE_MODULE=/private/tmp/tm-checklist-tools/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/tests/*sql.test.mjs
npm --prefix app run build
git diff --check
```

Pinned external SQL runtime: `@electric-sql/pglite@0.5.15`; Supabase CLI 3.1.0 used only to generate the migration filename. No repository dependencies changed.

Results: **450/450 application tests**, **55/55 SQL/authorization tests** (21 checklist tests, including four companywide scenarios), production build and diff checks passed. Existing duplicate-title and bundle-size build warnings remain. Tests cover grant-free Admin/Store/legacy access, unauthorized sites, removed assignments, inactive/deleted/unauthenticated accounts, draft recovery and ownership, required photos/explanations/signatures, private evidence and submitted immutability, retained pilot records/grants/audits, disabled grant management, retained template editing, and neutral availability without automatic records.

## Files changed (9)

- `app/src/hooks/useChecklistAccess.js`
- `app/src/pages/ManagerChecklists.jsx`
- `app/src/components/ChecklistAdmin.jsx`
- `app/src/utils/checklistRules.js`
- `app/tests/checklists.test.js`
- `app/tests/checklistsUi.test.js`
- `scripts/tests/checklist-sql.test.mjs`
- `app/supabase/migrations/20261109172331_checklist_companywide_access.sql`
- `docs/release/checklists-companywide-access.md`

Migration SHA-256: `382b1ebed078eb62eba80d35791a1f9f06664e53b5bbb3c98e39f56ef7afd194`.

## Release boundary

No production migration, function deployment, grant mutation, test upload, merge, or application deployment is authorized or performed. This branch is for development review. Recheck production metadata for drift and review the exact migration before separate release authorization. Install/verify the database change before releasing the UI; the new UI deliberately no longer provides enrollment controls. Preserve historical records/evidence during rollback; do not restore the pilot-only CHECK after non-pilot records exist.

Remaining live checks after separately authorized release: authenticated Store/Admin Data API and private Storage integration, assigned-site boundaries, current tablets/camera/signature behavior. Local fixtures do not certify live Storage behavior. No development blocker remains once the recorded automated checks pass.
