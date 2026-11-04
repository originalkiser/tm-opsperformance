# November budget integration — verified membership review

Branch: `codex/november-budget-mtd`. Preparation and isolated tests only.
Only local preparation and isolated PostgreSQL tests were run. No production
connection, production SQL, migration, import, merge, deployment or commit occurred. Workbook, membership values and generated private
artifacts must not enter the public repository.

## Final scope

The reviewed change remains limited to November revenue/labor/membership targets,
manual cumulative MTD revenue, corresponding daily goals, month boundaries, and
associated tests/import/rollback preparation. No import dashboard, extra membership
system, infrastructure, dependency change, or unrelated authorization change.

The migration adds one daily revenue-goal table and one nullable labor-percentage
column. It has no operational DML, changes no existing membership/actual/target
values, and leaves existing grants/policies/helpers intact. Only the new table's
access is configured directly in the original migration: active Admin and Store
accounts can SELECT goals for all Budget-enabled, non-excluded locations; legacy
area managers retain assigned-location scope through the existing location helper.
Anonymous, inactive and deleted accounts are denied. Client writes stay denied.
There is only one CREATE POLICY block, with no original-then-corrective migration. Numeric amounts are unconstrained; PostgREST
text casts preserve original decimals without another view or RPC.

The daily table's only foreign key is to locations, so 600 daily budgets do not
require all monthly target rows to exist. The planned complete import now includes
all twenty monthly targets in one transaction; no staged/repeated imports are
needed. Scoring weights/ranking rules and actual-record permissions are unchanged.

## Authoritative membership source

The user supplied Sara's official October Ending Members as the verified November
1 opening balances for all twenty live sites. October Starting Members and recent
November snapshots are not used as opening balances. The source gap is resolved.
Actual values, the six approved old-to-new corrections, and the network controls
are held in the private baseline JSON and preview, outside this repository.

- All existing selected November starting counts are replaced by the official
  balances, including any differences. Daily growth is set to 2 and EOM goal to
  opening +60 for every site. There is no old-value or six-correction whitelist.
- The reviewed ten-existing/ten-missing row inventory is still guarded. Changed
  inventory, ambiguous mappings or missing/disabled locations stop the operation.
  Locks prevent concurrent target/goal changes during capture and import.
- Membership/revenue/labor differences are intentional replacements under the
  user's final business rules. All unrelated existing fields remain protected by
  post-write comparison with the locked before-image. Unknown balances are never
  defaulted to zero; the final manual bundle supplies verified balances for all 20.

No new schema migration is needed for membership. Existing membership fields are
reused. Ratings, other unrelated fields, other months and all actuals are preserved.

## Confirmed labor methods

The eighteen Express sites use weekly hours excluding the salaried manager; the
inclusive total adds 45 manager hours. The workbook's percentage targets govern
1508 and 1511. Non-null percentage selects that method, and existing NOT NULL zero
hour placeholders are displayed as not applicable. No labor clarification remains.

## Private import preparation

```sh
python3 scripts/prepare_november_import.py /private/workbook.xlsx /private/review \
  --expected-total APPROVED_REVENUE_TOTAL \
  --baselines /private/verified-opening-balances.json \
  --expected-starting-members APPROVED_STARTING_TOTAL \
  --expected-eom-members APPROVED_EOM_TOTAL
```

Baseline JSON entries have `starting_members`, `verified: true`, and `evidence`.
Old-count/replacement flags are no longer required or used. Official balances
replace current selected November membership fields. No private baseline values
are embedded in repository source/tests.

The generator has no database connection and writes owner-only source previews
and review SQL outside the repository. It checks complete network controls. Its
review template remains blocked/rolled back by default for offline tests.

The final manual SQL Editor bundle is a separate private execution package. Its
schema file is an exact copy of the reviewed migration. Its import file is already
enabled and ends in COMMIT: no SQL editing is needed once final execution approval
is given. Preparing that file does not execute it or authorize execution.

Within one locked transaction, the import guards source coverage/row inventory,
captures all selected current November rows, upserts 600 daily goals, updates ten
existing monthly targets and inserts ten missing ones with explicit verified
membership fields. It reuses edit_audit_log for exact old/new monthly values and
source evidence. It asserts per-site goals, network controls and unrelated-field
preservation before commit, returning private before/after snapshots.

## Manual SQL Editor sequence and expected results

1. Confirm Dashboard project `qbdvixxooofdlfurcpqy`, the authorized postgres role,
   reviewed checksums and a recent recoverable backup. Run
   `00-before-schema-READ-ONLY.sql`: expected role postgres, both absence flags true.
   If either object exists unexpectedly, stop rather than rerunning the migration.
2. After explicit approval, paste `01-schema-migration.sql` once. It is byte-for-byte
   the reviewed migration with corrected companywide read policy; do not run an
   original policy or corrective migration separately.
3. Run `02-schema-verification-READ-ONLY.sql`: all boolean checks true, daily row
   count 0, non-null percentage row count 0. Review PK/FK/check definitions and
   the single SELECT policy. Existing values/functions/grants remain unchanged.
4. Run `03-preview-and-backup-READ-ONLY.sql` and save its complete private JSON
   result before import. Expected inventory_matches true, 20 preview rows,
   10 planned updates, 10 planned inserts, 10 monthly before-images and no prior
   daily rows for the first import. Current goal differences are shown and are
   authorized replacements. A changed row inventory/mapping requires review.
5. After final import approval, paste `04-november-import.sql` once. It commits
   the full operation and checks the inventory again under locks. Save its final
   result with locked before/after snapshots. No actual records or other months
   are written. Audit entries cover changed/new monthly targets.
6. Run `05-import-verification-READ-ONLY.sql`: passed true, 600 daily rows,
   20 sites, 20 monthly rows, official network controls, zero daily/monthly
   mismatches. Retain the snapshot and audit trail for rollback.
7. Stop. Merge and application deployment remain separately unauthorized.

Every error or unexpected verification result is a stop condition. If a transaction
is left aborted, issue ROLLBACK to clear it, inspect state, and do not retry blindly.

## Rollback

Transaction errors roll back all changes; inspect state before any retry. The
prepared import defaults to rollback even with its approval gate enabled.
For application rollback, revert the dependent frontend while retaining additive
schema/data. For a data correction, prepare a separate guarded inverse from the
saved before/after snapshot: restore only changed November revenue/labor/membership
fields and timestamp, delete new monthly rows only if unchanged since import,
and restore/remove only the imported daily rows. Detect intervening edits first,
preserve actuals, and append correction audit records rather than deleting history.

`docs/sql/november-budget-schema-ROLLBACK-REVIEW-ONLY.sql` removes only the schema
additions without CASCADE and refuses while they contain budget data. Export and
review dependencies/data rollback before considering schema removal.

## Validation

- Application: 376 tests and production build rerun successfully after the final
  migration policy update. No new application dependency or lockfile change.
- Five Python tests cover verified authoritative inputs, replacements without
  old-count flags, source controls and complete membership network controls.
- Twelve in-memory PostgreSQL import/migration tests use fictional data: RLS/grants, precision/keys,
  one-transaction import, authoritative replacements, unexpected row-inventory drift,
  rollback on bad controls or unrelated-field changes, ambiguous mappings and
  audit behavior.
- A separate final-migration authorization regression passed 38 assertions. It
  applies the migration directly, never the old policy followed by a patch.
  Admin/Store read all 600 eligible goals; client writes are denied; active
  assigned-site actual entry/corrections work; unassigned actual access is denied.
  It also tests anonymous, inactive/deleted Admin and Store, unknown/no-profile
  and signed-out denial, excluded/disabled sites, legacy manager scope, and
  unchanged existing operational policies, grants and function definitions.
- A separate private rehearsal executed all six ready-to-paste SQL files in
  memory, using official source values and deliberately different synthetic prior
  targets. Schema checks, captured before-images, full import, final controls,
  actual/unrelated-field preservation and repeat-run refusal passed. It is not
  a production run.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_*.py'
PYTHONDONTWRITEBYTECODE=1 PGLITE_MODULE=/tmp/tm-nov-sql-test/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/tests/november-sql.test.mjs scripts/tests/november-goal-access.test.mjs
```

The external test engine is pinned `@electric-sql/pglite@0.5.15`; it is not an
application dependency. Production execution remains subject to explicit approval.

## Files in the development change

- `app/src/components/BudgetRevenueFields.jsx`
- `app/src/components/BudgetRevenueNotes.jsx`
- `app/src/components/BudgetRevenueSummary.jsx`
- `app/src/components/BudgetTargetsTable.jsx`
- `app/src/components/BudgetTrackingReport.jsx`
- `app/src/components/BudgetTrackingSection.jsx`
- `app/src/components/SiteMetricTable.jsx`
- `app/src/components/SitePerformanceReport.jsx`
- `app/src/hooks/useBudgetDailyEntry.js`
- `app/src/hooks/useBudgetReport.js`
- `app/src/utils/budgetDailyFields.js`
- `app/src/utils/budgetDisplay.js`
- `app/src/utils/budgetMath.js`
- `app/src/utils/budgetReportRows.js`
- `app/src/utils/budgetRevenue.js`
- `app/src/utils/budgetRevenueReporting.js`
- `app/src/utils/budgetScoring.js`
- `app/src/utils/dailyRevenueGoals.js`
- `app/src/utils/laborBudget.js`
- `app/supabase/migrations/20261103203908_november_daily_revenue_goals.sql`
- `app/tests/budgetRevenue.test.js`
- `app/tests/novemberBudget.test.js`
- `app/tests/siteEntryLocationSwitch.test.js`
- `app/tests/sitePerformanceScoring.test.js`
- `docs/november-budget-development.md`
- `docs/sql/november-budget-schema-ROLLBACK-REVIEW-ONLY.sql`
- `scripts/prepare_november_import.py`
- `scripts/preview_november_budget.py`
- `scripts/sql/november_budget_import.sql`
- `scripts/tests/november-sql.test.mjs`
- `scripts/tests/november-goal-access.test.mjs`
- `scripts/tests/november_sql_fixture.py`
- `scripts/tests/test_november_import.py`
