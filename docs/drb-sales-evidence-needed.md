# Evidence needed to complete DRB reconciliation (PR #75)

The Employee Summary checkpoint fix was released separately through PR #76, production merge `7f41f3045d036129e26514da1d595c50f8aaefd8`. It is no longer part of the importer diff. The importer remains draft; no migration, reviewer grant or real customer import has been performed.

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
| `CUST_ALTPHONE` | Employee-entered claim identifier; Sara's shortened values preserve exclusion evidence | Certified roster UUID; shortened values cannot reconstruct the original ID; ten digits alone do not prove eligibility |
| `COMMISSION` | Exported numeric commission amount | Sara's explicit eligibility decision; zero/positive amounts are not eligibility flags |
| `Legal Name` | Employee name included in the report | Unique employee identity or a certified payroll-to-roster crosswalk |

Unheaded trailing annotation cells also exist (183 original transactions; 47 reviewed transactions). The draft preserves them privately as source notes without converting them into business decisions. Neither workbook has named columns for decision, exclusion reason, reviewer, reviewed-at, customer ID, plan ID, RFID, activation/expiration/status, refund/void state, replacement link, original employee claim history, terminal ID or sale-line ID.

Local structural checks: 404 original transactions versus 410 reviewed, across 13 sites; all 404 join on Site + Sale ID with no date/item conflict. The original already contains 57 shortened employee identifiers. Six reviewed transactions have no original counterpart in the supplied original. These are evidence gaps, not proof that one file or employee is wrong. Do not infer missing IDs, classify by name, or mark the reviewed-only transactions eligible.

The census columns are exactly `Home Deptartment Description` (source spelling), `Company Code`, `Legal Name`, `Badge Number`, `File Number`, `Status`, `Job Title`. It has no TM Ops roster UUID, explicit source site number or documented link from CUST_ALTPHONE to Badge/File Number. Do not zero-pad a badge or match names to invent that link. General Sales CSV remains an aggregate control, not transaction identity evidence.

## Four source packages needed

1. **Untouched DRB Wash Commissions export, before Sara's edits**, covering the same exact period and all 13 DRB sites as the reviewed payout. Re-export November 8–14 for this sample, including the six reviewed-only records and the original full employee claims where available. Keep the original files in the existing restricted OneDrive workflow. If DRB itself only retains a shortened claim, obtain its employee-claim/change audit; do not reconstruct it.
2. **DRB transaction/receipt line detail for those same sales**, or authoritative DRB documentation plus a representative export proving the key. Required evidence: site/source, Sale ID, full timestamp, terminal/register ID where IDs can collide, membership line ID where receipts contain multiple lines, stable product/event ID, quantity, and refund/void/reversal links/status. If Site + Sale ID is certified sufficient, no invented extra identifier is needed. The requested data content is exact; a vendor report title for this detail has not been verified and should not be guessed.
3. **Sara's reviewed payout plus an explicit decision companion keyed to the certified transaction/line identity.** Preserve the untouched employee claim alongside the edited claim. Include eligible/excluded/pending, specific reason, new/renewal/reactivation/replacement/refund/void/unknown activity, reviewer, review time and reviewed source/version. Obtain an approved employee crosswalk linking exact DRB claim IDs to existing roster UUIDs with location and effective dates; census Badge/File Number semantics must be confirmed. Unchanged ten-digit claims are not automatically eligible. Sara must confirm the recent-expiration/reactivation rule and its exact lookback, exceptions and boundary dates.
4. **DRB customer/ARM membership lifecycle and associated sale history** for the necessary lookback before each claimed sale, including prior memberships outside the November sample and cross-site history where relevant. Needed: stable customer/account ID, plan/membership ID, RFID token/change or replacement linkage, start/end/cancellation/expiration dates, status/payment decline history, prior sale IDs, and reactivation/replacement/refund/void events. Names/phones may support authorized review but cannot independently disqualify a transaction. The lookback must be set by Sara's approved rule; a guessed 30/60/90-day commission rule is not acceptable. If no single report has these fields, use linked exports with documented keys, not a guessed name join.

## Proposed access and retention — NOT APPROVED

- Begin with Sara and one explicitly designated backup using uniquely verified existing active Admin accounts. Grant a separate sales-review capability; do not automatically grant all Admins or all three Super Admins. Limit customer/claim/reason access to the 13 DRB sites, with server-side checks and audit. Ordinary users receive only approved non-customer aggregates, if authorized. No reviewer grants yet.
- Default to stable source customer/member references and the minimum fields required for a specific review. Avoid retaining raw workbooks or payment details in TM Ops; preserve authoritative exports only in the existing restricted OneDrive process under its approved policy. No public URLs or customer exports.
- If full customer names/phones or free-text source notes are necessary, propose removal from TM Ops **30 days after final review, with a 90-day maximum after import**, unless an explicitly approved hold applies. Apply the same treatment to notes that contain customer data and consider provider backups when promising deletion. These are proposed retention limits, not a commission lookback. Unresolved cases reaching the limit require an approved handling decision; do not silently keep them forever.
- Keep transaction identity, employee attribution and decision audit without raw customer text for the separately approved business audit period. Pseudonymous customer tokens are still sensitive; retain them only for an approved purpose/period. Resolve lifecycle questions against authorized DRB history rather than building an indefinite customer database in TM Ops.

The current draft has no reviewer grants and no retention/purge automation. Its reviewer grant is currently global, not DRB-site-scoped; its customer columns/source notes retain full values. Approving the narrower proposal requires targeted scope/minimization/retention changes and tests before release. Approval is not inferred from this recommendation.

## Release boundary

No importer deployment until the certified identity, explicit eligibility rules, source/crosswalk evidence and customer protection policy are verified, and the targeted production schema/permission/security preflight succeeds through existing authorized access. The previous connector preflight/advisor was denied; no new CLI authentication or desktop session is requested here. The independent calculation fix needs no Supabase change because its dependencies, API and authorization contracts are unchanged. Leaderboard scoring remains unchanged; no real source/customer import or customer-record changes are authorized by this document.
