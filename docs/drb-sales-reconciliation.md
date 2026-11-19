# DRB employee sales reconciliation — draft release

Status: importer implementation and migration remain draft. The checkpoint fix was independently released through PR #76 (`7f41f304`). See [exact missing source evidence and proposed protections](drb-sales-evidence-needed.md). Do not merge/install/release until the identity, source coverage and customer-data decisions below are resolved. No production records or permissions have been changed.

## Included

- Independently released in PR #76: Employee Summary now passes **all** cumulative checkpoints to `employeeDeltasByDay`, exactly as required for unnamed checkpoints. Unnamed activity is not reassigned to the next named employee. No leaderboard, attribution mapping, qualification or opportunity formulas changed.
- Reports → DRB Sales Reconciliation: original transaction XLSX and separately reviewed commission XLSX, values-only validation, preview, import, employee identifier proposal/approval, individual review, customer-match leads, and audit history.
- Location and employee comparisons show attributed manager-reported sales alongside Gross Membership Sales, Verified Commission-Eligible Sales, Excluded Sales and Unresolved Sales. Reviewed-only records are visibly separate and excluded from gross totals until original evidence exists.
- Existing Daily Log and Team Sales functions remain the calculation source. POS UUIDs bridge to Daily Log employees **only** through approved historical-name mappings. Equal display names, suffixes and census badge padding never establish identity.
- No imported counts feed the leaderboard, payroll, opportunities or source Daily Logs. Micrologic and kiosk opportunity attribution remain later work.

## Import contract and conservative review

Supported columns: `SITENUMBER`, `LOGDATE`, `SALEID`, `ITEM_NAME`, `CUST_ALTPHONE`, `COMMISSION`; the supplied source customer columns are `CUST_NAME` and `CUST_MAINPHONE`. Both supplied transactional workbook examples use these fields. Source `Legal Name` is not uploaded; employee matching uses approved roster UUIDs, never this name. Nonempty trailing annotation cells are retained verbatim as **private source notes**, without interpreting them as eligibility or exclusion reasons. Excel comments are rejected rather than silently discarded. Formulas, entities, invalid dates, malformed coordinates and oversized files are rejected.

General Sales CSV is an aggregate control report, not an individual transaction ledger; it is intentionally rejected here. Census is not a certified crosswalk and is not automatically imported into the roster.

The candidate DRB identity is source DRB + uniquely matched location + exact Sale ID. Before release, confirm that this identifies one membership transaction/line across overlapping exports, dates and terminals. Multiple same-key lines in one file, changed date/item, or conflicting same-kind observations roll back the **whole import**. The tool does not pick an arbitrary line, silently overwrite history or infer a line ID. Operators must resolve source conflicts before retrying.

Batches have an original/reviewed source kind, file SHA-256, server content digest, explicit coverage dates, actor and timestamp. Repeating the same batch returns its ID without creating another batch/audit event. Same-key observations in overlapping files are retained as provenance while the sale is counted once. Different content presented with the same hash/coverage is rejected. Source files themselves are never uploaded or stored. A hash supports idempotency, not certification of the export's origin or business meaning.

Every transaction starts pending, even when an employee identifier has ten digits. A four-digit reviewed identifier preserves Sara's exclusion marker, but is neither an employee match nor a specific exclusion reason. It cannot be marked eligible, even through direct RPC calls. No shortened ID is reconstructed. An original full identifier plus reviewed evidence, exact approved date/site-scoped employee mapping, explicit identity confirmation, activity classification and reason are required for eligibility. New/reactivation activity still requires a human eligibility decision; a customer match cannot produce one. Refund/void/replacement/renewal activities are conservatively blocked from eligibility in this draft; approve the activity policy before release rather than treating this implementation as a new commission rule.

Exclusions require explicit identity confirmation and a reason. An excluded transaction can remain employee-unmatched: its known exclusion is visible without attributing commission to anybody. Original transactions partition into eligible/excluded/unresolved counts. Reviewed-only transactions stay outside that partition and are separately visible. Unknown classification, missing original/reviewed evidence or missing employee mapping never earns eligibility. Gross currently means the count of original membership-export records **before** commission exclusions; refunds and voids are not silently netted. Confirm this gross definition before operational use. Import coverage is not certified completeness; absent imported records are not proof of zero sales. Manager totals are attributed sales, with unnamed activity left unattributed. A missing manager comparison is a dash.

Approving a mapping requires an existing roster employee at that location and a full ten-digit exact identifier. Approved intervals cannot overlap. Proposals alone do not attribute sales. Withdrawal of approval invalidates affected eligible decisions and records the change. Replacing a rejected mapping with a different person cannot silently transfer eligible commissions. Sale and mapping reviews use optimistic revisions; stale writes fail. Original observations and prior decisions remain immutable through all exposed paths. A new source kind added after a decision returns it to pending; exact overlapping evidence does not invalidate an existing review.

Customer repeat review searches imported history across date windows by exact normalized phone and exact normalized name. It returns leads, never automatic exclusions. Identical names alone do not identify a customer or employee. No match does not prove no prior membership; the ledger only knows imported history.

## Access and privacy

New tables are in `reconciliation_private`, have RLS, and grant no direct table/sequence access to anon, authenticated or service_role. Public `drb_reconciliation` is an invoker wrapper around a fixed-action, private definer function with empty search_path. Each action checks a **current active Admin profile and separate reviewer grant**, including direct calls to the private function. Client role/metadata and Super Admin capability do not grant reviewer access.

Installation seeds **zero reviewers**. Sara's identity and reviewer scope are not assumed. No account grants are included. All imported observations (including customer names/phones/source notes), mappings and audit data are restricted to these reviewers. Other Admins and Stores receive no customer data or review operations. Existing roles/permissions/functions remain unchanged.

Client data remains in component memory; no browser local storage, raw-file storage, customer CSV export, analytics or source-row logging is introduced. UI errors expose only a fixed allowlist of static server messages. Notes and customer fields render as escaped React text. Customer names/phones are stored in private database columns, not a public batch document. **Retention, authorized reviewers/site scope, and whether full customer fields are necessary must be approved before installation/grants.** There is deliberately no guessed purge policy or automatic destructive deletion.

## Local source validation (aggregate results only)

Validation used the existing local Membership Validation and Incentive Payout examples, without uploading their rows or putting customer/employee identifiers into the repository or logs:

- Original example: 404 transactions, 13 sites, 347 full identifiers and 57 shortened identifiers; 183 annotated transactions. Repeated page headers are skipped only when all required header fields match exactly.
- Reviewed example: 410 transactions, 13 sites, 249 full identifiers and 161 shortened identifiers; 47 annotated transactions. Blank separators and commission-only totals are not transactions.
- All 404 original transactions matched reviewed Site + Sale ID, with zero date/item conflicts. 104 matched identifiers differed. Six reviewed transactions have no original in this example.

These counts validate structure, not the global identity contract or commission rules. The supposed original already has shortened IDs, so it cannot resolve every employee. Obtain the untouched original source for the six additional transactions and the missing full identifiers. Keep those transactions unresolved until evidence/approved matching exists.

Repeat the opt-in local check with `DRB_ORIGINAL_FILE`, `DRB_REVIEWED_FILE`, `DRB_START` and `DRB_END` set, using `node scripts/tests/drb-example-compatibility.mjs`. It prints aggregate diagnostics only.

## Focused validation

- 61 existing/focused employee tests passed (58 existing employee performance, roster and historical mapping tests plus three renderer regression cases for unnamed opening/middle/split checkpoints).
- 10 reconciliation/parser/workbook tests passed: source separation, annotation preservation, ambiguity rejection, exact identifiers, missing comparisons, UUID-only matching, unchanged inputs, safe errors, values-only ZIP/XML limits.
- Eight actual in-memory PostgreSQL tests passed: zero grants, table RLS, invoker boundary, anonymous/Store/ordinary Admin denial, direct private RPC denial, overlap/reimport idempotency, same-hash conflicts, transactional rejection, explicit mapping approval, stale review conflicts, shortened-ID denial, exclusion audit, repeat-customer read privacy, mapping withdrawal and immediate inactive-reviewer denial.
- Isolated headless Chrome passed actual React import preview/save, mapping proposal/approval, sale exclusion, customer review leads, comparisons, unauthorized UI denial, 390/1280px layouts in Light/Dark. All non-loopback traffic was blocked and fixtures were fictional. No user browser or desktop was controlled.
- Vite production build passed. Inherited Admin.jsx duplicate-title and large-bundle warnings remain unchanged.

Commands: `cd app && node --test tests/employeeSummaryCheckpoints.test.js tests/employeePerformance.test.js tests/historicalEmployeeMappings.test.js tests/dailyLogEmployees.test.js tests/drbReconciliation.test.js tests/drbWorkbook.test.js`; from root, `PGLITE_MODULE=<existing PGlite module> node --test scripts/tests/drb-reconciliation-sql.test.mjs`. Existing local Vite/headless browser workflow uses `PLAYWRIGHT_MODULE=<existing Playwright module> node scripts/tests/drb-reconciliation-browser.mjs` against loopback port 5194. No new runtime dependency or infrastructure was added.

## Production compatibility and release gate

Based on current origin/main `48dccc4`, the proposed migration is additive: only new private tables/indexes/functions and one new public RPC. It references existing `user_profiles(id,role,is_active,deleted_at)`, `locations(id,site_code)` and `employees(id,location_id,name)`. Existing checklist, Daily Log, roster, historical mapping, authorization and scoring definitions are not replaced. Existing frontend code does not call the new RPC. No Edge Function changes are required.

Read-only production schema/RPC collision preflight and Supabase security advisor were attempted on November 19, 2026 through the established connector. **Both were denied permission.** This is not a successful production compatibility/advisor check. No alternate authentication or desktop control was introduced. Before release, use established authorized access to check exact types/FKs, unique site matching, namespace/RPC availability, installed migration baseline and existing grants. Do not assume the repository is a complete production schema.

Remaining release decisions:

1. Certify Site + Sale ID as the transaction identity, or supply a stable line/terminal key and revise the contract. Confirm membership export coverage and gross/refund/void meaning.
2. Confirm approved reviewer identities, all-site versus assigned-site access, full versus minimized customer fields and retention. This draft grants nobody and does not identify Sara by name alone.
3. Supply untouched original evidence and approved payroll/POS-to-roster crosswalks for unmatched records. Confirm activity/eligibility rules (especially reactivations). Source annotations remain available for Sara's explicit decisions.

After decisions and a successful read-only production preflight: confirm recovery point; install `20261119162120_drb_sales_reconciliation.sql` once with zero reviewers; inspect permissions and security advisor; perform fictional/non-destructive checks; separately authorize any real reviewer grants and source imports; merge through normal GitHub Pages/Cloudflare pipelines and verify. Do not publish actual source/customer fixtures. No production migration, grant, import, merge or deployment is authorized by this document.

Recovery: before imports, revoke execute on the new public/private RPC to disable the feature; revert the frontend PR through the normal pipeline. Preserve all new private tables and audit/observation history, especially after any real import. Do not drop the schema or rewrite observations as a routine rollback. Existing Daily Logs/checklists/rankings have no dependency on the new ledger. Never reconstruct production from the incomplete repository schema.
