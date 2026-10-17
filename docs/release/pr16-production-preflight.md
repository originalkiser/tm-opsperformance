# PR #16 release preflight — 2026-10-17

**GO for draft PR review; NO-GO for production cutover.** No production SQL, account change, merge or deployment is authorized by this document.

## Verified scope

Remote main: `aaa454df1d2eb0fc9471f4940afbe68f68280ab2`. Published feature branch at review start: `ea33b78285eefe2d6700902c06233e74b25571f3`, two commits ahead of main. Live PR #16 is open, draft, unmerged and based on main. Release path inventory is in `pr16-release-files.txt` (relative to that verified main).

Release includes Dashboard Today/MTD reporting, Admin/Store application permissions, primary/additional Store assignment scope, Admin-only management routes, Site Health/Admin Entry renames, reporting/entry filter separation, responsive navigation, genuine reporting timestamps, related tests, reviewed Edge Function source changes and migration21/rollback. The latter are source artifacts only: frontend publication does not deploy Supabase functions or SQL.

Excluded: development baseline/fixtures, scoped MCP configuration, temporary validation scripts, private outputs/account bindings, browser screenshots, build output, environment files and credentials. Historical seed/migration artifacts are not replay instructions. No production two-role installer is represented as ready.

## Validation

Prior full suite: 107 passing tests; both production builds and authenticated Admin/Store development browser checks passed. No application or migration behavior changed during final packaging. Two tests referencing excluded development SQL were replaced with regressions for additional-only Store assignments and revocation/primary transfer. The affected permission test file was rerun; the full suite/builds were not unnecessarily repeated. Private development contract checks remain outside the release. Builds retain the existing large-chunk advisory.

## Production evidence and one consolidated inventory

Repository HANDOFF identifies production as `tm-opsperformance`, ref `qbdvixxooofdlfurcpqy`. The authorized Supabase project listing exposes only development. No production integration was added, no credential/configuration was changed and no production query was executed. Production Area Manager counts and assignment counts are **UNKNOWN**.

Use only `docs/sql/pr16-production-preflight-READ-ONLY.sql` for the requested consolidated inventory. Verify production ref/URL in the authorized connection first; current_database() does not prove project identity. The script runs one repeatable-read READ ONLY transaction with timeouts. It returns role/active/deleted counts, legacy primary/additional/effective assignment counts and affected site IDs/codes, minimal UUID-level assignments for individual migration decisions, plus public schema columns/constraints/RLS/policies/triggers/grants/function owners/search paths/hashes and selected protection definitions. No names, emails, Auth secrets, app_settings values or operational/cash data. Keep account UUID output private; share only aggregates publicly. Missing tables/columns/permissions are a STOP, not permission to alter production. Non-public exposed schemas, Auth profile-creation triggers and deployed Edge Functions also need controlled metadata review.

## Database gates

Both two-role **database behavior** and migration21 are required unless inventory demonstrates their exact required behavior already exists. Client role removal alone cannot constrain legacy policies/helpers. The validated development two-role installer is pinned to the dev project, baseline ledger/checksum and tmdev_* policies; it must never be repointed or installed in production. A production-specific minimal role migration and exact inverse must be authored from live definitions and validated on an isolated production-equivalent schema. Do not install a development baseline or fixtures in production.

Every legacy account (including inactive/deleted) needs an explicit approved disposition and preserved assignment snapshot. Store conversion removes former management rights; Admin conversion grants global administration. Do not automatically convert either way. Unsupported/unresolved roles block cutover. Keep any separately authorized account resolution distinct from schema migration and preserve all operational records.

Migration21 is additive: STABLE SECURITY DEFINER RPC, fixed empty search_path, qualified references, trusted postgres owner, PUBLIC/anon EXECUTE revoked and authenticated EXECUTE granted. Only one eligible MTD count/review snapshot per requested Budget site leaves the function; cash/revenue/author/settings/audit fields do not. Month/ID bounds, active/non-deleted Admin/Store authorization and completed local-business-day cutoff apply. No raw Budget RLS expansion or write-helper change is included. Before production approval, inspect required column types, valid location timezones, existing function signatures/return types/overloads/owners and all ACLs. CREATE OR REPLACE does not remove unexpected existing named grants. Existing same-signature incompatibility or unknown grants mean STOP.

## Kiser security and audit preservation

Preserve migration12's enabled protect_profile_privileged_columns trigger and its id/role/location/status/email guards. Preserve all existing RLS and integration exceptions, sequence/column/default grants, Admin-only settings/accounts/assignments/targets/scorecards, append-only edit_audit_log, cash_on_hand_versions/cash_reconciliation_audit protections and stamp/audit/reconcile functions/triggers. Preserve unrelated dvt/kiosk objects and manually created schema; do not recreate all policies from development. Keep Edge auth.getUser() verification (platform JWT verification is off), active/non-deleted Admin gates, Store operational assignment checks and Admin-only dry runs.

Compare exact before/after definitions and ACLs with a reviewed allowlist of role-policy/helper changes. Policy hashes alone are insufficient because changed helpers alter dependent policies. Check effective primary/additional/unassigned Store permissions, inactive/deleted/anonymous denial, self-escalation rejection and Admin audit behavior in an isolated production-equivalent schema. No financial/audit history may be deleted or rewritten. Live preservation cannot be certified without the missing production inventory.

## Future sequence — requires separate approval

1. Obtain inventory, current backup/recovery capability, private role/assignment snapshot, deployed Edge versions and frontend artifacts for both hosts. Verify backup freshness/PITR with the owner; historical HANDOFF claims are not live evidence.
2. Resolve legacy accounts explicitly; author/review/rehearse production-specific role forward/recovery SQL and old/new client/Edge compatibility. Coordinate a short cutover window and role/assignment-change freeze without weakening RLS.
3. After approval, recheck production identity/drift; perform only the approved account plan and production two-role migration, with transactional legacy/data guards and lock timeout. Stop on errors; never automatically retry/correct.
4. Verify protected objects/effective permissions, then install exact approved migration21. Validate its narrow read boundary using approved read-only role sessions; do not test writes on real operational records.
5. Deploy reviewed admin-users and submit-downtime-jotform Edge updates and check authenticated behavior without external Jotform submissions. Deploy invite-user only if its live use is verified (HANDOFF says it was undeployed). Node/Vite tests are not authenticated Edge runtime certification.
6. Only after DB/Edge gates pass, separately approve merge/frontend release. Both GitHub Pages and Cloudflare main integrations deploy automatically. Ensure both hosts use production URL/public key and verify approved Admin/Store sessions. New client must not precede migration21. Test overlap with cached old clients or use a coordinated maintenance window.

Review branch commits use `[CF-Pages-Skip]` to suppress Cloudflare branch previews; this does not authorize deployment. An eventual separately approved release merge must follow the repository deployment policy.

## Recovery

- Before COMMIT, abort any failing migration transaction and verify unchanged data/security; no automatic retries.
- Client-only failure: retain the harmless additive RPC and restore approved previous frontend artifacts on both hosts, plus coordinated Edge versions where necessary. Future code rollback uses an approved revert, not force-push.
- migration21: revert the dependent client first. If endpoint was absent before installation, reviewed migration21_rollback.sql drops only it, without CASCADE. If it previously existed, restore captured exact definition/owner/ACL instead of dropping it.
- Two-role: exact production rollback is missing and blocks release. Capture original constraint/helpers/policies/owners/grants and private account/assignment metadata, then rehearse the inverse. Restore the old constraint before any explicitly approved legacy role restoration; do not automatically reintroduce broad historical permissions.
- After intervening writes, never restore whole application tables or remove audit history from a snapshot. Reconcile approved metadata changes individually. Full database restore is last-resort owner-led incident recovery with verified coverage and explicit downtime/data-loss assessment.

## Remaining blockers

Production schema/security inventory and legacy account decisions; reviewed production role forward/inverse migration; isolated effective-policy/audit/old-client validation and authenticated Edge checks; verified backup/recovery and both-host release artifacts. Passing development tests does not remove these blockers. Next step is the single read-only inventory, not a production migration or merge.
