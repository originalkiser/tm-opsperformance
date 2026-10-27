# PR40 validation — 2026-10-25

## Persistence blocker correction — current draft

This supersedes the original persistence claims/counts below; the earlier dropdown evidence remains historical context.

- **337 application tests passed, zero failed/skipped**, including **30 component stress cases** (all 18 original integrated-review assertions plus 12 additional concurrency/lifecycle cases). The original four persistence defects now pass. Focus/blur and paste no longer enqueue untouched zero checkpoints for deletion.
- **7/7 production-shaped PostgreSQL writer probes passed** on the guarded isolated local PostgreSQL 17.6 database, with the existing employee-ID FK, both checkpoint unique keys, RLS and production Plans Lost trigger. The fixture applies only PR38/PR39 SQL; no PR37 dependency.
- Actual approved development Auth/PostgREST: **14/14 Admin and 14/14 Store checks passed** with the revised coordinator. Store cross-location writes were denied by RLS; Admin authorized other-location writes succeeded. Saved selection and Undo were also verified through the real card UI and scoped database reads. Store numerical-first save → roster selection → Undo restored employee_name to NULL while retaining the same UUID and google_reviews=2. Original historical nickname and numeric activity retained.
- Admin and Store synthetic cleanup restored the exact original 3 employee / 12 Daily Log counts and fingerprints. The hosted Store validation blocker is closed. Technical recommendation: GO for review of the corrected draft; production execution still requires explicit authorization and the separately reviewed PR38/PR39 release procedure. No merge or deployment is authorized by this result.
- Both production build targets pass with the existing Admin duplicate-title and chunk-size warnings. No deployment is performed by building.
- Migration files and calculation/reporting modules remain unchanged. No production query/write, migration, merge or deploy was executed for this correction.

The day-scoped queue orders hourly, delete/Undo and Plans Lost writes by stable checkpoint key. Conditional mutations reject concurrent activity/identity changes. Confirmed deletion snapshots restore original UUIDs, existing employee IDs, NULL/blank names, counters and historical values. Own INSERT UUIDs allow exact reconciliation of lost responses; unresolved outcomes remain explicit errors. Navigation flushes staged operations and reports failures after unmount; browser unload warns while writes are pending.

Limits: hosted development lacks production employee_id / Plans Lost schema, so those paths are verified in the isolated production-shaped database rather than by changing shared dev. Existing Plans Lost guards can prevent reinsertion of a deleted manual-Net-Members checkpoint after a day changes calculation mode; such deletions are blocked where detectable, and any later conflicting change is reported. Browser termination/network loss cannot guarantee delivery, and true concurrent edits require reload/reconciliation. Active-roster read and text-name write remain separate requests.

## Original dropdown validation (before integrated blocker corrections)

## Automated checks

- Complete application suite: **306 passed, 0 failed, 0 skipped**. Includes all PR38/PR39 Node authorization/roster/UI regressions. Replaced the obsolete Daily Log auto-add expectation with selection-only regression coverage.
- New service/picker tests cover alphabetical normalized deduplication, active location scope, incomplete/error reads, uncommitted searches, keyboard/pointer selection, historical names, empty/loading/error lists, guarded PATCH versus conflict-safe INSERT, no employee-ID writes, exact historical undo, unrelated-undo preservation after concurrent renames and late location responses.
- Real DailyLogTable component harness exercises backdated table/card edits under both Simple and Detailed opportunity formulas, historical UUID/name preservation, explicit name replacement, repeat saves, split-hour inserts and card selection of existing splits. Numeric formulas were not changed.
- Both Vite production targets passed: repository GitHub Pages base and `--base=/` for Cloudflare Pages. Existing large chunk warnings and the pre-existing duplicate `title` attribute warning in Admin.jsx remain outside this PR.

## Authorized hosted development tests

Project: **tm-ops-dev / bmfvcnsuduttebxbjvwx**. Production was not queried or modified. No schema/policy/Auth configuration changes were made for PR40. PR38/PR39's previously approved employee-only dev adapter/name guard remained in place.

Before writing: inspected actual Daily Log columns and aggregate counts: 3 original employees, 12 Daily Logs, zero rows on isolated date **2025-01-15** at the two fictional PR16 test locations. No assumption that development was empty.

The administrator privately signed in to the existing synthetic Store and Admin accounts. A guarded local-only fixture verified real `auth.getUser()` and active profile/role, then exercised the same service writer and the actual DailyLogTable. No credentials or sessions were copied/exported.

**Store: 9 checks passed; Admin: 10 checks passed** (counts include guarded Auth/fixture setup):

- active roster scoped to selected location; inactive synthetic name omitted;
- actual PostgREST split-hour INSERT;
- unrelated PATCH retained historical nickname;
- unrelated PATCH preserved a different name concurrently written by another request;
- explicit replacement of a concurrently changed name rejected;
- roster deactivation before a new-name write rejected;
- another location's options contained none of the first site's roster IDs;
- crafted Store cross-location write denied by existing RLS; Admin authorized other-site write succeeded;
- Admin additionally verified the null/empty existing-name replacement PostgREST filter.

Store table keyboard selection saved the exact active roster spelling at 9AM; read-only SQL verified the resulting row. Admin card keyboard selection replaced only the owned synthetic historical fixture's name; read-only SQL verified the saved value. Uncommitted arbitrary text/Escape left the recorded historical name unchanged. Backdated date and split indices remained exact.

Only four synthetic roster records and seven synthetic Daily Logs were created across both runs. Cleanup used exact observed UUID/name/location/date guards; it did not delete or edit any original record. Final development totals: **3 original employees, 12 original Daily Logs**. Before/after original fingerprints match:

- employees JSONB-by-ID MD5: `9a244022053f189b899d7ce7e1d6459d`
- Daily Logs JSONB-by-ID MD5: `96eead632fe3697ce31dbafbe00aeb5d`

Expected test denial: Store cross-location POST returned HTTP 403/RLS denial. This is a passing negative test, not an unresolved application error.

## Visual/keyboard checks

- Authenticated actual DailyLogTable in Edge: table and card selection, retained historical names, keyboard search/selection, light/dark rendering.
- Actual EmployeeSelect in isolated **393×852 mobile** and **1024×650 desktop** iframe viewports: light/dark menu, long names, historical display and empty-roster guidance. The mobile card menu aligns inward and wraps long names; mobile input uses 16px text. No phone hardware or screen-reader certification is claimed.
- Native Edge device-emulation controls did not provide reliable visual scaling through the automation interface; fixed-width iframe viewports were used for reproducible visual evidence instead.
- Automated tests exercise failure/loading states, focus cancellation and ARIA combobox/listbox semantics. Local-only visual fixtures make these states reproducible without authentication or writes.

## Remaining release constraints

PR40 is frontend-only and depends on draft PR39/PR38; those SQL changes still require separate production approval. Hosted dev does not contain `employee_id` or production Plans Lost schema/guard: no attempt was made to alter shared development schema for this task. Local component tests verify existing non-null IDs remain unchanged, and existing Plans Lost tests pass. Production schema compatibility was reviewed against the supplied inventory; no production execution is claimed.

A final active-roster read and a text-name write are separate requests. A deactivation between them cannot be made atomic without additional server changes. Older clients/direct API calls retain current text-column semantics. Review these documented scope limits before release authorization; do not enable PR37 identity assignments.
