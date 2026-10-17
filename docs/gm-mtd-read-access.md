# Proposed company-wide GM MTD read access

**Validated in development; production remains unverified and unapplied. Do not merge/deploy until the production release gates pass.**

GM means the `store` role; an active Store can read company performance even without an assignment. The existing `budget_daily_entries_all` policy scopes all commands, including SELECT, through `user_can_edit_location`. Expanding that FOR ALL policy would also expand writes and is prohibited.

## Narrow read endpoint

Migration 21 creates `public.dashboard_mtd_performance(uuid[], date, date)`. Its only outputs are location ID, entry date, cumulative MTD washes/redemptions/tier sales and current review count. It returns at most one latest eligible snapshot per requested Budget-enabled site. It exposes no cash, revenue, reconciliation, rating, targets, audit rows, author, credentials or free-text fields.

This is an explicit, constrained SECURITY DEFINER read boundary, not a change to raw-table RLS. It executes as postgres to read across assignments but requires `auth.uid()` to match an active, non-deleted profile whose role is admin or store (including an unassigned Store account). PUBLIC and anon execution are revoked; only authenticated callers are granted execution. The search path is fixed empty and table/auth names are qualified. The STABLE function contains only validation and SELECT. Requested dates must span part of one month, location lists are limited to 1,000 IDs, and future/incomplete business dates are excluded in each site's timezone.

Existing raw-table permissions, RLS, `user_can_edit_location`, entry scopes, Admin routes, triggers and settings remain unchanged. Every active assigned store account receives the requested company performance read capability; no separate GM role is introduced.

Only Dashboard MTD opts into the RPC. Monthly Rollup, Daily Trends and existing entry/report consumers retain their original table/RLS reads. Existing snapshot-selection/cutoff logic still applies after the RPC response. Missing RPC or denied access produces an explicit error, with no raw-table fallback or fabricated totals. The client whitelists returned fields defensively; server projection remains the security boundary.

The fixed search path and transactional execution grants follow [PostgreSQL SECURITY DEFINER guidance](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

## Approval and verification gates

1. Review the precise additional company-read capability above. Approve migration 21 separately; this PR does not authorize applying it.
2. In an isolated Supabase/Postgres copy with fictional data, verify actual schema compatibility: `user_profiles.is_active/deleted_at/location_id`, location timezones/feature flags and integer Budget count columns. Development SQL/security validation passed; production schema evidence is still required.
3. Run the migration twice to confirm repeatability. Inspect function owner, fixed search_path, STABLE flag, execute grants and the unchanged base-table policies/grants.
4. Exercise requests using genuine role sessions (not just service-role calls):

| Caller | Narrow RPC | Existing raw reads / writes |
|---|---|---|
| Anonymous | Denied | Unchanged |
| Inactive or deleted account | Denied | Unchanged |
| Active Store with no assignment | Company performance counts | No operational writes |
| Active store assigned to A | Performance counts for A and B | Raw access unchanged; writes to B denied |
| Store with additional assignment to A | Company performance counts | Writes to unassigned B still denied |
| Admin | Company performance counts | Existing Admin access unchanged |

5. With fictional rows, confirm cutoff/month bounds, latest snapshot only, missing/invalid/stale entries, pagination/location limits and absence of all non-whitelisted fields. Compare existing cash/scoring/history checks before/after. Test store A update/insert/delete attempts at B in the isolated database and verify denial; do not probe writes using production records.
6. After explicit production approval, apply the additive migration with the production project explicitly selected. Verify the narrow endpoint with approved read-only role sessions. Only then separately approve merging PR #16, with a merge message that omits `[CF-Pages-Skip]`. The normal integrations deploy the client.

## Rollback

Revert/deploy the client to its previous table-read path first, then apply `migration21_rollback.sql` after approval. Rollback drops only this endpoint; it deletes no records and changes no existing permissions or policies. If the endpoint is absent while the new client is running, MTD reports its availability error rather than falling back.

Local validation covers mocked client/RPC behavior and a static SQL security contract; those tests do not establish database-enforced authorization. Development role/RLS checks passed; production compatibility and the production-specific two-role migration remain blockers.

See [the current release preflight](release/pr16-production-preflight.md) for production sequence and recovery requirements.
