# Resource Center — development review

Branch `codex/resource-center`, based on production main `2417332d53096d6b4d8be9f1330a68db5a879217`. The approved backend and upload-guard correction are installed. Synthetic integration tests passed; application release is authorized. Do not reapply migrations or redeploy the backend as part of the UI release.

## Scope and workflows

Resources appears in existing navigation for active, non-deleted Admin and Store profiles. One responsive page offers category/manufacturer filters, title/category/brand search, and Open / Download PDF. Equipment manuals are grouped by manufacturer metadata. Object names use immutable UUIDs so renaming a brand never moves bytes or breaks links. Legacy area managers are excluded from this feature; existing authorization elsewhere is unchanged.

Categories: General Manager Workbook; Equipment Manuals; Standard Operating Procedures (SOPs); Employee Handbook; Other Reference Materials. No training, completion tracking, history dashboard, assignments or new service.

Admin chooses a category and manufacturer (required for equipment), optionally titles a single PDF, and selects one or multiple files. Multiple files use their filenames as initial titles and are processed sequentially. All selected files are validated before any reservation. Each file publishes independently; successful earlier files remain if a later upload fails. Titles/metadata can subsequently be edited.

PDF acceptance checks extension, supplied MIME type, nonempty size, PDF header and size <= 52,428,800 bytes (50 MiB; the dashboard labels this MB). The private `resource-pdfs` bucket enforces `application/pdf` and the same byte limit. Publishing also requires the reserved Storage object with matching PDF MIME and size. SHA-256 binds resume to the same file. No server antivirus/content-sanitizing service is introduced.

`tus-js-client` 4.3.1 is pinned in the lockfile and dynamically loaded. Uploads go directly to existing Supabase Storage using 6 MiB TUS chunks, refreshed caller JWT/API-key headers, no overwrite, bounded transport retries and actor/path/content-scoped resume fingerprints. Pause retains the reservation; reselect the same PDF to resume. Finish completed upload handles successful transfer followed by lost/failed publishing. Cancel invalidates the upload reservation before file cleanup. Expired TUS sessions can be canceled and started again. No background cleanup or automatic destructive retries.

Viewing uses authenticated no-store Storage download, followed by current RLS index/session rechecks, and a temporary Blob URL. The viewer has an iframe plus explicit new-tab and download fallbacks. Blob URLs are revoked on close/unmount. There are no public or signed document URLs. Already downloaded/opened copies cannot be remotely revoked. PDFs load completely before the preview opens; large files consume browser memory and transfer time.

## Installed backend

Migration: `app/supabase/migrations/20261106202656_resource_center.sql` (generated with the CLI's local-only migration command).

- One `resource_documents` index with metadata, current path, creator/timestamps and optimistic revision.
- One pending upload and one cleanup path in that same row. These are recovery references, not a version history.
- One private `resource-pdfs` bucket: 52,428,800-byte maximum, PDF MIME only.
- Private authorization helpers, one public `manage_resource` RPC and a bucket-scoped final upload trigger. Every management RPC checks the current active Admin profile; clients cannot directly mutate index rows.
- Index and Storage RLS allow active Admin/Store reads only. Store sees published documents/current bytes only. Anonymous, inactive, deleted and other roles are denied. Restrictive bucket guards protect against unrelated broad permissive policies. Existing checklist policy definitions, bucket and upload guard remain unchanged.
- One `manage-resource-files` Edge Function for exact-path Storage cleanup. Explicit `auth.getUser` is required with caller-JWT Admin RPC authorization. Its privileged client stays server-side. Platform `verify_jwt=false` follows the existing asymmetric-key workflow; never remove the explicit authentication check.

Replacement reserves/uploads new bytes while the old PDF remains current. Atomic publish switches the current path and retains the retired path for cleanup. Removal first hides the document and freezes its cleanup path. Cleanup obtains an authorized exact path from the RPC, deletes it through the Storage API, then finishes only if Storage metadata confirms absence. Caller-supplied paths/buckets are never used. Late upload completion must still match a current reservation, including at the final Storage metadata insert/update. Cleanup interruption retains the reference for an active Admin to retry. Additional replacements/edits are blocked until recovery is complete. Account deletion can null the creator reference without deleting a document or adding a new account-deletion restriction.

Storage deletion and SQL are not a distributed transaction. Do not delete `storage.objects`/`storage.buckets` with SQL. Incomplete TUS sessions are managed by Storage; a canceled reservation prevents them publishing even if a stale client continues. Hosted synthetic tests verified pause/resume, replacement, Storage deletion and empty final index/object metadata. Provider-internal multipart bookkeeping is not directly inspectable. Source PDFs require independent backups; database backups exclude PDF bytes.

## Verification

Final results: **443 application tests, 46 isolated SQL/authorization tests**, production build, Edge entry-point bundle check, and reviewed-file scope/whitespace/secret checks passed. Thirteen application tests directly cover Resources. The production build retains the existing duplicate-title/chunk-size warnings.

Migration SHA-256: `cb7efdb1524c48e4b19d36b72bf88e474a926cc20411af68292f04a0403f5e74`.

Focused tests cover size/header/type checks (including a synthetic 28 MB file and exact maximum), categories/manufacturers, multiple-file upload, active Admin/Store access, revoked/inactive/deleted/anonymous denial, optimistic conflicts, replacement/removal recovery, stale uploads, exact-path cleanup, no-store retrieval, Blob URL cleanup and mobile fallbacks. The installed TUS SDK is exercised with a fictional HTTP stack to verify HEAD-offset recovery and authenticated PATCH of the remaining bytes. SQL tests apply the actual checklist migrations and deliberately broad preexisting Storage policies in isolated PGlite before applying the proposal.

```sh
cd app
npm test
npm run build
cd ..
PGLITE_MODULE=/path/to/pinned/pglite/dist/index.js node --test scripts/tests/*sql.test.mjs
git diff --check
```

Native Edge local-only testing used synthetic Admin/Store profiles, fictional manufacturers and a synthetic PDF at a 375px emulated width. Verified controls fit, Store management controls are absent and PDF preview/new-tab/download controls appear. Actual iOS/Android/tablet verification remains a device-specific follow-up; hosted large-file testing passed. No fixture files or real PDFs are included in the feature.

Dependency audit was compared against current main: no new advisory packages or counts; existing 14 advisories remain unchanged. No unrelated dependency upgrades were made.

## Minimum production sequence — separate approval required

Backend verification limitation: three concurrent Daily Log inserts were attributed to authorized Store activity. Five existing records changed during the review, and their prior values cannot be reconstructed from the available history. All historical records were **not** proven unchanged. No Resource Center Daily Log write path or evidence of Resource Center-caused corruption was found. This uncertainty was accepted for the separately authorized synthetic PDF integration test; broad production fingerprint comparisons are not part of that test.

1. Review/freeze the migration checksum and all feature files. Reconfirm project `qbdvixxooofdlfurcpqy`, a recent recoverable database backup, the current global 50 MB limit and existing Storage capacity. Preserve independent source/backup copies of PDFs; database backups do not include uploaded files.
2. Run read-only preflight in the existing authorized SQL Editor. Stop if new objects already exist, dependencies differ, or any prerequisite fails. Do not alter settings/permissions to bypass failures.
3. Once separately authorized, apply the reviewed migration exactly once. Stop on any error; do not automatically retry. Verify index/RLS, helper/RPC ACLs, bucket limits and unchanged checklist definitions.
4. Separately deploy only `manage-resource-files` with its reviewed shared-key dependency and intended authenticated flow. No documents are created by migration/function installation.
5. Release the approved application through the normal PR/checks/GitHub Pages/Cloudflare workflow. Verify both hosts use the expected merge commit.
6. With explicit authorization, smoke test a disposable synthetic PDF as Admin and Store, including a large TUS transfer, interruption/resumption, replacement and Storage API deletion. Verify unrelated checklist evidence is unchanged. Then Admin may upload approved operational documents through Resources; never GitHub.

Read-only preflight:

```sql
begin transaction read only;
select current_user,
 to_regclass('public.resource_documents') as must_be_absent,
 to_regnamespace('resource_private') as must_be_absent_schema,
 to_regprocedure('public.manage_resource(text,uuid,integer,jsonb)') as must_be_absent_rpc;
select id,public,file_size_limit,allowed_mime_types
 from storage.buckets where id in ('resource-pdfs','manager-checklist-evidence');
select policyname,permissive,roles,cmd,qual,with_check from pg_policies
 where schemaname='storage' and tablename='objects' order by policyname;
select pg_get_triggerdef(oid) from pg_trigger
 where tgrelid='storage.objects'::regclass and not tgisinternal;
commit;
```

Read-only post-install verification:

```sql
begin transaction read only;
select id,public,file_size_limit,allowed_mime_types from storage.buckets
 where id in ('resource-pdfs','manager-checklist-evidence');
select count(*) as expected_zero from public.resource_documents;
select relrowsecurity from pg_class where oid='public.resource_documents'::regclass;
select has_table_privilege('authenticated','public.resource_documents','INSERT,UPDATE,DELETE,TRUNCATE') as must_be_false,
 has_function_privilege('anon','public.manage_resource(text,uuid,integer,jsonb)','EXECUTE') as anon_must_be_false,
 has_function_privilege('authenticated','public.manage_resource(text,uuid,integer,jsonb)','EXECUTE') as authenticated_must_be_true;
select policyname,permissive,roles,cmd,qual,with_check from pg_policies
 where (schemaname='storage' and tablename='objects') or (schemaname='public' and tablename='resource_documents')
 order by schemaname,tablename,policyname;
select n.nspname,p.proname,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='resource_private' or (n.nspname='public' and p.proname='manage_resource');
select pg_get_triggerdef(oid) from pg_trigger
 where tgrelid='storage.objects'::regclass and not tgisinternal;
commit;
```

Routine rollback: revert the application release through the normal PR workflow. Preserve resource/checklist tables, documents, cleanup references and Storage objects. Keep the reviewed backend for safe cleanup. Do not drop buckets/tables, delete evidence, restore production wholesale or assume a database rollback recovers PDFs.

## Reviewed feature manifest

- `app/package.json`, `app/package-lock.json`
- `app/src/App.jsx`, `app/src/components/NavBar.jsx`
- `app/src/pages/Resources.jsx`, `app/src/components/ResourceViewer.jsx`, `app/src/utils/resourceLibrary.js`
- `app/supabase/config.toml`
- `app/supabase/migrations/20261106202656_resource_center.sql`, `20261106233818_resource_upload_finalization_guard.sql`
- `app/supabase/functions/manage-resource-files/index.ts`, `handler.js`
- `app/tests/resourceLibrary.test.js`, `app/tests/checklistsUi.test.js`, `app/tests/locationHelpUi.test.js`
- `scripts/tests/resource-sql.test.mjs`
- `docs/resource-center.md`

## Installed upload-authorization correction

`20261106233818_resource_upload_finalization_guard.sql` replaces only the Resource-specific trigger function. Storage probes caller RLS then finalizes metadata as service_role without the user JWT subject. The guard permits that trusted finalizer only with a currently active, non-deleted Admin owner and the exact live pending reservation. Shared row locks serialize cancellation/account changes. Existing caller authorization, grants, Storage policies, private reads and checklist behavior remain unchanged. The original migration stays byte-for-byte unchanged.

Correction SHA-256: `3f9aba6c971301b9b70cbfbbd78cae4a98fb24ea3e0676ddbd1f919cf79b9565`.

The original guard reproduces the hosted 42501 failure in isolated PostgreSQL. Regression tests cover corrected finalization, inactive/deleted/non-Admin owners, missing owners, spoofed callers, unknown paths and canceled reservations. The separately approved production correction was executed once and verified before retesting.

## Hosted synthetic integration results

Normal authenticated local Admin workflow against the approved production backend; no credentials extracted. Small upload returned 201; authenticated PDF retrieval returned 200; unauthenticated/public access was denied. A 27.3 MB synthetic PDF uploaded successfully. Replacement paused at 46%, the prior PDF stayed readable, and reselecting the exact file resumed with HEAD 200/PATCH 204. The replacement rendered and its downloaded SHA-256 matched its source.

Retirement and removal cleanup returned Edge Function POST 200 and Storage DELETE 200 with ObjectRemoved events. Final Resource index and indexed PDF object counts were zero. Unrelated Storage/checklist evidence metadata and Storage controls matched scoped pre-test fingerprints. No operational PDFs, synthetic fixtures, private test IDs, credentials or exports are part of this repository. No writes to budgets, Daily Logs, employee or checklist records were performed by the test. Historical operational records were not broadly fingerprinted; the previously accepted Daily Log evidence limitation remains as documented above.

## Application release and rollback

Backend installation is complete. Run final application/SQL tests, build and staged scope checks. Commit only the reviewed manifest, open a PR to main, wait for checks, merge without skip tags, and verify GitHub Pages and Cloudflare publish the expected merge commit. Smoke tests are read-only; leave the library empty and upload no operational PDFs. Store management controls must remain absent.

Routine rollback reverts the application release through the normal PR workflow. Preserve the installed backend, private PDFs, Resource records, cleanup references and checklist evidence. Do not delete Storage/database objects or restore production wholesale. A function rollback would reinstate the upload failure and requires separate review.
