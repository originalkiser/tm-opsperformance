# PR #22 — production database review package

Status: development PASS; production compatibility and installation approval outstanding. PR remains draft. No production operation, application test or development validation was repeated to prepare this package.

## Frozen SQL and evidence

- Forward: `docs/sql/daily-plans-lost-REVIEW-ONLY.sql`.
- Pre-release inverse: `docs/sql/daily-plans-lost-ROLLBACK-REVIEW-ONLY.sql`.
- One reusable read-only catalog check: `docs/sql/daily-plans-lost-production-compatibility-READ-ONLY.sql`.
- Exact SHA-256 values and the 22 successful development assertions: `docs/release/pr22-plans-lost-validation.json`.

Both SQL bodies match the executed development harness exactly, with only their outer BEGIN/COMMIT wrappers omitted in that forced-rollback run. Its expected P2200 completion signal and independent read-back established restoration of all public records/audit data, schema, policies, grants and helpers. No development migration-history entry remained. No development validation rerun is needed.

## Preservation and scope

Adds nullable integer `plans_lost_today`, immutable per-row legacy marker `net_members_legacy`, one constraint, and one SECURITY INVOKER trigger function/trigger. The daily loss can occur only on the already unique location/date/08:00/split-0 record. Existing grants already authorize assigned-site editing; no new table grants, policies, authorization helpers or role changes are needed. PUBLIC/anon/authenticated execute is revoked only for the newly created trigger function. Existing trusted service_role defaults are not a compatibility failure.

Existing records receive a metadata-only legacy default of true; new records default false. No UPDATE/backfill occurs. Existing manual Net Members (including zero and negative values), sales, identifiers, timestamps and audit history remain unchanged. Installation takes a short exclusive table lock and checks original-row hashes, policies and ACLs before COMMIT; any mismatch aborts. The trigger prevents unauthorized model conversion and protects saved losses. Record-identity edits on unaffected legacy days retain prior behavior. Existing RLS and assigned-site checks remain authoritative; no SECURITY DEFINER bypass is introduced.

## Production compatibility — one remaining read-only gate

Reuse the previously reviewed two-role/assigned-site security model, production identity `tm-opsperformance / qbdvixxooofdlfurcpqy`, four-column Daily Log key, and existing default-grant evidence. Saved development rehearsal evidence explicitly does not prove production catalog parity; the original full production inventory file is no longer available in this workspace. No production connection is used here.

The single catalog query fills only this feature's compatibility gap. It returns no operational records or credentials. Confirm:

- Daily Log is a regular/partitioned supported table owned by the trusted installer, RLS enabled; PostgreSQL supports metadata-only constant defaults (production is expected to be modern Supabase PostgreSQL).
- `id`/`location_id` are non-null UUIDs, `log_date` non-null date, `time_slot` non-null time without time zone, `split_index` non-null integer default 0, and the validated UNIQUE(location_id, log_date, time_slot, split_index) exists. `net_members`, `memberships_sold` and membership tiers remain ordinary integer columns with default 0; other required application fields retain their known defaults.
- Feature columns, constraint, trigger and function do not already exist. If any exist, stop; do not rerun or overwrite an unknown installation.
- Existing SELECT and I/U/D policy expressions/helper bodies still implement the approved active Admin/assigned Store model, including primary/additional assignments and inactive/unassigned denial. No policy names need to equal development names. Compare definitions/ACLs with retained production evidence; unexpected differences require review, not automatic correction.
- Existing Daily Log trigger bodies do not conflict with the added fields or loss-anchor guard, require unsupported extra insert fields, or bypass/change assignment restrictions. Any unfamiliar trigger/helper/schema mismatch is a STOP.

Return the entire metadata result for review. Do not run the installer until compatibility is reviewed and production installation is explicitly approved.

## Exact installation sequence — only after separate approval

1. Confirm production Dashboard name/reference independently; `current_database()` does not identify a Supabase project. Confirm a usable backup/recovery point and a quiet write window. Keep PR #22 unmerged and its frontend undeployed. Retain the preflight JSON and reviewed SQL checksums.
2. In production SQL Editor as `postgres`, paste the **entire forward file unchanged** and run once. Its BEGIN/COMMIT, 5-second lock timeout and 60-second statement timeout are part of the reviewed package. Success requires COMMIT; on any error stop, retain the exact error and do not retry or repair automatically. If the editor leaves a failed transaction open, issue only ROLLBACK.
3. Before any new-frontend writes, rerun the **same read-only catalog query**. Compare with saved preflight: exactly two new columns, the one check constraint and one new trigger/function; new loss nullable integer; legacy boolean NOT NULL default false; function SECURITY INVOKER with empty search_path; PUBLIC/anon/authenticated execution denied. Existing policies, table ACL, helpers, constraints and prior triggers must be unchanged. The install transaction already asserted all old row contents and legacy markers before committing; no production fixture writes or full record export is needed.
4. Return installer completion and post-install JSON for review. Production installation success is not permission to merge/deploy. Obtain separate release approval before PR #22 merge and automatic deployments. Historical days remain protected; conversion needs its own approved transition.

## Rollback / recovery

Before the new frontend is deployed, and only under separate production approval, run the **entire inverse file unchanged** as postgres in a quiet window. It takes the same bounded lock and refuses to proceed if ANY saved loss exists, including zero. With no feature data it removes only the new trigger/function/constraint/columns; no original rows, grants or RLS objects are changed. Rerun the same catalog query and compare to the original preflight.

If any loss has been saved, do not drop the schema, clear losses, delete anchors or use CASCADE. Retain the additive schema and request a separately reviewed data-preserving recovery plan. Reverting the frontend also needs explicit release approval; this package authorizes neither rollback execution nor deployment.
