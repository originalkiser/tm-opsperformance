# Historical name mapping — draft Phase 2

Employees → Historical name mapping inventories exact recorded names with log
appearances, membership sales attributed using the existing cumulative-delta and
correction rules, latest date and mapping decisions. Admin/Store proposals require
explicit identity evidence. Admin alone approves, rejects, locks or corrects;
corrections and revocation of locked decisions are explicit, version-checked and
atomically audited. No automatic matches, employee creation or historical writes.

Each approved/locked mapping applies to one exact name at one location within an
inclusive date interval. Multiple aliases may target one roster UUID. Approved
intervals for one exact alias cannot overlap, even for the same target. Proposals
may overlap while awaiting review. A location advisory lock plus fresh READ
COMMITTED snapshots serializes decisions; other isolation levels are refused.

Team Member Sales resolves each checkpoint once before applying the existing
cumulative-delta, uncertainty, qualification and scoring calculations. It does
not sum stored running totals. Mapped identity uses the explicit target UUID;
unmapped names retain existing case-insensitive grouping. Even an official name
needs an explicit approved mapping to join other aliases; spelling is never
identity evidence. Original Daily Log employee IDs/names/numbers remain intact.
No mapping means identical pre-feature calculations and exports. Mapping read
failure blocks scoring rather than silently dropping approved interpretations.
Refresh the report/mappings after decisions; no realtime subscription is added.

Date ranges cannot disambiguate different people using the same exact name on
the same day. Leave those occurrences unmapped; do not guess. The proposal form
defaults its end date to the latest recorded activity, so historical decisions
need not cover future reuse. Blank names remain unresolved. Correcting a locked
mapping preserves the lock; Admin can also explicitly revoke it with evidence.

Duplicate review displays original-ID-linked appearances/sales/latest date and
separate shared name-only usage. Shared usage cannot choose the correct duplicate
UUID. Keeping one active still never transfers history. No retention choice or
mapping target is selected automatically by historical usage.

## Database and access

One additive review-only migration:
`app/supabase/migrations/20261027140000_historical_employee_name_mappings.sql`.
Two new RLS tables; client writes revoked. The checked definer decision RPC alone
writes proposals/decisions and append-only audit. The separate feature helper
allows active Admin/Store at primary or explicit additional assignments, without
changing shared helpers, roles or existing roster/operational permissions.

Evidence/audit reads stay assigned-location scoped. The approved-only reporting
RPC follows existing company-wide reporting visibility, returning only identity,
location, exact alias, dates and status, without proposal notes or actor details.
A scalar JSON array avoids silent PostgREST row-cap truncation. Location history
and proposal reads are paginated/completeness checked. No production access used.

## Validation and release prerequisites

- Application tests and both base-path builds: see draft PR validation results.
- Added synthetic attribution and UI/client cases cover aliases, split shifts,
  distinct-date identities, overlapping ambiguity, duplicate checkpoint IDs,
  no-mapping compatibility, source preservation, proposals and Admin decisions.
- Isolated PostgreSQL 17.11 authorization/lifecycle checks passed on tm-ops-dev
  in a temporary schema and rolled back. The local psql fixture was adapted to
  that schema because this Mac has no native PostgreSQL runtime.
- Real signed-in synthetic Auth/PostgREST: 27 Admin + 18 Store checks passed.
  Two simultaneous HTTP approvals with a test-only transaction delay admitted
  exactly one; the contender waited 2807ms and failed 23P01. Approved aliases
  produced 6 membership sales; unapproved/ambiguous activity remained 2/1 (total 9).
  Original Daily Logs were unchanged in both sessions. Cleanup returned dev to
  its original 3 employees / 12 logs and exact fingerprints, with no mapping/audit
  fixtures, temporary delay or isolated schemas. Existing policies are unchanged.
  The empty mapping schema remains installed in dev. No full suite repeated.
- Additional-assignment and assignment-removal probes passed and rolled back.
- Fixed stale-version errors to PT409 (HTTP 409). PostgREST 14 retries 40001;
  the stale-version HTTP probe exposed a hang, which the corrected code resolves.
  SQL fixture temporary-schema GRANT was corrected to use its actual namespace.
- Evidence: historical-mapping-dev-results.json and the development-only browser
  fixture app/tests/browser/historical-mapping-auth.html. The fixture requires
  exact owned PR41 records and an isolated temporary test delay, never production.
- After review and explicit production authorization: fresh preflight/backup and
  approved SQL execution; inspect tables/RLS/grants/function definitions and RPC
  visibility, then release the reviewed app. No migration ledger push/repair.
  Recheck unchanged reports with no mappings, approve one scoped known alias and
  compare before/after totals once; inspect original logs and audit preservation.
- Roll back the application first if needed; retain mapping/audit evidence. Database
  backout or repair requires separate review/authorization. No automatic restore.

PR37 remains paused. Daily Log entry/Undo, source values, general dashboards,
Budgets, qualification/scoring formulas and unrelated permissions are unchanged.
