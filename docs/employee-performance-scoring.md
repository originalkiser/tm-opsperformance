# Employee Performance Score — Team Sales

Frontend-only draft PR #30. The score uses existing employee/site Daily Log attribution and the Reports date, market and site filters. No Site Performance, Budget Tracking or shared `logMath` formula is changed.

## Scoring

- Total membership sales: 33.33 × employee sales / highest sales among all eligible employee/site rows in the selected filters.
- Conversion: 33.33 × employee conversion / highest eligible conversion within the same Simple or Detailed formula cohort.
- P-Mix: 33.34 × (Better + Best) / membership sales, directly against a perfect 100%, not against the best employee.
- Contributions are rounded to two decimals and added for the displayed 0–100 score. Equal displayed scores share competition ranks (1, 1, 3).
- Google Reviews never affect eligibility, scores, normalization maxima or ranks. Opportunities are the existing conversion denominator and an eligibility check, not a fourth weighted category. Reactivations and Net Members do not enter the score.

The 100-opportunity minimum is an explicit conservative product eligibility floor, not a statistically calibrated guarantee. A row also needs membership sales (otherwise P-Mix is undefined), a recognized opportunity formula and reliable attribution. Ineligible rows cannot set either benchmark. A cohort with only one eligible employee gets its own highest conversion benchmark; the details expose that denominator rather than inventing peers. No score is normalized or fabricated for ineligible rows.

Simple opportunities remain washes minus member washes. Detailed opportunities remain washes minus member washes plus membership sales. Conversion benchmarks and ranks are separate by formula. Sales uses the highest eligible employee/site total across the selected filters as requested. There is deliberately no single cross-formula rank. Combined/By Site display mode does not recompute the cohort; changing the actual report filters does change the eligible comparison pool.

## Safe correction handling

Daily Logs contain cumulative shop checkpoints, not individual transaction records. `employeeDeltasByDay` assigns each increase to the employee named on the ending checkpoint. The existing shared helper clips decreases to zero, which can overstate employee totals after a correction; it remains unchanged for unrelated reports.

The new Team Sales selector validates each site-day before calling that helper. Any decrease in total washes, member washes or a membership tier excludes the entire day from employee attribution. Missing/invalid counts, invalid or duplicate hourly checkpoints, activity without an employee name, gaps over an hour between active checkpoints, or inconsistent wash/opportunity increments also exclude the day. Tier corrections are checked independently so reclassifying a sale cannot inflate P-Mix.

No employee is arbitrarily charged for a correction, and historical data is not rewritten. Reliable days conserve cumulative sales/wash totals; excluded days contribute no employee sales. Affected employees with no reliable days show unavailable figures, not invented zeros. Other reliable days remain clearly labeled known-day subtotals. All employee/site rows at the affected location are unranked for that selected period, including employees not named on the bad checkpoint: its real owner cannot be inferred safely. The report and exports retain the date/reason. Entirely unnamed activity remains visible as an attribution issue even when no employee rows can be formed.

Limitations: this evaluates recorded employee/site activity, not independently verified individual transactions, worked hours or complete shift coverage. An entirely unrecorded shift/day or an employee-name typo cannot always be detected from existing rows. Names retain the existing per-site, case-insensitive identity convention; employees working multiple sites remain separate rows. Sales volume remains influenced by traffic and time assigned, as inherent in the requested model. No compensation or personnel decision mechanism is added.

## Complete data reads

Only the Team Sales report uses the new complete-read path. It uses the same signed-in `daily_logs` SELECT and date/location filters, requesting an exact count and ordered pages. The offset advances by the actual response size, so a server row cap cannot silently truncate a 4,000-row request into an apparently complete report. Missing counts, failed/empty intermediate pages, duplicate IDs or changing counts prevent scoring. Late responses cannot replace a newer Team Sales request; the result scope must match the selected location set and dates. Other Reports loaders remain unchanged.

This is not a transactional database snapshot. Concurrent same-count edits across pages may still require reloading; no new RPC or backend snapshot mechanism is introduced. Existing RLS controls both returned rows and their count. Public API conventions were checked against the [select](https://supabase.com/docs/reference/javascript/select) and [range](https://supabase.com/docs/reference/javascript/range) documentation; no live database query was performed for this PR.

## UI and validation

Original Employee, Site, Memberships, Google Reviews, P-Mix and Conversion columns remain. Sortable Score and formula-qualified Rank columns are appended. Score details show the three contributions, denominators, eligibility and attribution reasons. Existing Combined/By Site display and CSV/Excel/PDF actions remain; exports include score, rank and status and follow the selected sorting. No aggregate employee score/rank is invented.

Validation: 66 relevant tests passed, including 23 new unit/component/integration cases. Coverage includes negative corrections, tier corrections, conservation, clean-day subtotals, unnamed/invalid/gapped rows, split hours and name casing, ties, zero opportunities, low samples, mixed Simple/Detailed locations, global sales versus formula conversion benchmarks, filter isolation, Google Review independence, score/rank sorting, details and exports, server-capped pagination, failed/changed reads and request races. Both production builds passed (default base and `--base=/`), with existing duplicate-title and bundle-size warnings. Tests use synthetic local fixtures and mocked transport; no live Supabase/browser certification is claimed.

Draft only. No migrations, RLS, grants, permissions, RPCs, dependencies, package/lockfile changes, production records, merge or deployment. Commit includes `[CF-Pages-Skip]` to suppress branch previews.
