# DRB initial-release evidence and remaining limits

Current scope is authoritative in [single-file reconciliation](drb-sales-reconciliation.md). Earlier two-export recovery, per-sale decisions, customer investigation and customer-retention proposals are superseded by the approved initial-release scope.

## Existing source files

Both supplied commission layouts have `SITENUMBER`, `LOGDATE`, `SALEID`, `ITEM_NAME`, `CUST_NAME`, `CUST_MAINPHONE`, `CUST_ALTPHONE`, `COMMISSION`, `Legal Name`, with possible trailing annotations. **Only site, Sale ID, date, item, raw Alternate Phone employee claim and commission are imported.** Customer names/main phones, Legal Name, annotations and comments are discarded locally before preview/upload. Raw source files stay in the existing restricted workflow, not TM Ops.

The approved employee key is the last four Badge Number / Alternate Phone digits. `020000####` and `20000####` retain a sale; raw `####` excludes it. Every raw string and zero is preserved. An approved ADP roster crosswalk establishes the existing TM Ops employee UUID with site/date coverage; employee/customer display names and ADP File Number are not substitute keys. Include inactive/historical employees when verified. The local roster fields are `Home Deptartment Description` (source spelling), `Company Code`, `Legal Name`, `Badge Number`, `File Number`, `Status`, `Job Title`.

One weekly file after Sara's review is sufficient. The authorized **Review Complete** confirmation records who attested and when for the exact immutable period/export. It unlocks only retained, uniquely attributed sales; source exclusions stay excluded without per-sale re-entry. No second original file, customer lifecycle report or repeated investigation is required for this initial feature.

## Identity validation

The 404-, 410- and 411-row local commission exports each contain zero duplicate Site + Sale ID keys. Shared keys have matching dates/items. No line-ID column is present; the importer must continue to reject future duplicate/conflicting keys rather than invent a line number or collapse records. The two reviewed copies differ, so choose the final completed file. Same-period changes or overlapping exports are blocked; they are not silently merged.

## Production verification and deferred activation

The existing authenticated Dashboard workflow was authorized and used on November 20. Schema compatibility, RLS, source hashes, uniqueness constraints and negative permission checks passed; the migration was installed once after confirming the recovery point. See the current release record in [single-file reconciliation](drb-sales-reconciliation.md). No reviewer grants or real imports were made. New explicit reviewer assignments remain required before operational use; they are not an installation/deployment permission inferred from Admin or Super Admin status.

Customer duplicate/repeat-history evidence and customer-data retention are deferred entirely. They are not required or stored in this initial release. No Daily Log, opportunity calculation or leaderboard change is included.
