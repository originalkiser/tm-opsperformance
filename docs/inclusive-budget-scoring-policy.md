# Inclusive monthly KPI scoring — policy review before implementation

This review was recorded before editing scoring code. It supersedes the
completeness gates in `budget-seven-category-scoring.md` and
`site-performance-budget-scoring.md`; it does not change entry validation,
source storage, targets, access, or the seven scoring formulas/weights.

## Existing behavior and conflicts

- `scoreBudgetLocations` selects only the exact reporting-date entry, requires
  all performance fields and verified complete revenue, excludes every failing
  location from the competitive pool, then withholds all official scores when
  either a category or a second complete competitor is missing.
- The two relative categories average occupied tie positions among valid values.
  All-equal valid values receive half points, including explicitly reported zero.
  Missing values are different: they must receive zero scoring points, not be
  inserted as numeric zeros into the valid-value ranking distribution.
- `calculateMtdRevenue` already respects the verified October baseline and
  excludes overlapping earlier daily entries. `revenuePresentation` selects one
  authoritative complete/verified-baseline/historical-cumulative source; partial
  daily subtotals never replace or get added to a cumulative fallback. Preserve
  that precedence. A provisional source can support scoring without becoming
  verified actual revenue. If no supported MTD revenue source exists, its two
  scoring categories receive zero, even if an incomplete daily subtotal exists.
- The displayed revenue pace helpers currently use the source's older reporting
  date. Scored report rows must instead use the selected reporting cutoff for
  expected revenue and growth, while retaining the source's actual coverage date.
- Incomplete reporting is not a separate weighted category. Without changing the
  approved formulas, staleness alone cannot guarantee a lower score: ratios and
  rating may remain strong, and a later cumulative snapshot can legitimately
  cover earlier gaps. No arbitrary age multiplier or missing-day penalty will be
  added. Known cumulative activity is not increased for missing days, and the
  selected cutoff continues advancing revenue/growth expectations.

## Intended scoring decisions

1. Eligibility stays Budget-enabled and not excluded from reporting, within the
   existing authorized reporting pool. Every eligible row receives an official
   one-decimal score from 0 to 100 and a competition rank (1, 2, 2, 4).
2. Take each category's latest usable, unambiguous in-month snapshot at or before
   the selected morning reporting date. Never sum cumulative snapshots or use a
   future/previous-month entry. Validate categories independently: valid washes
   do not require a rating or membership-tier fields; P-Mix requires the tiers;
   conversion requires valid washes, redemptions and tiers.
3. Unsupported categories contribute zero points, without rescaling supported
   weights. Keep availability/reasons separate from those numeric zero points.
   Missing/zero targets still cannot be divided by; negative growth earns zero.
4. Use the existing selected revenue presentation as the scoring numerator, with
   an explicit provisional/source/coverage label. Keep verified actual revenue
   null when coverage is incomplete. Never combine historical cumulative revenue
   with a verified baseline or a partial daily subtotal.
5. Pass every eligible site into each competitive-category evaluation. Missing
   metric values receive zero points; valid-value occupied-position/tie formulas
   remain unchanged. With fewer than two valid values, all sites receive zero
   points for that category, and other categories still contribute normally.
6. A verified monthly revenue baseline is usable data even without a daily entry.
   Targets alone are not activity. A site with no supported monthly input scores
   zero. Explicit reported zeros remain valid inputs and retain the established
   valid-value tie rules; they are not the same as no data.
7. On the first morning of a month, no business day has completed: all monthly
   scores are zero and ranked, without carrying previous-month data forward.
8. Duplicate dates are ambiguous and must not win by array order. Skip those
   dates for snapshot selection, flag the condition, and use an earlier usable
   date if available. Duplicate/invalid revenue sources must not crash every
   site's score; flag the affected site's revenue unavailable. Never fix stored
   records or relax data-entry validation.
9. Show reporting completeness, last-entry date, per-category supporting dates,
   and missing/incomplete reporting dates independently of official score/rank.
   Display-only filters must not shrink the scoring pool or recompute ranks.

## Dashboard data boundary

The current Today/MTD Dashboard tables do not have Score/Rank columns. Store
companywide reporting uses `dashboard_mtd_performance`, which deliberately exposes
only performance counts, not revenue, targets, baseline, membership, or rating
inputs. Reports' existing `useBudgetReport` path has full inputs only for its
existing authorized pool. These are not interchangeable datasets. An inaccessible
site cannot be classified as having zero activity.

Dashboard scope was raised with the user before implementation. No new
companywide scoring query, permission/RLS change, migration, or raw-table fallback
will be introduced in this PR. The release description will explicitly record
any remaining companywide Dashboard limitation.
