# DRB initial-release evidence and remaining limits

Current scope is authoritative in [single-file reconciliation](drb-sales-reconciliation.md). Earlier two-export recovery, per-sale decisions, customer investigation and customer-retention proposals are superseded by the approved initial-release scope.

## Existing source files

Both supplied commission layouts have `SITENUMBER`, `LOGDATE`, `SALEID`, `ITEM_NAME`, `CUST_NAME`, `CUST_MAINPHONE`, `CUST_ALTPHONE`, `COMMISSION`, `Legal Name`, with possible trailing annotations. **Only site, Sale ID, date, item, raw Alternate Phone employee claim and commission are imported.** Customer names/main phones, Legal Name, annotations and comments are discarded locally before preview/upload. Raw source files stay in the existing restricted workflow, not TM Ops.

The approved employee key is the last four Badge Number / Alternate Phone digits. `020000####` and `20000####` retain a sale; raw `####` excludes it. Every raw string and zero is preserved. An approved ADP roster crosswalk establishes the existing TM Ops employee UUID with site/date coverage; employee/customer display names and ADP File Number are not substitute keys. Include inactive/historical employees when verified. The local roster fields are `Home Deptartment Description` (source spelling), `Company Code`, `Legal Name`, `Badge Number`, `File Number`, `Status`, `Job Title`.

One weekly file after Sara's review is sufficient. The authorized **Review Complete** confirmation records who attested and when for the exact immutable period/export. It unlocks only retained, uniquely attributed sales; source exclusions stay excluded without per-sale re-entry. No second original file, customer lifecycle report or repeated investigation is required for this initial feature.

## Identity validation

The 404-, 410- and 411-row local commission exports each contain zero duplicate Site + Sale ID keys. Shared keys have matching dates/items. No line-ID column is present; the importer must continue to reject future duplicate/conflicting keys rather than invent a line number or collapse records. The two reviewed copies differ, so choose the final completed file. Same-period changes or overlapping exports are blocked; they are not silently merged.

## Remaining release blocker

Production schema/permission preflight and Supabase security advisor were both denied by the existing connector on November 20. They must pass through existing authorized access before installation/merge. No new authentication or desktop operation has been requested. Explicit reviewer UUIDs must be verified/authorized before grants; installation grants nobody. Local crosswalk approvals/data remain an operational responsibility, not guessed employee assignments.

Customer duplicate/repeat-history evidence and customer-data retention are deferred entirely. They are not required or stored in this initial release. No Daily Log, opportunity calculation or leaderboard change is included.
