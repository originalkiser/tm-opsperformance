# Monthly budget import — development review

Branch: `codex/monthly-budget-import`, based on deployed main `75990a5`.
No production migration/import, commit, merge or deployment is part of this work.

## Workflow

AM Entry → Budget Targets → Admin-only **Import Monthly Budget**, beside month
controls. Choose Finance's `.xlsx`, inspect detected month/sites, existing and
proposed revenue/labor, first-day membership counts, and EOM goals. Missing
membership counts may remain blank. Explicitly confirm replacements and import.
The modal refreshes the existing targets/audit UI after success. It stores no file
and adds no dashboard, upload service, history screen or table.

The XLSX parser adapts `scripts/preview_november_budget.py`'s three-block layout,
site/day/network controls, category reconciliation tolerance (0.000001), and labor
validation. Raw worksheet XML values remain decimal strings, normalized without
binary floating-point conversion; sums use scaled BigInt. Monthly controls and
all 28–31 dates are validated, including leap years and the Excel 1904 date system.
Missing formula caches, invalid/negative budgets, duplicate sites/dates, missing
controls, mismatched revenue/labor site sets, and incompatible labor methods stop
preview. Only Finance's existing layout is supported (one `* Plan` sheet, first
business-date header C3, total/retail/recurring blocks, and `Labor and Membership
Goals`). Files are limited to 10 MB. Formula caches must be recalculated in Excel.

`jszip@3.10.1` and `saxes@5.0.1` already existed transitively through ExcelJS;
they are now explicit pinned dependencies. The parser is loaded on demand.

## Membership

For budget month YYYY-MM-01, only `budget_daily_entries.entry_date = YYYY-MM-01`
is consulted. Its `mtd_membership_actual` is the previous business month's closing
balance. Earlier/later entries are never substituted. Zero is valid; missing/null
is unknown. An invalid first-day count requires correction/verification before
preview. Admin can approve a supplied opening value in the preview.

New targets default to growth 2. Existing targets retain their daily growth setting.
EOM uses the existing calculation: round(opening + growth × calendar days). Missing
openings explicitly save NULL for both starting_members and membership_goal;
revenue/labor remain complete and usable. Existing approved membership fields are
retained unless Admin selects **Explicitly replace approved membership**. First-day
source edits never silently revise saved baselines; source differences are warned.
An existing nonzero EOM goal without an opening is also protected as legacy data.
A legacy default-zero goal with no opening is unresolved, not an approved baseline.

Pending targets display **Membership baseline pending**. Growth is null/unavailable,
not a measured zero achievement or bonus. Existing fixed weights, supported-category
score totals (no reweighting), competitive pools and tie rules are preserved. A
pending growth category adds no points to that established total and is explicitly
labeled Pending. Other missing-data behavior is unchanged. Target editing preserves
NULL and exact imported numeric strings, and confirms replacement of a saved opening.

## Database change

`app/supabase/migrations/20261104210922_monthly_budget_import.sql`:

- Drops only `membership_goal`'s NOT NULL constraint. Existing values/defaults stay.
- Adds one function `public.import_monthly_budget(date,jsonb,boolean,text)`.
- Default mode previews; confirmed mode validates and commits atomically as one RPC.
- Checks `auth.uid()` against active/non-deleted Admin profile on every call.
- Narrow SECURITY DEFINER function, trusted owner postgres, empty search_path,
  qualified object references, PUBLIC/anon execution revoked. Authenticated callers
  can invoke it, but Store/manager/inactive/deleted/no-profile users are rejected.
- No existing policies, helpers, operational grants or direct daily-goal client
  write access change. Preview returns only Admin budget data and first-day counts.
- Short transaction locks prevent concurrent changes during snapshot/import. An
  opaque fingerprint binds existing full targets, daily goals, mapping IDs, exact
  first-day source state, the complete computed plan and submitted proposal/override
  decisions. All must still match when confirmed. Any drift stops import.
- Validates eligible unique numeric-prefix site mappings, selected month only,
  complete unique days, exact decimals, reconciliation, and approved labor methods.
- Upserts daily/monthly targets, updates only import-owned target fields, and audits
  exact old/new monthly and daily values in existing edit_audit_log. Actual entries,
  other months, ratings and unrelated target fields are preserved. Any SQL error,
  including an audit failure, rolls back the whole call. Identical reimports do
  not alter timestamps or append audit records. Double-clicks are guarded in UI.

Checking the existing approval checkbox refreshes the read-only preview token for
the exact final membership choices. It refuses changed database state rather than
silently approving it. Editing choices clears approval; Confirm submits exactly
the reviewed proposal. No extra button or import step is added.

The fingerprint is a conflict token, not authentication. All validation and Admin
checks run server-side regardless of client input. No privileged browser credentials.

## Review and deployment sequence

1. Review migration/function, NULL-handling changes and tests. Production schema
   metadata supplied during November verification remains the compatibility basis;
   no fresh production connector attempts are made.
2. Validate in an isolated database with fictional data. Confirm the actual
   production column/constraint/function contract before separately approved SQL.
3. After explicit production authorization and backup/preflight checks, apply only
   this new migration. Do not rerun November's migration or import.
4. Deploy the reviewed client through the established GitHub workflow after separate
   release approval. Smoke-test Admin preview/confirmation and Store denial using
   approved non-production data first; do not create test production imports.

Rollback: disable/revert import UI while retaining NULL-safe reporting if any pending
rows exist. The guarded `docs/sql/monthly-budget-import-ROLLBACK-REVIEW-ONLY.sql`
refuses to restore NOT NULL while pending goals exist. Never fill unknowns with zero.
Imported budget corrections require a separately reviewed inverse using audit
before/after values and checks for later edits. Preserve actuals and audit history.

## Local validation commands

```sh
cd app
npm test
npm run build
cd ..
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_*.py'
PGLITE_MODULE=/tmp/tm-nov-sql-test/node_modules/@electric-sql/pglite/dist/index.js \
  node --test scripts/tests/*sql.test.mjs scripts/tests/november-goal-access.test.mjs
```

SQL tests use an external pinned PGlite 0.5.15 installation and fictional data.
No private workbook, membership data, SQL execution results or exports belong in git.

If a network response is lost after confirmation, completion may be unknown. Reopen
the workbook and inspect a fresh preview; never automatically retry. An identical
reimport is a no-op, and the old fingerprint cannot overwrite changed state.

Security boundary follows [Supabase function guidance](https://supabase.com/docs/guides/database/functions).

## Feature files changed

- `app/package-lock.json`
- `app/package.json`
- `app/src/components/BudgetScoreDetails.jsx`
- `app/src/components/BudgetTargetsTable.jsx`
- `app/src/components/BudgetTrackingReport.jsx`
- `app/src/components/BudgetTrackingSection.jsx`
- `app/src/components/SetTargetsModal.jsx`
- `app/src/utils/budgetMath.js`
- `app/src/utils/budgetScoring.js`
- `app/src/components/MonthlyBudgetImport.jsx`
- `app/src/utils/monthlyBudgetWorkbook.js`
- `app/supabase/migrations/20261104210922_monthly_budget_import.sql`
- `app/tests/monthlyBudgetImport.test.js`
- `app/tests/monthlyBudgetImportUi.test.js`
- `scripts/tests/monthly-budget-sql.test.mjs`
- `docs/monthly-budget-import.md`
- `docs/sql/monthly-budget-import-ROLLBACK-REVIEW-ONLY.sql`

## Completed development verification

- 389 application tests passed (including 13 new parser/UI/membership tests).
- 21 isolated SQL/authorization tests passed (eight new monthly import tests plus
  the existing November/security regression suites).
- Five Python preparation tests passed.
- Production build and git diff checks passed. Existing unrelated Admin JSX and
  large-bundle warnings remain.
- All 1,800 daily decimal values from the private November source match the original
  reference parser; 20 sites, 600 records, exact network total reconciled. No source
  values or workbook were added to test fixtures or repository artifacts.
- 17 feature files reviewed; no credential-pattern matches/private execution
  artifacts in that scope, no staged files or commits, and no production access.
