# Evidence needed to complete DRB reconciliation (PR #75)

The Employee Summary checkpoint fix was released separately through PR #76, production merge `7f41f3045d036129e26514da1d595c50f8aaefd8`. It is no longer part of the importer diff. The importer remains draft; no migration, reviewer grant or real customer import has been performed.

## Confirmed matching update — November 20, 2026

The earlier assumption that shortened identifiers could not establish employee identity is superseded. Employee identity is the last four digits of the authoritative ADP Badge Number / Alternate Phone, through an approved dated roster-UUID crosswalk. Source `020000####` and `20000####` are equivalent retained formats; exact `####` is Sara-excluded. Classify the untouched source string before taking the key; preserve zeros. Retained records wait for verified completion, and missing/ambiguous employees remain unattributed independently of exclusion status. Inactive/historical employees are supported. See [current draft rules and validation](drb-sales-reconciliation.md).

The implementation now uses **one weekly export**; the two-file recovery requirement below has been replaced. Transaction/line identity, completion/attestation and security remain release gates.

## Exact fields in the supplied commission workbooks

Both `DRB Membership Validation 11.08-14.2026.xlsx` and `DRB Incentive Payout 11.20.2026.xlsx` have these nine named columns:

| Column | What it establishes | What it does not establish |
| --- | --- | --- |
| `SITENUMBER` | Source site number | Source-system namespace or terminal identity |
| `LOGDATE` | Calendar sale date in these exports | Full transaction timestamp, timezone or line identity |
| `SALEID` | Source sale identifier | Whether it is unique across terminals/time, or one sale has multiple membership lines |
| `ITEM_NAME` | Item display wording | Stable product ID, membership/event type, quantity or sale-line key |
| `CUST_NAME` | Customer name as exported | Unique customer identity or automatic reason to exclude a sale |
| `CUST_MAINPHONE` | Customer matching lead | Stable customer identity, complete history or proof of a repeat/replacement |
| `CUST_ALTPHONE` | Employee-entered claim identifier; Sara's shortened values preserve exclusion evidence | Raw four-digit values mean excluded; recognized 9/10-digit values mean retained. Last four match an approved ADP crosswalk; no format alone proves eligibility |
| `COMMISSION` | Exported numeric commission amount | Sara's explicit eligibility decision; zero/positive amounts are not eligibility flags |
| `Legal Name` | Employee name included in the report | Unique employee identity or a certified payroll-to-roster crosswalk |

Unheaded trailing annotation cells also exist (183 original transactions; 47 reviewed transactions). The draft preserves them privately as source notes without converting them into business decisions. Neither workbook has named columns for decision, exclusion reason, reviewer, reviewed-at, customer ID, plan ID, RFID, activation/expiration/status, refund/void state, replacement link, original employee claim history, terminal ID or sale-line ID.

Local structural checks: 404 original transactions versus 410 reviewed, across 13 sites; all 404 join on Site + Sale ID with no date/item conflict. The earlier original sample contains 57 four-digit identifiers; under the now-confirmed rule these mean excluded commissions and can still match employees by their last four digits. Six reviewed transactions have no original counterpart in the supplied original. These are evidence gaps, not proof that one file or employee is wrong. Do not classify by name or mark retained transactions eligible before review completion. The current weekly import does not require an original counterpart for those six rows.

The census columns are exactly `Home Deptartment Description` (source spelling), `Company Code`, `Legal Name`, `Badge Number`, `File Number`, `Status`, `Job Title`. It has neither a TM Ops roster UUID nor an explicit source site-number column. The confirmed identity link is the last four digits of Badge Number and CUST_ALTPHONE; File Number is not an assumed identity key. Preserve exact badge strings and use verified ADP evidence when approving the crosswalk; do not zero-pad or name-match. General Sales CSV remains an aggregate control, not transaction identity evidence.

## Source evidence still needed

1. **One weekly DRB commission export** with all sites and the correct coverage, preserving Sara's existing four-digit exclusions and source notes. No second mandatory original import or repeated per-sale exclusion entry. Keep authoritative source files in the existing restricted workflow. Confirm Sara's completion/attestation and handling of revised files before retained sales can become eligible.
2. **Authoritative ADP badge roster/crosswalk** linking exact badge strings (last-four identity), existing TM Ops employee UUIDs, site coverage and effective dates. Include inactive/historical employees and verify unique matches. Missing and ambiguous mappings stay unresolved; display names and File Number are not substitute identity keys.
3. **DRB transaction/receipt line detail or authoritative key documentation** proving whether Site + Sale ID uniquely identifies a membership transaction/line across terminals and dates. Supply a stable line/terminal key if needed, plus product/activity and reversal references. Multiple lines must never be collapsed arbitrarily.
4. **DRB customer/ARM lifecycle and associated sale history** where Sara needs supporting verification: stable customer/member references, RFID replacement links, activation/expiration/cancellation/status dates, decline/recharge outcomes and reactivation/replacement/refund/void events. Existing reviewed exclusions are preserved without automatically guessing their specific reason. Names/phones alone never disqualify a sale.

## Proposed access and retention — NOT APPROVED

- Begin with Sara and one explicitly designated backup using uniquely verified existing active Admin accounts. Grant a separate sales-review capability; do not automatically grant all Admins or all three Super Admins. Limit customer/claim/reason access to the 13 DRB sites, with server-side checks and audit. Ordinary users receive only approved non-customer aggregates, if authorized. No reviewer grants yet.
- Default to stable source customer/member references and the minimum fields required for a specific review. Avoid retaining raw workbooks or payment details in TM Ops; preserve authoritative exports only in the existing restricted OneDrive process under its approved policy. No public URLs or customer exports.
- If full customer names/phones or free-text source notes are necessary, propose removal from TM Ops **30 days after final review, with a 90-day maximum after import**, unless an explicitly approved hold applies. Apply the same treatment to notes that contain customer data and consider provider backups when promising deletion. These are proposed retention limits, not a commission lookback. Unresolved cases reaching the limit require an approved handling decision; do not silently keep them forever.
- Keep transaction identity, employee attribution and decision audit without raw customer text for the separately approved business audit period. Pseudonymous customer tokens are still sensitive; retain them only for an approved purpose/period. Resolve lifecycle questions against authorized DRB history rather than building an indefinite customer database in TM Ops.

The current draft has no reviewer grants and no retention/purge automation. Its reviewer grant is currently global, not DRB-site-scoped; its customer columns/source notes retain full values. Approving the narrower proposal requires targeted scope/minimization/retention changes and tests before release. Approval is not inferred from this recommendation.

## Release boundary

No importer deployment until the certified identity, explicit eligibility rules, source/crosswalk evidence and customer protection policy are verified, and the targeted production schema/permission/security preflight succeeds through existing authorized access. The previous connector preflight/advisor was denied; no new CLI authentication or desktop session is requested here. The independent calculation fix needs no Supabase change because its dependencies, API and authorization contracts are unchanged. Leaderboard scoring remains unchanged; no real source/customer import or customer-record changes are authorized by this document.
