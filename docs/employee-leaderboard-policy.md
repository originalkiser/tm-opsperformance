# Unified Team Member Sales — review before implementation

## Current implementation and limits

TeamSalesTable is shared by Reports and Insights. employeePerformance currently
normalizes three contributions to 100 and ranks separate Simple/Detailed cohorts.
Daily Logs contain cumulative site/day checkpoints, not employee transactions.
The existing endpoint attribution and opportunity sources must remain intact:
Simple = max(0, washes - member washes); Detailed adds memberships sold before
clamping. These legitimately different denominators now feed one leaderboard.
Google Reviews do not enter scoring. Store KPI/Budget scoring is out of scope.

There is no stable employee ID on Daily Logs. As confirmed by the user, identity
remains (site ID, trimmed case-insensitive employee name): combine repeated days
and split hours within a site, keep matching names at different sites distinct,
and always identify the site in the report. Cross-site person deduplication and
spelling aliases require reliable identity data; do not guess or change storage.
The population is named employee/site identities with recorded checkpoints in the
selected accessible sites and inclusive reporting dates, not a roster of staff
with no activity. Existing report filters define this population. Combined/By
Site layout and column sorting do not change qualification or official ranks.

Reports already verifies all pages and counts. Insights' old general-purpose
paging can silently accept truncated/failed data. Its Team Sales section must
reuse the existing complete scoped loader and reject stale responses before
showing rankings; keep all existing authorized site boundaries.

## Scoring and qualification decisions

- Sales points = total attributed memberships. Conversion points = aggregate
  sales / aggregate opportunities * 100. P-Mix points = aggregate (Better + Best)
  / aggregate sales * 100. Show rates to one decimal and add those displayed
  percentage points to integer sales, so the visible arithmetic matches Total
  Points. No weighting, normalization, caps, or scaling. Scores can exceed 100.
- Rank qualified employees with complete scoring inputs by descending Total
  Points. Equal displayed totals share competition rank (1, 1, 3). A stable site
  and name key orders ties without breaking them. All formulas share one pool.
- Let N be the named employee/site population and K = ceil(N / 2). Sort known
  totals separately for sales and opportunities. The Kth total is each cutoff;
  if fewer than K totals are known, all known totals meet that metric's cutoff.
  Include everyone tied at either cutoff (OR qualification). Missing totals are
  never numerical zeros or qualification evidence. Missing identities still
  count in N; unknown values cannot be ordered. Label this known-data limitation.
  All explicit-zero ties qualify when zero is the cutoff, including an all-zero
  population. There is no arbitrary minimum sales or traffic requirement.
- Qualification and completeness are distinct. Nonqualifiers remain visible as
  Not Qualified with no official rank. A qualifying employee with unresolved
  inputs remains visible as Qualified · Incomplete data, with no invented total
  or official rank. The requested mathematical total cannot be known in that
  case. Known individual metrics remain visible. This is not an extra sales or
  opportunities qualification threshold.
- Explicit zero sales gives zero sales, conversion (when opportunities are
  known), and P-Mix points. Known zero opportunities plus positive sales has
  undefined conversion, displayed as missing with a reason, not infinity or a
  fabricated denominator. Zero opportunities and zero sales gives zero points.
- Preserve cumulative correction attribution: a decrease marks affected prior
  contributors unresolved; do not assign a negative correction to its entering
  employee or redistribute it. For genuinely missing fields, mark that named
  employee's affected metrics unresolved. A later increase spanning a missing
  checkpoint is also unresolved for its ending employee; carrying the counter
  solely for delta bookkeeping is not evidence of zero actual activity. Missing
  shifts/days alone do not imply missing work or actual zero sales.
- Duplicate copies of an identical log ID are counted once; conflicting copies
  or duplicate site/day/time/split checkpoints make attribution ambiguous and
  cannot produce official scores. Keep raw logs immutable.
- Totals include only known attributed metrics and are labeled subtotals when
  any contributing metric is missing. Aggregate ratios are missing unless all
  their inputs are known; points and ranks are not additive report totals.

No schema, RLS, permissions, storage validation, raw Daily Log, shared site math,
Budget scoring, or package changes. Draft review only; no merge or deployment.

## Validation

- Complete automated suite: 262 passed, 0 failed.
- Both Vite production builds passed (GitHub Pages base and root base).
- Both builds retain the existing warning about chunks larger than 500 kB.
- Coverage includes points arithmetic and rounding, zero/missing values, OR
  qualification, even/odd populations and both cutoff ties, unified ranking
  ties, source formulas, corrections, duplicates, identity aggregation, period
  and site scope, sorting, aligned CSV/Excel/PDF specs, and complete-read guards
  in Reports and Insights. Existing store/Budget KPI regression tests pass.
- No live database writes or production employee data were used for validation.
