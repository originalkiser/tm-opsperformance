# Admin starting balances and dated reported-MTD fallback

The standalone **Admin starting balances** panel in Budget Tracking saves verified October balances independently of all daily-entry fields. It remains available even if daily-report loading fails. Managers cannot access it, and existing database RLS restricts starting-balance writes to Admins.

Admins select a valid October business cutoff no later than the site's last completed business day. The verified amount replaces every daily contribution on/before the cutoff; original entries remain untouched. Amount/cutoff changes recalculate MTD and preserve old/new amount, cutoff, source, actor and timestamp in the existing immutable audit trail. November resets to daily summation.

When daily records are incomplete:

- Without an active verified balance, show the latest valid reported cumulative MTD for the selected site/month/as-of date. Label the amount, Revenue % and Revenue Pace **Provisional** and show its business coverage date.
- With an active verified balance, that balance has priority. Use its verified amount through its cutoff as the dated provisional figure; never combine it with overlapping reported MTD or a partial daily subtotal.
- Pace uses the displayed cumulative figure's reporting date (business coverage date + one day), not today's missing days. Complete automatic totals regain priority when required daily records exist.
- Missing-day warnings remain visible. With no valid dated cumulative source, revenue and pace remain unavailable. Existing daily Cash calculations and numeric credit-card saving are unchanged.

This implements all seven requested release requirements. The newer provisional-reporting requirements supersede the earlier rule that historical reported figures were reference-only. No partial/incomplete daily sum drives pace.

## Validation

36 automated tests passed, including independent panel/Manager exclusion, dated provisional rendering, reporting-date pace, overlap precedence, changed cutoffs, corrections, missing days, zero values, invalid latest reports and month transitions. Both production builds passed; pre-existing duplicate-title/large-bundle notices remain.

The actual standalone panel/editor and reporting components were exercised with fictional local transport that refuses unrelated daily-data queries. A verified save succeeded without daily-entry fields, updated amount/Revenue %/pace, removed overlapping historical fallback and displayed the audit entry. Editable-cutoff preview tests covered backward/forward dates, covered/uncovered corrections and future-save blocking. These were actual component tests, not authenticated Supabase browser saves.

The exact migration17 body passed rollback-only SQL tests in tm-ops-dev: Admin corrections/audit, future/out-of-month rejection, actor stamping, Manager/anonymous denial, immutable audit, unchanged daily/history fingerprints and unchanged policies/grants. All test schema/data changes rolled back.

## Deployment after separate approval

1. Refresh main and verify migration17 is unused. Read-only production backup/schema/timezone checks; preserve existing balances, daily/history and audit rows.
2. Apply migration17 once. It changes only the month-range cutoff constraint and existing stamp trigger's site-local completed-day validation. Existing RLS, function security mode/search path/grants and audit mechanism remain unchanged. No earlier migration is rerun.
3. Merge/deploy the reviewed application only after authorization. Pause Admin balance edits during the schema/UI handoff and reload all clients; old fixed-cutoff clients cannot safely interpret arbitrary cutoffs.
4. Verify live standalone save/audit and dated provisional reporting using owner-verified values only.

Rollback must retain daily/balance/audit data and security fixes. Do not blindly restore the fixed-date application or constraint after variable cutoffs have been used; use an approved forward fix or a separately reviewed rollback that supports the saved cutoffs.

No production migration, merge or deployment has been performed for this PR. Cloudflare preview deployment is skipped for the review commit.
