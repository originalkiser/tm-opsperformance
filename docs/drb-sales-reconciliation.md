# Single-file DRB sales reconciliation — release candidate, production hold

PR #75 contains the initial single-weekly-export feature. Employee Summary was independently released in PR #76. This feature never updates Daily Logs, employee opportunities, rankings, qualification formulas or historical name mappings.

## Current workflow

1. An explicitly authorized reviewer selects the weekly DRB Wash Commissions export **after Sara's review**, enters its exact reporting period (at most seven days), validates the preview and imports once.
2. The importer sends only six fields: `site_code`, `sale_id`, `log_date`, `item`, `employee_identifier` (the raw Alternate Phone string), and `commission`. Customer names, main phone numbers, source Legal Name, annotations, comments, raw workbook contents and filenames are not uploaded or stored. No customer search/history/duplicate investigation is included.
3. Employee identity is the last four digits through an approved ADP badge-to-existing-roster-UUID crosswalk, with site coverage and effective dates. Proposals require exact badge text and authoritative ADP evidence/reference. Inactive and historical employees are supported; names do not create matches. Multiple applicable employee UUIDs leave attribution unresolved.
4. A reviewer checks **Sara has completed review of this export for this reporting period** and clicks **Review Complete**. The server records the actual authenticated reviewer, timestamp, exact immutable batch and revision in audit. Until this succeeds, retained sales remain pending. This attests Sara's completed work; it does not impersonate Sara or require per-sale re-entry of her decisions.
5. The backend alone classifies outcomes: recognized retained identifier + unique approved employee + completed period = **Verified Eligible**; exactly four source digits = **Excluded**, with attribution if matched; other formats/missing/ambiguous matches = **Unresolved**. No client eligibility inference or per-sale override endpoint exists.

| Raw Alternate Phone | Classification before matching | Employee identity key |
| --- | --- | --- |
| `020000####` | Retained, pending period confirmation | Last four digits |
| `20000####` | Equivalent retained format, not excluded | Same last four digits |
| Exactly `####` | Sara-excluded commission | Same last four digits |
| Other or blank | Unresolved | No guessed key |

Identifiers stay exact strings, including zeros and whitespace. Unusual/missing claim values do not reject otherwise valid transactions. Gross counts each imported transaction once before exclusions. Eligible/excluded/unresolved commission totals partition gross. Unresolved employee attribution is an independent overlapping count: an excluded sale can be unattributed. The report compares these against the existing Team Sales cumulative-delta/mapping calculations, without changing the leaderboard.

Approval withdrawal, a date mismatch or crosswalk ambiguity immediately removes eligibility through the guarded server projection. Reapproval can restore attribution under the same completed source; all mapping/confirmation history remains audited. Imported source facts are immutable.

## Transaction identity and reviewed-source protection

Site + Sale ID is the observed source key. Before persisting anything, both parser and API reject duplicate keys within an export, including byte-identical duplicate rows; they never invent a row number as a line identifier or collapse possible separate lines. Existing keys with conflicting dates/items are rejected atomically. A reused ID in a later non-overlapping week is therefore flagged rather than merged.

A period has one immutable source snapshot. Same-file/semantic repeat imports are idempotent. A different payload for the same period, or an overlapping reporting period, is rejected instead of replacing a completed review or double-counting sales. Revised files must be resolved explicitly before import; this initial release has no silent amendment, delete or overwrite action. Import errors do not leave partially saved periods or transactions. Review Complete uses an expected revision; stale or forged confirmations fail, and repeated current confirmations do not duplicate audit events.

Local, read-only source checks (aggregate diagnostics only):

| Existing local export | Rows | Sites | Duplicate Site + Sale ID keys |
| --- | ---: | ---: | ---: |
| Membership Validation, November 8–14 | 404 | 13 | 0 |
| Incentive Payout, November 8–14 | 410 | 13 | 0 |
| Newer `data.xlsx`, November 8–14 | 411 | 13 | 0 |

All 404 keys shared with the first export had matching dates/items in both later exports. The reviewed copies differ in coverage/classification; they are not interchangeable, and the same-period conflict guard prevents their accidental combination. No observed duplicate key needs an invented identifier. The schemas do not contain a line ID, so this validates the supplied exports, not a universal claim about every SiteWatch report. A future duplicate or conflict stops that import and requires source clarification.

The newer local ADP roster has 270 badge rows and zero duplicate last-four groups. Of the 410-row payout, 389 claims match exactly one local ADP badge and 21 are unmatched/unrecognized. This diagnostic assigns no TM Ops UUIDs and writes no crosswalk. Unmatched claims remain visible and do not block import or period confirmation.

The parser recognizes values-only source layouts, repeated page headers, blank/commission-total rows and the newer export's `Applied filters:` footer. Formula/error/entity/coordinate/size protections remain. Customer columns, free annotations and comments are discarded rather than retained as review evidence.

## Security and no-customer storage

The existing authenticated application/session/profile infrastructure is reused. Each RPC requires an active, nondeleted Admin **and a separate explicit reviewer grant**. Admin/Super Admin status alone never grants import, read, crosswalk approval or Review Complete. Installation grants nobody; the reviewer list must be separately verified and explicitly authorized before real use.

All six tables are private and RLS-enabled, with direct table/sequence permissions revoked. A public invoker wrapper delegates to fixed-action private authorization functions with empty search_path. Writes serialize and lock the current account/grant, preventing authorization/approval races. There is no arbitrary configuration, raw SQL, customer-search, per-sale eligibility-edit or completion-actor override path.

No schema column, RPC payload field, audit source snapshot, preview state, browser localStorage or raw-file upload stores customer names or main phones. The API rejects injected customer/source-note fields before saving any record. Source hashes are for file idempotency; no customer-specific hashes are created. Imported employee claim/badge data and existing employee names remain reviewer-only. Crosswalk evidence is employee-only; do not paste customer information into it. Generic database details are not echoed to the UI.

## Focused validation

- 12 parser/comparison/workbook tests: source projection privacy, raw identifier preservation, unknown/missing acceptance, row identity rejection, backend-only eligibility, footer handling and workbook protections.
- 10 actual in-memory PostgreSQL tests: zero grants/RLS, ordinary Admin/Store/anonymous/direct-RPC denial, customer-field/completion spoof rejection, one-period idempotency/conflict protection, duplicate/reused key rollback, ADP approvals/inactive employees, consent/revision/audit/eligibility completion, crosswalk ambiguity/date/withdrawal and unchanged Daily Logs/user roles.
- 25 unchanged employee-performance/scoring tests pass.
- Isolated headless actual React workflow: import projection excludes customer sentinels; explicit ADP crosswalk approval; disabled unconfirmed Review Complete; confirmation promotes only matched retained sales; excluded/unknown outcomes remain correct; unauthorized UI denial; mobile/desktop Light/Dark. Hosted traffic is blocked, fixtures fictional, no user browser/desktop controlled.
- Production build passes, retaining inherited duplicate-title and bundle-size warnings.

No real source data was imported into any database. No production account, permission, schema or record was changed.

## Production preflight and shortest release

The established Supabase connector was used for the read-only production schema/RPC collision preflight and security advisor on November 20. **Both returned permission denied.** This is a genuine security/compatibility verification blocker, not a successful production check. No new CLI login or desktop control was introduced. PR #75 stays draft; no merge, migration or deployment proceeds while this is unverified.

Prepared additive migration: `20261119162120_drb_sales_reconciliation.sql`, still uninstalled. It only creates new private objects and the new RPC; existing functions/roles/records are not replaced. The frontend is compatible with an absent backend by denying access to the new report. The old frontend never calls these new functions.

Once existing authorized production access can verify compatibility/security and explicitly authorized reviewer account IDs are established, the shortest safe sequence is:

1. Run `docs/sql/drb-reconciliation-preflight-read-only.sql`, inspect the security advisor and confirm the database recovery point. Stop on drift or identity conflicts.
2. Install the prepared migration once, verify zero reviewer grants and deny-by-default permissions, then grant only the explicitly authorized, uniquely verified active Admin reviewers through the existing workflow. No account role changes or automatic Super Admin grants.
3. Merge PR #75 normally and verify GitHub Pages and Cloudflare builds plus authorized/unauthorized report access. Do not import real files as a smoke test. Operational reviewers choose the final Sara-reviewed weekly export and attest its period after release.

Recovery: revoke the new RPC/reviewer access and revert the frontend through the existing pipeline. Preserve imported source facts/audit if records exist; do not drop the schema, overwrite history or reconstruct production from repository SQL. No new infrastructure, broad tests or extra preview environments are needed.
