# Employee identity investigation — PR #36 follow-up

## Findings before implementation

The user reports seven Cam records at 1527-Carencro. The configured production
project is qbdvixxooofdlfurcpqy. A read-only metadata/targeted-row query was denied
by the connected Supabase service on 2026-10-24; only tm-ops-dev was listed as
available. No production records, row IDs, timestamps, live constraints, or
inbound foreign keys could be verified. Do not treat repository schema as proof
of the current production schema or assume all seven records are one person.

Verified from the repository:

- `app/supabase/seed.sql` defines employees with id, location_id, name, is_active,
  created_at, and only an ID primary key. No trimmed/case-insensitive name
  uniqueness constraint appears in the checked-in employee schema/migrations.
- Admin previously inserted every nonblank trimmed name without a duplicate
  check, pending-submission guard, or visible insert-error handling.
- Daily Log auto-add checked a cached active-only list. It compared lowercase
  names without trimming existing names and inserted before updating the cache.
  Repeated saves before refresh, separate clients, and an inactive existing name
  could therefore create duplicates. These are demonstrated code paths, not
  proof of which path created the seven production rows.
- The Daily Log schema has employee_name, not employee_id. Both save paths write
  employee_name as text. EmployeeSelect emits a name, not the option's roster ID.
  The roster provides suggestions/active status; it is not a sales fact table.
- Team Member Sales reads Daily Logs directly, computes chronological cumulative
  deltas per site/day, then aggregates by trimmed case-insensitive name within
  site. It never joins to roster IDs. Duplicate roster rows do not multiply the
  number of transactions, opportunities, employee rows, or qualification slots.
- PR #36 deliberately keeps same-name identities at different locations separate.
  Matching names at the same site are already one reporting identity. If those
  names belong to different people, historical text-only activity cannot be
  safely separated without independent evidence. A roster cleanup cannot fix
  that information loss by guessing.
- Other name-based consumers include EmployeeSummary and MonthlyRollup. Existing
  employee delete/deactivate controls are roster actions; code inspection alone
  does not certify production cascade/trigger effects or make deletion safe.

## Implemented frontend prevention (no production writes)

A shared guard re-reads the complete authorized location roster, including
inactive records, before either Admin creation or Daily Log auto-add. The name
key is trim + lowercase, scoped to location ID. Matches return existing records;
no automatic merge, reactivation, rename, delete, or historical reassignment is
performed. An inactive employee should be reviewed before manual reactivation.
Different people with the same display name require distinguishable roster names.

Admin prevents repeated submissions, shows creation failures/duplicate guidance,
and flags duplicate-name groups as candidates for identity review only. A shared
in-flight guard coalesces same-client, same-location/name auto-add requests.
Roster validation failures block roster creation, never a Daily Log save.

**Limit:** frontend checks cannot atomically prevent races between independent
browsers/clients. A future database uniqueness constraint on the agreed normalized
location/name key is needed for a global guarantee. Do not install it while
existing duplicates are unresolved. That schema work is not included or executed.
No RLS, permissions, store math, scoring, or storage validation changes are made.

## Recommended safe consolidation design — not an executable operation

1. Obtain authorized **read-only production** evidence first: actual employee
   columns, indexes, triggers and every inbound foreign key (including cascade
   behavior); exact seven IDs/statuses/created dates; historical name variants,
   locations and date ranges. Read logs by location/name as evidence, not as proof
   of which roster ID earned sales. Preserve a timestamped review inventory.
2. Present each candidate record with ID, site, original name, status and creation
   time. Matching normalized names only create a review group. An administrator
   must explicitly confirm the selected IDs refer to the **same actual person**,
   cite identity evidence, choose a canonical ID, and review before/after counts.
   Support “different people” and “insufficient evidence” outcomes with no merge.
3. Prefer a separately reviewed canonical/alias model: retain every original ID
   and name, link only confirmed duplicate IDs to the canonical ID, archive aliases
   from active roster selection, and retain who confirmed it, when and why. This
   yields one logical active roster identity while preserving provenance and
   avoiding physical deletion. Do not automatically rename/reassign historical
   name-only logs. Distinct-name historical aliases require their own evidence,
   reviewed reporting mapping, and regression plan.
4. Before writing any consolidation, prepare a reviewed migration and exact
   transaction plan: approved IDs/site, expected row counts, current-row version
   preconditions, inbound-reference handling, audit records and rollback. Obtain
   explicit production approval. Do not ship a working merge/delete button before
   this design and the actual production relationships are approved. The existing
   Delete control is not a substitute for confirmed consolidation.
5. In a test environment, verify unchanged log IDs, counts, cumulative counters,
   sales/opportunity totals and PR #36 scores/qualification/ranks before/after.
   Account for existing name collisions that cannot be resolved historically.
6. Only after approved consolidation, propose a separate reviewed uniqueness
   migration with normalization consistent between browser and database, plus
   explicit handling of inactive records and genuinely distinct same-name people.
   Keep existing permissions. Re-test multi-client races against that constraint.

No migration, backfill, alias mapping, consolidation execution, production
mutation, merge, or deployment is authorized/performed in this follow-up.

## Validation

271 automated tests pass, including nine new identity/creation/leaderboard
regressions. Both production builds pass (GitHub Pages and root base) with the
existing large-chunk warning. Tests use synthetic/mocked records only; the
production query was rejected before any inventory could be obtained.
