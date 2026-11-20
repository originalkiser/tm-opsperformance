# DRB sales reconciliation — draft only

PR #75 remains uninstalled and undeployed. The Employee Summary checkpoint fix was released independently in PR #76 (`7f41f304`); this draft does not change Daily Logs, current rankings, qualifications, historical name mappings or opportunity calculations.

## Confirmed employee matching rules — November 20, 2026

Classify the **unaltered imported Alternate Phone string first**, then derive employee identity:

| Source format | Commission classification | Employee key |
| --- | --- | --- |
| `020000####` (10 digits) | Retained, pending Sara's completed weekly review | Last four digits |
| `20000####` (9 digits, omitted leading zero) | Same retained classification; never excluded for missing leading zero | Same last four digits |
| Exactly `####` (4 digits) | Sara-excluded commission | Same last four digits |
| Anything else, including blank/malformed values | Unresolved | No automatic key |

All identifiers stay strings. No numeric conversion, padding or rewriting is permitted. A four-digit key such as fictional `0012` retains both zeros. The original imported value remains in the immutable observation, including whitespace; an unrecognized representation is retained for review rather than silently repaired. Recognition functions agree in JavaScript and SQL. Ten-digit values with an unverified prefix do not gain eligibility merely because of their length.

The last four digits match an **approved ADP badge-to-existing-roster-UUID crosswalk**, with effective dates and site coverage. A proposal stores the exact ADP badge string and a required authoritative roster evidence/reference. Its last four digits must equal the proposed key. An authorized reviewer verifies the source and explicitly approves; proposing alone never attributes sales. Display names do not establish identity. Raw roster/source files are not automatically uploaded or turned into new employee accounts.

A key must resolve to exactly one distinct approved employee across the applicable dated crosswalk, and have approved coverage at the sale site. Cross-site collisions between different employees cannot be approved. Reports defensively leave attribution unresolved even if conflicting approved rows exist outside the application. Inactive roster records are included; no active-only filter suppresses historical matches. Reused keys can be represented through non-overlapping effective dates. Withdrawing approval invalidates affected eligible decisions and retains audit history.

## One weekly source, separate outcomes

The workflow accepts **one weekly DRB commission XLSX export**, not separate required original/reviewed imports. Required source columns remain `SITENUMBER`, `LOGDATE`, `SALEID`, `ITEM_NAME`, `CUST_ALTPHONE`, `COMMISSION`. Customer name/phone and trailing source annotations are preserved privately; source `Legal Name` does not drive attribution. General Sales aggregates and census workbooks cannot create transaction ledger entries.

Gross counts each imported transaction once, including four-digit excluded sales. Eligible, excluded and pending/unresolved commission counts partition gross. **Unresolved employee attribution is a separate, potentially overlapping count**: an excluded sale can have a matched employee, and an unmatched sale remains excluded without crediting an employee. Exclusion does not delete gross sales. Nine-digit retained IDs do not fall into the excluded bucket.

Four-digit source exclusion is computed server-side and cannot be overridden into eligibility through any RPC. No per-sale re-entry of Sara's exclusion is required; existing source notes remain available and no specific reactivation/replacement reason is invented. Other explicit decisions/reasons remain audited. Customer name/phone matches are review leads, never automatic decisions.

Retained does **not** mean commission eligible. Eligibility still requires certified transaction identity, an unambiguous approved employee, verified weekly completion and an explicit eligibility decision/activity. The batch stores nullable completion actor/time, both unset by import; no public RPC or UI can assert completion yet. This deliberately keeps all retained imports pending until Sara's identity/attestation and review-completion handling are verified. Tests simulate completion only inside a fictional disposable database. The existing conservative activity gate is not a newly approved commission policy.

The UI disables premature eligibility and exposes pending completion. The backend independently enforces the gate; client payloads cannot grant completion or write private tables. No automatic retained-to-eligible conversion, leaderboard update or payroll export is introduced.

## Idempotency and history

Batches preserve file SHA-256, server content digest, coverage, actor/time. Exact repeated imports return the existing batch without additional audit events. Matching overlapping exports add provenance, not sales. Conflicting dates/items/raw claims/amounts/customer fields/notes roll back the entire import; no silent replacement occurs. Review and mapping writes use optimistic revisions.

Site + Sale ID remains the **candidate**, not yet certified transaction identity. Multiple same-key lines are rejected rather than guessed. Conflicting revised weekly files still require explicit source resolution before import. Completion/amended-period handling is a release blocker, not an invitation to bypass the source conflict guard.

## Security and release hold

All new data remains in private RLS tables with no direct table/sequence API grants. An invoker wrapper calls fixed-action private authorization code with empty search_path. Every operation requires a current active Admin and a separate reviewer grant. Installation grants nobody, including existing Super Admins. Customer data, ADP badges, evidence references, mappings and audit remain reviewer-only. Source/customer values are not logged, stored in localStorage or reflected in arbitrary database errors.

Reviewer scope is currently global within the draft; approved site scope, customer minimization and retention/purge protections remain required before release. No new service, authentication or integration was introduced. Previous production schema/advisor access through the established connector was denied; no live production compatibility approval is claimed.

Prepared migration: `20261119162120_drb_sales_reconciliation.sql`. It has never been installed, so this update revises that draft artifact without a production migration. No production grants, schema changes, imports or deployments were made.

Remaining release blockers:

1. Certify Site + Sale ID/line identity and source completeness.
2. Verify Sara's authenticated completion/attestation, amended-period handling and eligibility activity rules before exposing any completion operation.
3. Approve the authoritative ADP-to-TM Ops UUID crosswalk (including inactive/historical dates), reviewer scope and customer-data protections; complete the authorized production preflight/advisor.
4. Resolve source formats outside the two approved retained formats or exact four-digit exclusion rule without guessing.

The older requirement for a separate original export to recover identity from shortened IDs is superseded: confirmed last-four ADP matching supports those excluded sales directly. Original files can remain audit evidence in the existing restricted workflow, but are not a second mandatory weekly import.

## Focused validation

- 36 JavaScript tests: eight reconciliation/matching cases, three workbook safety cases and 25 unchanged employee-performance/scoring cases.
- Ten actual in-memory PostgreSQL tests: zero grants/RLS and access denial, exact 10/9/4 classification, original-string preservation, idempotency/source conflicts, ADP evidence constraints, inactive/historical date-bound matches, global ambiguity, stale writes/audit, completion and exclusion bypass protection, approval withdrawal and inactive-reviewer denial.
- Actual React workflow in an isolated headless browser: single weekly source, ADP evidence proposal/approval, retained-nine-digit status, disabled premature eligibility, exclusions, customer-review leads, import preview/save, unauthorized access and mobile/desktop Light/Dark layouts. All hosted traffic blocked and fixtures fictional; no desktop/user-browser control.
- Vite build passes; inherited duplicate-title and large-bundle warnings remain.
- Existing supplied payout example: 410 transactions across 13 sites; 248 retained, 161 four-digit excluded, one unrecognized format, zero eligible before verified completion. No source identifiers/customer data printed or uploaded.

Commands: `node --test app/tests/drbReconciliation.test.js app/tests/drbWorkbook.test.js app/tests/employeePerformance.test.js`; `PGLITE_MODULE=<existing module> node --test scripts/tests/drb-reconciliation-sql.test.mjs`; existing loopback Vite/browser workflow with `PLAYWRIGHT_MODULE=<existing module> node scripts/tests/drb-reconciliation-browser.mjs`. Opt-in local sample check: `DRB_WEEKLY_FILE=<source> DRB_START=<date> DRB_END=<date> node scripts/tests/drb-example-compatibility.mjs`.

Recovery if later authorized: disable the new RPC and revert the frontend through the normal pipeline, preserving private observations/audit. Do not drop imported history or rebuild production from the incomplete repository schema. Before any release, confirm recovery point and exact schema compatibility through existing authorized access; no new CLI login is required or authorized here.
