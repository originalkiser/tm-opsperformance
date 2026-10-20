# Daily Plans Lost — release held for migration approval

Feature branch is based on main `5541e39fe84ac116f1b4ec99ddb112e5acef7732`.

## Calculation and storage

Daily Log sales are cumulative snapshots, including split hours. They must never be summed across hourly rows. The new nullable `daily_logs.plans_lost_today` value belongs only to the fixed 08:00 split-0 row, uniquely identified by location/date/time/split. Its partial upsert contains no sales fields, so it cannot reset an existing Memberships Sold entry. Normal hourly upserts omit both the loss field and manual Net Members. An otherwise empty loss anchor is retained.

The latest populated cumulative membership snapshot supplies Memberships Sold; the daily calculation subtracts the loss once. Null means unknown, not zero. Explicit zero, a calculated zero, and negative net values are supported. Only nonnegative database integers are accepted as losses. Inputs save immediately through a serial queue with captured location/date. Dashboard remounts the table on a location/date change, so deferred hourly saves remain attached to the old scope. Load failures disable writes rather than treating failed reads as empty days. Save failures remain visible and can be retried by editing the input.

Daily Log totals and its image export use the calculation. Shared shop totals expose the same daily net. Network hourly views and employee rows do not attribute the daily loss to an hour or employee; Employee Rollup totals use the daily net once. No other report currently directly displays Net Members. No per-hour loss data is fabricated.

## Historical transition — intentionally not performed

The separate review-only SQL adds a metadata-default `net_members_legacy` flag: existing records receive true without UPDATE/backfill or firing audit-update triggers; new records default false. All existing days, including manually entered zero values, retain their Net Members and cannot opt into daily calculation until a separately approved transition plan. The input explains this and remains disabled; help is always available. Existing hourly manual Net Members display read-only, remain in storage, and are never included in hourly upsert payloads. Existing membership/sales data remains editable under current permissions.

The invoker trigger rejects converting a legacy/manual day, clearing/deleting a saved loss anchor, changing record identity, or writing nonzero hourly net on a calculated day. Location/day advisory locks serialize adoption with older-client writes. Existing grants, RLS policies, role helpers, views, and audit triggers are untouched. No SECURITY DEFINER function or new API grant is introduced.

## Deployment gate

`docs/sql/daily-plans-lost-REVIEW-ONLY.sql` is a separate proposal, NOT an installed migration. It is isolated in its own commit for review. Before production approval: verify the production schema and existing Daily Log SELECT/INSERT/UPDATE permissions and audit behavior in an isolated Supabase environment, package the approved SQL through the project's migration process, install it with explicit approval, and verify Admin/Store access. Only then merge/deploy application code. No production resources were queried or changed here. Existing SQL views continue to expose their historical raw net values; the app calculates daily net through the shared utility. Any external consumer of raw net_members needs an explicitly approved transition before using the new model.

Cloudflare branch preview suppression uses `[CF-Pages-Skip]` on both commits. GitHub Pages only builds pushes to main. Do not merge this draft PR before the migration is approved and installed.

## Validation

- Automated suite: 141 tests, including seven focused membership/input tests.
- Both production builds: default GitHub Pages base and `--base=/`. Existing duplicate-title and bundle-size warnings remain.
- Temporary local Postgres (PGlite): review SQL installation, historical preservation, zero/edit, invalid and misplaced losses, protected anchor, old-client hourly writes, legacy-zero protection. No live Supabase installation or production access test was performed.
- Actual DailyLogTable, input and EmployeeSummary in isolated Microsoft Edge at 1280×900 and 390×844 with an in-memory backend and external requests blocked: immediate recalculation, negative/zero, blank hourly net, saving/editing/reopening, date/site switching, unknown data, exact help text, native dialog Escape/focus. Screens visually inspected. These mocks validate client behavior, not production RLS.
