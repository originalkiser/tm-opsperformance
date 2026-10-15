# Budget Tracking update — review release

No database migration, data backfill, permission change, or security policy change is required.

## Included

- `TOTAL CASH ONSITE (Before Deposit) ($)` appears before calculated cash amounts in both entry forms. An explicit valid count, including zero, is required to complete/save an entry; shortages and overages remain savable. Existing saved rows are not rewritten.
- MTD REVIEWS precedes GOOGLE RATING. Membership Bonus is removed from the report only.
- Yesterday CASH shows existing calculated cash revenue. Color comes from the saved reconciliation snapshot: exact zero variance green; either signed discrepancy red; missing/invalid or stale reconciliation neutral. No saved variance is recalculated by this report.
- Conversion and P-Mix reuse configured location thresholds; Revenue % uses the existing expected-MTD comparison; membership uses existing growth pace rules. Missing/stale and provisional revenue remain neutral. Light/dark styles are provided.
- The seven-category weights, scoring formulas, and performance eligibility are preserved. Cash entry completion is separate from performance scoring, preserving existing historical scores.

## Company/site MTD source precedence

Site Performance, Dashboard report charts and Monthly Rollup share read-only source selection. For calendar month-to-date ranges, a Budget-enabled site's latest cumulative snapshot replaces its covered Daily Logs; cumulative snapshots are never added together or added to logs. The common cutoff is a business day completed in every selected location's timezone. Morning entries map to the preceding business date, including month-end.

Missing/invalid snapshots remain unavailable. Older snapshots are dated and labeled provisional, with provisional subtotals rather than verified company totals. Source details remain available in a collapsed disclosure and exports retain provisional labels. Sites without Budget Tracking retain their existing Daily Log source.

Daily charts and daily shop rows use explicit Yesterday fields. Cumulative MTD counts are never spread across missing days, nor are gaps filled with partial hourly logs. Daily review counts cannot be derived from Budget Tracking and remain unavailable for those chart points. Monthly shop MTD totals may therefore differ from the sum of available daily rows; the interface explains this distinction.

Employee reports and employee/hourly breakdown calculations retain the original Daily Logs. Monthly Rollup explicitly distinguishes employee columns from authoritative shop totals. Non-MTD ranges retain existing Daily Log behavior. Source queries use pagination and the existing visible-page refresh mechanism so corrections are picked up without schema/publication changes.

## Validation and release

Run all Node tests and both Vite production builds (GitHub Pages default base and Cloudflare `/` base). Fictional local interface checks cover required cash, discrepancy saving, report colors, layout, and shop-versus-employee source separation. No production test records are written.

After review approval, merge this client-only PR and allow existing integrations to build. Verify both hosts, required cash input, signed reconciliation colors, configured thresholds, and MTD source details. Roll back the client with a revert if needed; there is no database rollback.
