# October starting-balance cutoff correction

October 12, 2026: owner authorized the complete release. Production migration16 applied once and verified before publication; cutoff check/default are October 10. Historical records and policy checksums match preflight. Application publication and deployment follow the checks below.

The verified balance covers October 1–10, with fixed cutoff October 10. The October 12 morning entry represents October 11 business revenue and is added exactly once. October 11 morning entries represent October 10 and remain excluded. Corrections replace the day's contribution; missing or invalid later days make the total and revenue pace unavailable. November ignores the October balance. Historical values and daily entries remain unchanged.

The Admin editor states the new coverage explicitly. Its acknowledgment requires verification through October 10. Audit display shows both prior and new cutoffs; existing immutable audit records and database triggers are preserved. Admin-only modifications, existing security policies, and historical/dark-mode improvements are retained.

## Production inspection and migration

Read-only inspection of production project `qbdvixxooofdlfurcpqy` on October 12 found zero starting balances and zero audit records. This is a point-in-time result and must be repeated immediately before execution.

Leave applied migration15.sql unchanged. New migration16.sql changes only the cutoff default and check constraint. It locks the balance table and aborts atomically if any balance has a cutoff other than October 10. It never guesses an amount, relabels an October 11 balance, deletes a balance, or changes security permissions.

If an October 11 balance appears before release, STOP. Preserve the record and audit trail, obtain independently verified October 1–10 coverage for that site, and prepare a separately reviewed correction transaction using the existing Admin stamping and audit triggers. Do not blindly subtract an unverified October 11 daily figure. The empty-table migration must not be forced through.

## Validation

- 19 automated tests passed, including October 12 mapping, pre-cutoff exclusion, October 11 corrections, missed dates, pace suppression/restoration, zero amounts, duplicate rejection and November reset.
- Actual component rendering checks passed for the fixed October 10 editor, acknowledgment, historical reference and dark-mode styles.
- Rollback-only SQL test in `tm-ops-dev` passed: existing old-cutoff guard, exact migration16 body, October 10 default/check, Admin insert/correction and audit old/new amounts and actor, October 11 rejection, Manager write/audit access denial. Daily/historical row fingerprints and all policies were unchanged.
- GitHub Pages production build and Cloudflare production build with root base path passed. Existing duplicate-title and large-bundle warnings remain unchanged.
- Latest main was fetched before work; the starting tree matched the reviewed release. No changes to migrations12–15, authentication, existing security policies or deployment workflows.

The corrected feature has not been exercised with real production balance values or newly signed-in Manager/Admin browser sessions. Validation here consists of calculation tests, real-component rendering and authenticated-role database tests in development; no production write tests were performed.

## Execution after explicit approval

1. Refresh main, confirm migration16 is still unused, verify backup readiness, repeat saved-balance/schema checks, and pause starting-balance edits during the rollout.
2. Apply migration16 once to the verified production project. If the guard fails, stop. Verify October 10 default/check and unchanged policies/triggers/audit records.
3. Publish the reviewed branch/PR only after authorization, merge after database checks, deploy both hosts, and ask active users to reload. Coordinate a short entry pause: old cached clients reject October 10 balances until reloaded.
4. Verify live Admin cutoff/acknowledgment, historical reference, first real verified save/audit, and October 12 morning totals. Enter only independently verified October 1–10 balances.

Rollback: retain all balance/audit/daily records and security fixes. Do not blindly restore the old October 11 application against October 10 balances. If needed, prepare an approved application rollback that disables the transition balance and falls back to incomplete automatic totals; retain the corrected schema and audit history. If application deployment fails after the migration, stop entry and finish/revert the application safely before reopening it. Reverting the cutoff requires a separate reviewed data plan and approval.

