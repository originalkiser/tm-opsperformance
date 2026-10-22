# Site Performance / Budget Tracking score parity

PR #29 uses the existing `app/src/utils/budgetScoring.js` `scoreBudgetLocations` as the only official scoring model. Its implementation is unchanged. Both reports now consume `useBudgetReport` and `buildBudgetReportRows`, and render `BudgetScoreDetails` / `formatBudgetScore` for the same official score or unnormalized provisional preview.

## Sources and weights

| Category | Weight | Existing calculation/source |
| --- | ---: | --- |
| MTD Conversion | 20 | Budget MTD tier sales / (washes minus redemptions), proportional to site conv_yellow (default 10%) |
| MTD Total Revenue | 20 | Complete daily revenue plus verified starting balance, competitive points within the common eligible pool |
| MTD P-Mix | 10 | (better + best) / tier sales, proportional to site pmix_green (default 60%); zero sales gives zero scoring points |
| MTD Total Washes | 10 | Budget MTD washes, competitive points in the same eligible pool |
| Revenue to Plan | 15 | Verified MTD revenue / (monthly revenue goal × elapsed days / days in month), capped |
| Membership Growth | 15 | (current total members − month-start members) / (configured daily growth × elapsed days), capped; negative growth receives zero |
| Google Rating | 10 | Current Budget rating / monthly target rating, capped; valid ratings 0–5 |

Raw inputs remain signed-in, read-only selects from `budget_daily_entries`, `budget_targets`, and applicable `revenue_starting_balances`. Daily revenue reads use the existing paginated `fetchRevenueEntries`; the October transition balance/cutoff rules are retained. No new RPC, access path, raw-table fallback on error, or backend dependency is introduced. Existing RLS remains authoritative.

Official scores require the exact reporting-date entry, complete performance fields, valid MTD counts, complete verified revenue through the previous business day, valid targets and all seven categories. Missing, duplicate, invalid, stale or provisional inputs do not become zero or get rescaled to 100. At least two complete eligible sites are required. Competitive revenue/wash points average occupied tie positions; final score ties use competition ranks (1, 2, 2, 4). Official scores use one decimal. Excluded/disabled sites do not enter the pool. Cash reconciliation remains separate from performance scoring.

## Period, filters and refresh

Previously Site Performance used a common site-timezone completed cutoff and could use an end-date-plus-one Budget snapshot for historical ranges; Budget Tracking used today's browser-local morning entry date and ignored the Reports date picker. Both scored report paths now use the selected range end as the morning reporting-entry date. The business cutoff is the preceding calendar date. Both apply the same existing Budget calendar convention and monthly targets. The shared date picker now controls Budget Tracking too. The selected range must start on the first of that reporting month and end no later than today.

Historical MTD comparisons use that same entry-date convention. A last-month range ending on the month's final date covers through its preceding day; this change does not invent a new closed-calendar-month score using the next month's entry. Other/custom/non-MTD/future ranges retain the existing Site Performance metrics and show an explicit scoring-unavailable explanation. Budget Tracking shows the same period requirement instead of silently comparing a different period.

Site/market filters hide rows only. Both reports score all accessible eligible Budget sites before filtering, so a single displayed site retains its Budget rank and competitive score. Sites with Budget disabled keep their Daily Log metrics without an official Budget score; excluded Budget sites receive no score. Display filters never expand the signed-in user's location scope.

Both report loaders use the existing visible-page 60-second / visibility refresh, with cleanup, scope keys and latest-request guards. They refresh independently on the same cadence: simultaneous database corrections can briefly yield different snapshots until the next successful refresh. For equal input snapshots/date/pool the values and ranking are identical. Read errors show an alert rather than silently substituting Daily Log data or retaining an official score from a failed read. Closing the Budget editing modal refreshes via the same loader.

## Presentation and validation

Site Performance retains the compact horizontally scrolling table, original columns, sorting, shop/market/date filters and CSV/Excel/PDF actions. The scored path adds sortable/exported Rank, MTD Revenue, Total Members, Revenue %, MTD Goal %, Membership Growth, Expected Growth, Rating and Score columns. Budget MTD conversion and P-Mix use Budget formatting and thresholds. Score details expose all seven components and completeness reasons. Aggregate totals retain existing metric behavior; score/rank/growth-target subtotals are deliberately not invented.

Validation: 94 affected Node tests passed, including 11 new direct report-rendering / shared-loader cases for identical KPIs, score details and ranks; missing/stale/provisional/zero data; ties; display-filter pool preservation; date/target/balance scoping; disabled/excluded sites; sort/export completeness; refresh corrections; racing responses; errors and empty scopes. Both production builds passed (default GitHub Pages base and `--base=/`), with existing duplicate-title and bundle-size warnings. Tests use deterministic local fixtures; no live Supabase or production record access is claimed.

No application security investigation, SQL execution, migrations, policies, permissions, RPCs, dependency changes or company Dashboard behavior changes. Draft only; merge/deployment require separate approval. Commit uses `[CF-Pages-Skip]` to suppress branch previews.
