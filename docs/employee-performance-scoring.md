# Employee Performance Score — Team Sales

The score uses existing employee/site Daily Log totals and Reports filters. This correction changes only Team Sales; Site Performance, Budget Tracking and shared `logMath` remain unchanged.

## Scoring

- Membership sales: 33.33 × employee sales / highest known employee/site sales in the selected filters.
- Conversion: 33.33 × employee conversion / highest known conversion within the same Simple or Detailed formula cohort.
- P-Mix: 33.34 × (Better + Best) / membership sales, against 100%.
- Zero sales benchmarks give zero sales points; zero opportunities give zero conversion points; no memberships give zero P-Mix points. Entirely zero-activity employees receive zero scores and ranks.
- Contributions are rounded to two decimals and added. Equal displayed scores share competition ranks (1, 1, 3).
- No minimum opportunities, sales, workdays or hours. Missing shifts and hourly checkpoints are normal and do not disqualify employees. Google Reviews are informational only.

Simple opportunities remain max(0, washes minus member washes). Detailed opportunities remain max(0, washes minus member washes plus membership sales). Conversion benchmarks and ranks remain separate by formula. Sales uses the highest known employee/site total across the selected filters. Combined/By Site mode does not recompute rankings; changing report filters does. An unknown opportunity formula remains unranked.

## Attribution and corrections

Daily Logs are cumulative shop checkpoints, not employee transactions. Team Sales continues using `employeeDeltasByDay`, assigning increases to the employee on the ending checkpoint. No attendance or hourly coverage requirement is inferred. Absent numeric fields carry the previous counter; an explicit zero remains a real value. Unnamed activity is noted and remains unattributed, without withholding named employees' scores.

To prevent the shared helper's clipped negative deltas from inflating Team Sales, the selector tracks prior positive contributors separately for each cumulative counter. A decrease makes only those contributors' affected metrics unresolved. It does not charge the correction to its entering employee or redistribute it. Later employees' increases from the corrected baseline remain attributed normally. A Basic correction, for example, does not withhold scores from employees who contributed only Best sales. Invalid numeric counts flag their named employee's affected metric instead of becoming a valid zero reset.

Unresolved membership tiers make that employee's membership total and P-Mix unavailable; unresolved wash counters make opportunities unavailable. Their overall score/rank is withheld rather than guessed. Other employees at the same site/day or elsewhere in the period remain scored. Affected employee/site metrics stay unresolved for the selected period because exact period totals cannot be established. Known figures and correction notes remain visible. Aggregate ratios are unavailable when their inputs are unresolved; subtotals are labeled as known attributed figures. No entire site-day is excluded.

Limitations: existing ending-checkpoint/name attribution does not independently prove individual transactions or hours worked. Names are matched per site, case-insensitively; employees at multiple sites remain separate rows. Sales volume reflects recorded traffic and assignment time. A genuinely ambiguous correction still requires attribution evidence to resolve; this frontend does not invent an owner.

## UI and validation

Existing informational columns, sortable Score/Rank, three-part breakdowns, Combined/By Site mode and CSV/Excel/PDF exports remain. The complete, scoped Team Sales read and late-response guards remain unchanged: a failed network read differs from a normally missing shift.

Validation: 71 relevant tests passed, including 28 employee scoring/component/loader cases. Coverage includes partial-period attendance, missing hours, agreement with existing employee deltas, zero activity, corrections, conservation, mixed formula groups, ties, monotonic scores, reviews independence, filtering, sorting, breakdowns and exports. Both production builds passed (default base and `--base=/`), with existing duplicate-title and bundle-size warnings.

No backend, schema, RLS, permissions, RPC, package or lockfile changes. Draft only; no merge or deployment. `[CF-Pages-Skip]` suppresses Cloudflare branch previews.
