# Simplified employee roster — review sequence

PR #37 and its identity migration are paused and excluded. No production execution,
merge, deployment, employee ID assignment or historical attribution work is authorized.

1. **Roster authorization (this draft):** replace only the known employee write
   policy. Active/nondeleted store accounts maintain their profile location;
   area managers maintain manager_locations assignments; Admin maintains all.
   Existing authenticated roster reads stay unchanged for report compatibility.
   Permit only insert location/name/status and update name/status. No client delete,
   truncation or employee key/location edits. Remove the incompatible Admin Delete
   control; keep existing add/status workflows. Dedicated fixed-search-path boolean
   helper does not replace existing shared helpers or change other table access.
2. **Employees tab and validation:** reuse current roster; assigned-location UI,
   add/edit/status, confirmation on rename and original-name historical-sales
   warning. Introduce a separately reviewed employee-only normalized-name guard
   with concurrent-writer tests; include inactive names, tolerate unchanged legacy
   duplicate records so they can be deactivated. Do not add a unique index that
   fails on existing duplicates. Existing frontend validation alone cannot prevent
   two simultaneous inserts; this small guard is needed before broad manager use.
   Admin multi-select review shows IDs/names/status, explicit same-person confirmation,
   one retained active record, and deactivates others without deleting/rewriting logs.
   Treat bulk updates as all-or-nothing or make partial failure explicit and refresh;
   never report success on a partial operation. No aliases or historical merges.
3. **Daily Log selection:** active location roster dropdown, saving employee_name,
   leaving employee_id unchanged. Preserve historical inactive/unmatched labels
   when loading and making unrelated metric edits; don't force replacement. Existing
   names can be suggested for review using authorized location/date-filtered reads;
   no automatic employee creation or attribution. Keep original report calculations.

Each PR remains independently reviewable and draft. Later frontend PRs require the
reviewed authorization plus duplicate guard before rollout. No full identity project.

## Known limitations / release blockers

- Production execution of this permission SQL needs explicit approval, refreshed
  policy/helper/column-ACL inventory, backup/recovery owner and maintenance window.
  Production has no migration ledger: no blind CLI push/pull/repair or automatic
  history initialization. Apply only exact reviewed SQL if separately authorized.
- Authorized hosted development has different employee policies. This candidate
  deliberately refuses that baseline. Do not align shared dev or run production
  SQL there silently; approve an employee-only staging setup before hosted tests.
- Renames preserve UUIDs, but historical name-based sales retain their original name;
  one actual person can appear under multiple historical names. No rewriting history.
- Duplicate deactivation is reversible by status update but doesn't undo any later
  user edits. No permanent employee deletion or historical data consolidation.
- New name validation cannot distinguish two actual same-name people at one site;
  Admin must choose clearly distinguishable display names without automatic merging.
- Existing broad roster SELECT remains for current reporting. No unrelated access
  cleanup, data-entry validation, other-table policy or KPI formula changes.

## Tests and production procedure

Local regression fixture reproduces supplied production employee policies and real
PostgreSQL RLS/column permissions. Test all roles, own/other/multiple locations,
revoked assignments, inactive/deleted profiles, blank/missing identity, direct writes,
key-change/deletion rejection, Admin add/toggle, unchanged historical rows/policies,
atomic drift refusal and reapplication. No production mutations or hosted dev changes.

Before execution inspect actual policy/column ACL/profile shape and helper ownership;
unknown inherited grants/roles or policies stop rollout. This change intentionally
removes broad employee CRUD from authenticated clients. Review external roster writers
that insert IDs, delete records or relocate them. Failure before commit rolls back;
after commit prefer disabling new UI/forward repair, not restoring broad employee
writes. Any permissions rollback requires explicit review, not an automatic script.

## Validation completed for the permissions draft

- 36 actual isolated PostgreSQL 17.6 role/RLS/column-ACL checks passed.
- Complete main-based Node suite: 274 passed, zero failed (271 existing + 3 new).
- Both production Vite builds passed; existing >500 kB chunk warnings remain.
- No hosted development or production query/change performed for this draft.
- Local runner requires psycopg2-binary 2.9.11, pre-provisioned synthetic API roles,
  a private Unix socket server owned by identity_test_admin, and explicit reset
  consent. It drops/recreates only tm_roster_permissions_test after checking the
  exact server data directory and absence of a TCP address. No PR #37 fixtures or
  migration are loaded. Example (authorized isolated environment only):

```sh
python3 app/tests/roster/validate_permissions.py --reset-disposable-db \
  --socket /private/tmp/TEST_SOCKET --port TEST_PORT \
  --data-directory /private/tmp/TEST_DATA --output /private/tmp/roster-results.json
```
