# Daily Log toolbar revenue goal

Add a read-only Daily Revenue Goal at the far right of the existing Daily Log toolbar. Existing action buttons remain left-aligned. The goal wraps cleanly below them on narrow screens and uses existing TM Ops Light/Dark classes. No hourly columns, employee inputs, Copy/Paste behavior or calculations change.

Source: the Excel-imported `budget_daily_revenue_goals.total_revenue_goal`, selected by the current `location_id` and exact selected `business_date`. This uses the existing table and authenticated/RLS client, with no writes, new storage, import process or permission changes. The Budget MTD reader remains unchanged; its prior-day/morning-date semantics are intentionally not used for this Daily Log read.

Currency uses the existing dollar formatter. Zero displays as $0.00; a missing, inaccessible or invalid target displays No Daily Goal Set. Location/date changes request the corresponding target, suppress prior-scope values and ignore late responses/unmounted requests. No monthly distribution or fallback estimate is used.

Validation: 43 focused checks passed, including exact-date lookup, historical/first-of-month dates, zero versus missing targets, query errors, read-only display, stale-response isolation, date/site changes, toolbar placement and existing employee/site-switch behavior. The existing site-switch test harness needed its missing Wash Overrides helper binding; no save-hook change was made. Both production-base builds passed. An offline fictional-data fixture visually verified desktop/mobile wrapping in Light and Dark modes; no live API or database was used for that check.

No database migration is required. Prepared locally only; no push, merge or deployment. Separate release authorization is required.
