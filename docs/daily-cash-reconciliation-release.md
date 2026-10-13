# Daily Cash Reconciliation release

Read latest HANDOFF.md and CLAUDE.md. User's explicit tm-ops-dev requirement overrides their older single-production-project testing guidance. Production remains untouched. Existing security fixes and accepted exceptions are unchanged.

## Business behavior

Morning entry date maps to the prior business date. Actual counted cash is a new nullable daily-entry field; existing daily completion requirements stay unchanged. Missing count, setting or valid revenue yields neutral/unavailable reconciliation. Discrepancies do not block saves. Negative deposit availability is shown as a shortage, never forced to zero. Invalid counts (negative, fractional cents, excessive amounts) are rejected.

Currency uses integer cents. Example: $850 Cash on Hand + $119 daily cash = $969 expected; $969 count produces $119 deposit and $0 variance. Any nonzero variance is red with exact shortage/overage; exact zero is green. Inputs for calculated amounts do not exist.

Admin Cash on Hand is a separate panel in Budget Tracking reports, independent of daily form completion. Managers see applicable Cash on Hand in daily reconciliation but cannot modify settings. Initial setup can use a verified historical effective business date; subsequent versions can start only today or later in the site's timezone, and cannot precede the latest scheduled version. Versions are append-only, recording source, actor, timestamp and predecessor. Settings persist across months until a later version takes effect.

User clarified changes apply only to future entries. First submitted counts freeze the applicable dated Cash on Hand version. Later count/revenue corrections retain that snapshot. Missed-date first submissions select the version effective on that business date. Existing submissions are never retroactively rebalanced by Admin changes. Counts initially submitted without a setting remain neutral even after later settings are added; their missing setting snapshot is preserved rather than silently assigning a new float. Admin setup must precede cash submissions.

Server triggers protect original count/actor/time, edited flag and calculated snapshots from spoofing. Audit captures old/new rows for first submission, count correction, revenue correction and Admin setting changes, including business date, actor and time. No client can insert/update/delete audit records or rewrite/delete setting versions. Existing daily-row delete rights are unchanged; deleting/recreating a counted row is audited and cannot reset its original submission or float snapshot. Manager writes follow the existing location-access function; existing Budget table RLS remains unchanged.

## Validation

47 automated tests cover exact cents, shortages/overages, zero/missing/invalid amounts, saveable discrepancies, date/month transitions, historical lookup/snapshot priority, Manager exclusion from settings, and UI color/read-only calculation rendering. Existing revenue/MTD/calculator/Ownership/Copy tests remain passing.

Actual Manager and Admin components were exercised in an isolated browser with fictional transport: exact match, saved shortage, original value and Edited After Submission, count audit, Admin future setting save and historical snapshot preservation. Light/dark UI checked. This transport never connects to any database. Separate authenticated SQL tests run against tm-ops-dev using actual test account IDs and RLS, inside a transaction that rolls back all schema/data changes. Only the absent production location-access helper is provided as a temporary fixture; existing development tables/policies are retained. Tests cover settings Admin-only writes, immutable versions/audit, anonymous denial, out-of-location denial, spoof protection, exact result, corrected shortage/overage, revenue correction, missed historical dates, future changes, snapshot retention and original daily/history preservation.

## Migration and release

Migration19 is additive and rerunnable. It adds cash columns to budget_daily_entries, cash_on_hand_versions and cash_reconciliation_audit, protected triggers and new-table RLS. It does not seed production Cash on Hand, alter existing policies or rewrite existing daily/history values. Existing count-null entries receive no invented cash values. cash snapshots are frozen only on count submission, not unrelated legacy daily saves.

Before release: review PR and verify actual production schema/access helper, backup readiness and migration19 filename still unused. Owner must approve migration/merge/deployment. Apply migration19 once before merging reviewed UI. Confirm automatic GitHub Pages and Cloudflare deployments (no manual Cloudflare deployment). Verify live with owner-approved Cash on Hand values; no fictional production entries.

Initial rollout decision: Admin must supply verified amounts and initial effective dates for each site. Cash count is optional for daily save/completion during transition; incomplete reconciliation remains neutral. User explicitly confirmed blank cash counts are allowed for now; making them mandatory is deferred.

Rollback: revert UI commit only, retaining additive schema/triggers/RLS and all cash/audit data. Old clients omit the new count field and existing cash records stay intact. migration19_rollback.sql documents this non-destructive procedure. Any later schema removal requires an exported audit/archive and a separately reviewed migration, never a blanket database restore.
