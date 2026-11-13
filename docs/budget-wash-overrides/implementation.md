# Budget Tracker Wash Overrides

Prepared locally from released main `df47a02daafbd8a5eb1c42e7bc3a8dc99a2298d7`. No hosted database execution, push, preview, merge or deployment is authorized by this document.

## Scope and behavior

- Only Budget Tracker sources at locations with `opportunities_formula = 'detailed'` subtract Wash Overrides. Yesterday and MTD have independent nonnegative integer fields immediately after Redemptions. Both entry/correction forms use the same field metadata and existing save hook/payload.
- `budgetConversion.js` is the shared Budget opportunities rule. Budget metrics, Budget reports, Site Performance, Dashboard MTD, shop Budget-derived summaries and conversion scoring all consume it with location metadata. Fractions remain fractions internally; existing formatters display percentages.
- Missing/null/blank historical overrides calculate as zero. No backfill or automatic save occurs. Explicit Detailed saves persist entered values (blank is nullable/zero in calculations); Simple saves omit the new keys entirely.
- Opportunities clamp at zero; conversion is unavailable for a nonpositive denominator, with the existing zero-point/unavailable scoring behavior. Negative/invalid overrides are rejected before save and constrained in the database.
- Simple sites retain their previous form and math. Daily Logs, Employee Sales, membership counts, revenue, goals, scoring weights and Budget-versus-Daily-Log MTD source selection are unchanged.

## Prepared migration

`app/supabase/migrations/20261113045619_budget_wash_overrides.sql` adds two nullable integer columns with nonnegative checks, without defaults, historical updates or policy changes. It extends the existing narrow `dashboard_mtd_performance(uuid[],date,date)` result with only `mtd_wash_overrides`. The existing role, assignment, completed-day, timezone and latest-snapshot restrictions are retained, as are its owner, fixed search path and explicit permissions.

PostgreSQL cannot replace a function while changing its TABLE return type. The migration therefore drops/recreates that exact RPC within one transaction, using RESTRICT (never CASCADE). The released frontend ignores the added output field, so installation precedes frontend release. Unexpected dependencies must stop installation, not be removed.

## Validation

158 focused application/regression checks passed, including both actual entry-form renderings, Detailed/Simple Yesterday/MTD math, historical nulls, persistence/clearing, invalid counts, zero/negative opportunities, weighted summaries, snapshot selection, scoring and Dashboard field whitelisting. Existing Employee Sales and Daily Log-derived Dashboard regressions passed.

Three isolated PostgreSQL/PGlite checks passed: preserved historical values/RLS/RPC permissions; negative/fractional-input rejection; and atomic rollback on an unexpected RPC dependency. No hosted database or real records were used.

Both production-base builds passed (GitHub Pages and Cloudflare). Existing duplicate-title and bundle-size warnings remain unchanged. Dependency manifests/lockfiles were not changed.

## Next release gate

Obtain authorization to push/open a draft PR and perform read-only production preflight. Verify live columns/types, current RPC body/owner/ACL/search path, dependent objects, grants/default privileges and triggers, existing role/site restrictions, and the intended Detailed/Simple roster. Repository SQL is not proof of the live schema. Reconcile any mismatch before migration authorization.

After separate production release approval: confirm recovery point; capture data/security fingerprints; apply the migration exactly once; verify preserved rows and the extended RPC/permissions; then merge the reviewed head and verify both normal deployments. Use only fictional nonproduction data for write tests. No extra environment or infrastructure is needed.

Recovery: a migration error rolls back the transaction. Stop, inspect state and do not blindly rerun. For a frontend problem, revert only the reviewed application release after authorization; retain the nullable columns, entered override values and compatible extended RPC. Do not erase new data or narrow the function projection while the new frontend is live.
