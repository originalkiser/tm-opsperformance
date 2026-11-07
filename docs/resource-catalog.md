# Resource folders and catalog — development review

Branch: `codex/resource-folders-catalog`, from deployed main. The separately authorized catalog migration is installed and verified. This application release must not reapply it or redeploy the existing backend. No PDF uploads or catalog edits are part of release smoke testing.

## Scope

Resources initially shows category folders. Equipment Manuals opens manufacturer folders; leaf folders show PDFs. Back and breadcrumbs navigate the current path. Search always searches all authorized documents by title and current category/manufacturer display names. Admin upload/edit, private viewing/download, resumable transfer, replacement and cleanup are reused.

One compact Admin “Manage folders” panel supports add, rename, up/down and empty-folder deletion. Equipment Manuals' manufacturer behavior is a stable catalog property, independent of its display name. New categories contain PDFs directly; no general nested-folder system is introduced.

## Proposed migration

`app/supabase/migrations/20261107053107_resource_catalog.sql` adds **one** table, `resource_catalog`, and one narrowly scoped Admin RPC. No Storage bucket, policy, upload guard, cleanup function or existing authorization helper is changed.

Each catalog row has a stable UUID plus immutable category/manufacturer keys, display name, order and optimistic revision. Category rows have an empty manufacturer key. Existing `resource_documents.category` and `brand` values remain byte-for-byte unchanged and become immutable association keys under a composite foreign key with a supporting reference index. Their original text is an identifier, not a second editable display name. Newly created keys are generated UUID strings. Catalog display names are authoritative. No duplicate document-reference columns are added.

The five categories and distinct existing manufacturer values are backfilled. Normalized duplicate sibling names cause migration failure rather than silently merging records. Existing nonempty manufacturer metadata in another category is retained and that category opens manufacturer folders. The two original fixed-category CHECK constraints are replaced by the catalog foreign key and a narrow category/manufacturer validation trigger. Existing title, file, brand-length and other constraints remain.

Catalog RLS reuses active Admin/Store read authorization. Direct client writes are revoked. `manage_resource_catalog` checks active Admin status before every action and compares the complete reviewed UUID/revision inventory. Catalog edits serialize through one transaction advisory lock; row locks and the document FK protect deletion against concurrent assignments. Server checks apply to all document rows, including unpublished uploads and pending cleanup. Deleting an empty category also removes its unreferenced manufacturer entries. Reassignment uses the existing document metadata editor; finish/cancel uploads or cleanup before editing that document, as today.

## Verification

Focused tests cover Admin/Store navigation, default folder-only view, manufacturer drill-down, breadcrumbs/Back, global search across paths and renamed labels, Admin editor RPCs, duplicates, stale inventory rejection, ordering, reassignment and active/pending/cleanup deletion guards. Backfill tests compare full document rows and Storage metadata before/after, including pending reservations. SQL tests retain existing deliberately permissive Storage policies to test restrictions and replay replacement/read/cleanup with catalog references installed.

Tests use fictional data and isolated PostgreSQL only. Browser credentials, local storage and production records are not used. Actual overlapping transactions are not emulated by the single-session fixture; database FK/row/advisory locks are the concurrency mechanism and require release-time compatibility review.

Final local results: **447 application tests and 51 SQL/authorization tests passed**. Production build and diff checks passed; the existing large-chunk build warning remains. No new dependency was added.

## Production sequence — separate approval required

1. Review migration checksum, backups and rollback scope. Read-only preflight must verify the catalog/RPC/trigger are absent, original CHECK constraint names match, metadata can be backfilled without normalized-name collisions, and existing permissions/functions match the installed Resource backend.
2. Prepare the application release and verify its tests/build before scheduling the database step. Apply the migration once through the authorized SQL Editor and stop on error; do not reapply existing Resource migrations or redeploy the cleanup Edge Function.
3. Verify category/manufacturer counts, all document IDs/metadata/paths/reservations preserved, RLS/grants and unchanged Storage controls. Release the app promptly through the normal approved PR/check/deployment workflow. The previous UI cannot display renamed labels or select newly created keys, so do not make catalog edits during the deployment transition.
4. Read-only Admin/Store smoke checks: folders/search/metadata selectors, original PDF access, no unexpected document or Storage changes. Hosted testing needs separate authorization; use synthetic files only if authorized.

## Rollback

Prefer application-first recovery while preserving catalog, document rows, private PDFs and pending cleanup. Stop catalog editing during recovery. Existing keys remain intact, but the old UI displays original key text and cannot manage new categories; after new keys are used, prefer a focused forward fix or a catalog-aware application revision rather than treating an old UI as fully compatible.

Before removing the database changes, independently inventory every reference and prepare a reviewed mapping back to the old five-category scheme and manufacturer labels. Refuse rollback if a document/pending operation cannot be mapped safely. Do not drop the catalog/FK or restore old CHECK constraints over unmapped rows; never delete documents, Storage metadata or PDF bytes as rollback. No destructive rollback script is included, because safe reversal depends on post-release catalog usage. Database backups do not restore uploaded PDF evidence.
