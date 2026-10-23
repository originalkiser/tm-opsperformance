# Seven-category Budget Tracking scoring

> Scoring policy update: the completeness/withheld-score rules below are historical.
> See [Inclusive monthly scoring](inclusive-budget-scoring-policy.md) for the current draft policy: all eligible sites receive a numeric score and rank, with zero points for unsupported categories.

Approved weights: MTD conversion 20, MTD total revenue 20, MTD P-Mix 10,
MTD total washes 10, revenue to plan 15, net membership growth 15, rating 10.
Every component is capped; the total cannot exceed 100.

## Inputs and dates

All official categories use the same morning reporting date and prior business-day
cutoff. Only Budget-enabled, non-excluded locations with a unique complete daily
report, valid scoring inputs/targets and complete daily/verified-balance revenue
qualify for the competitive pool. Both volume categories use exactly that pool.
The existing revenue and starting-balance calculations remain unchanged.
October balances never cross into November. On the first of a month, there are
no completed days of that month and no official score is issued.

Conversion and P-Mix use existing site green thresholds (conv_yellow and
pmix_green), defaulting to 10% and 60%. Proportional target achievement is capped
at each weight. Conversion with no retail opportunities is unavailable; explicitly
entered zero plan sales earn zero P-Mix points. Missing values are never zero.

Revenue to plan uses the monthly goal prorated through the same completed
business-day cutoff and rounded to cents. Membership growth uses current total
members minus month-start members, divided by daily growth target times completed
days. Negative net growth earns zero. Missing or zero expected growth yields an
unavailable component and no official score/rank, with an explicit explanation.
Rating uses current rating / target rating; values must be within 0–5 and the
target must be positive. Targets and membership baselines are read, never changed.

## Competitive points and ranks

Sort each volume metric descending. With N eligible locations, competitive points
are `weight * (N - averageOccupiedRank) / (N - 1)`, using one-based rank positions.
Ties average their occupied positions and share points. Thus tied leaders or tied
last places may receive intermediate points; unique highest/lowest receive full/zero.
All equal receives half points. A single eligible site receives no official volume
score or final rank. Final scores round to one decimal and final ties use standard
competition ranks (1,2,2,4); alphabetic ordering within ties does not change rank.

## Incomplete reporting

Incomplete, stale, missing or provisional data cannot receive an official score or
rank. Where valid common-date components exist, show their subtotal as a
**Provisional preview**, with its available maximum; never normalize it to 100.
Do not competitively score provisional revenue, or use stale inputs to fill current
categories. A collapsed Score details control explains missing data and each
component. Reporting completeness (saved entry, MTD counts and revenue coverage)
is tracked separately from performance and category availability.
All eligible locations remain in the table, including **Unranked** sites. The
report reloads source data every 60 seconds while visible and when returning to
the tab, so other users' submissions/corrections recompute scores automatically.
This uses read-only queries and requires no realtime database configuration.

## Release and rollback

Client-only change; no migration, database writes or permission changes.
Automated tests cover occupied-rank ties, caps, missing versus zero, negative and
zero expected growth, stale/duplicate/invalid inputs, provisional sources, month
transitions, cutoff overlap, missing days and corrections. UI tests cover official
versus provisional displays and collapsed details. Both hosting base paths build.
Release requires user approval; merge only the reviewed client changes. Rollback
would revert the scoring release commit and let the existing integrations rebuild;
no database rollback is needed. Private site comparisons stay outside this public
repository.
