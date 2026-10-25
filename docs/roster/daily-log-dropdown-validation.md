# PR40 validation — 2026-10-25

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
