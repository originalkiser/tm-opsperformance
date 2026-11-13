# Wash Overrides release preparation

Approved implementation: `76a38b92c48c090160d76905db527ad874192702`, based on released main `df47a02daafbd8a5eb1c42e7bc3a8dc99a2298d7`. This documentation-only commit uses `[CF-Pages-Skip]` to suppress an automatic Cloudflare branch preview. A future approved merge commit must omit skip tags.

Migration: `app/supabase/migrations/20261113045619_budget_wash_overrides.sql`. No Edge Function deployment is required. Existing database recovery, Daily Log and checklist workflows remain separate.

## Exact production sequence (requires separate authorization)

1. Freeze reviewed PR head and migration checksum. Confirm live production RPC body, return projection, owner, privileges, default privileges, dependent objects, table columns/constraints/policies/triggers and Detailed/Simple classification. Stop on unexpected drift.
2. Confirm an available database recovery point. Capture before fingerprints for Budget records, targets, location settings, Daily Logs, related revenue/scoring objects, RLS and permissions; do not export private records into the PR.
3. Apply the reviewed migration exactly once, inside its existing transaction. Two nullable nonnegative integer columns are added without defaults or backfill. The exact existing Dashboard RPC is dropped with RESTRICT and recreated with one added count column. Do not use CASCADE or remove dependencies. Stop on error and inspect installed state before any retry.
4. Before exposing the frontend, verify column types/checks, old records remaining unchanged, new Dashboard projection and unchanged permissions/site scope/completed-day/latest-snapshot rules. The released frontend's field whitelist ignores the added column, preserving the old release during backend-first installation.
5. If database verification passes, mark the draft PR ready and merge the frozen head using a normal merge message without skip tags. Allow the existing GitHub Pages and Cloudflare integrations to deploy normally; do not add another deployment path.
6. Verify both hosts/configuration, Detailed Yesterday/MTD override fields and Budget-derived conversion/reporting/scoring, historical null handling, and unchanged Simple forms/formulas, Daily Logs/Employee Sales and MTD source selection. Production smoke checks are read-only; use fictional nonproduction data for writes.

## Recovery

A migration failure rolls back the transaction. Do not blindly replay or assume outcome after a disconnected client. If post-install checks fail, leave the frontend unchanged, preserve all data and request authorization for a reviewed correction.

For a frontend regression, revert only the approved application merge through normal deployment after separate authorization. Retain the nullable columns, entered override values and compatible extended RPC. Do not delete new values, drop data columns or narrow the result projection while the new frontend remains live. A database restore requires separate authorization and isolated/selective reconciliation; never automatically replace production.

Read-only preflight results are recorded separately; this document does not claim live verification or authorize production changes.
