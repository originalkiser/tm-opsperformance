# Checklist Compliance: draft implementation

Branch: `codex/checklist-compliance-report`, based on main `3a478acd1f72028e6c2b88552668eb4d6e9f808a`.

## What is implemented

A new authenticated Checklist Compliance page, linked from Manager Checklists and the Reports sidebar. No checklist entry, draft ownership, evidence, template or submission-edit behavior changes.

- Daily: each site-day is 100% only if Opening, Mid-Day and Closing are all submitted; otherwise 0%.
- Weekly: each site-week is 100% only if Manager Administrative and Preventive Maintenance are both submitted; otherwise 0%.
- Missing, in-progress and discarding drafts are shown by checklist. Every eligible reporting location remains visible even with no records.
- Daily date ranges up to 92 days, a week picker, market/location/status filters, company/assigned-site summary and CSV export of the visible rows.
- Summary percentage is fully complete site-periods divided by all nonfuture site-periods. Status filters do not change the summary denominator. Future site-periods are N/A and excluded; current periods explicitly show completion so far, never an overdue label.
- Historical pilot records retain a label. The report explicitly says MonitorQA remains official, checklists remain optional, and historical gaps are not policy violations. Nothing creates assignments, deadlines, scores elsewhere, reminders or notifications.
- A scalar JSON RPC supplies only location metadata and narrow status fields. Failures clear scores/export and do not fall back to raw checklist tables. Older/account-stale responses are ignored. CSV formula injection is escaped.

## Access and date evidence

Admins receive companywide reporting locations. Store and legacy area-manager users retain their existing assigned-site scope. Authenticated status reporting does not grant answer, submitter, signature or attachment access. Existing raw-table/evidence authorization remains unchanged.

`checklistRules.js`, the existing save RPC and `docs/weekly-pm-checklist.md` establish site-local business dates and Monday calendar-week keys. The weekly report uses Monday–Sunday, not a newly invented Monday deadline. The server supplies each site's current local date using `locations.timezone`; invalid zones stop the report rather than silently using the browser time zone.

There is no location `is_active` column in the repository schema. Existing reports use `!exclude_from_reporting`, and this feature mirrors it (`IS NOT TRUE` in SQL). **Confirm this is the intended active-location definition before release.** Historical opening/closure dates are unavailable, so historical reports explicitly use today's reporting-site roster. There is no obligation-effective date and no retroactive compliance enforcement.

## Validation actually completed

- `npm --prefix app test`: **479 passed, zero failed**, including 18 new utility/UI tests.
- `PGLITE_MODULE=/tmp/tm-checklist-tools/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/tests/*sql.test.mjs`: **65 passed, zero failed**, including four new reporting authorization groups.
- `npm --prefix app run build`: passed.
- `npm --prefix app run build -- --base=/`: passed.
- `git diff --check`: passed.
- Independent code review: no actionable defects found.
- No lint/typecheck scripts exist in this JSX repository. Existing large-bundle warnings remain; dependencies/lockfile are unchanged.

The local UI harness covers loading/errors/retry, invalid ranges, repeated refresh, out-of-order responses, account changes, access guards, all-or-nothing scoring, filters and export. SQL tests execute the actual migrations against fictional in-memory PostgreSQL, including raw-answer/private-evidence denial, assigned-scope revocation, inactive/deleted/missing accounts, date bounds, draft/discarding/pilot statuses, zero-record sites and read-only invariance. These are not hosted Auth/PostgREST/Storage acceptance tests.

### Browser acceptance: isolated component passed on 2026-11-12

Manual browser acceptance passed in Microsoft Edge on macOS using the actual report component and built app CSS with fictional Auth/RPC services. The transferred archive was checked against its SHA-256 and all 365 manifest entries from PR head `4633cf488d4a8c7ea359fb9ef48727ccde38cabb` (tree `1a4d7b6c18f72e2a17b4cff48cbdb19cc5777ebf`). It was served only on loopback with external connections blocked; no hosted or production endpoint was used.

Verified:
- Daily and weekly all-or-nothing scores, missing/draft/pilot labels and the Monday–Sunday week.
- Date, market, location and status filtering; zero-record days included; summary denominator unchanged by status filtering.
- CSV downloaded and inspected: only the visible Fictional South row, no hidden Fictional North row.
- Empty-filter result disables export. A failed read removes scores and disables export; Refresh recovers after responses return.
- Invalid date range removes scores and disables Refresh/export. Back/Forward returns to the correct screen.
- Desktop and 390px iframe layouts visually inspected in light/dark mode; no page-level horizontal overflow; the table scrolls horizontally to completion/attention columns.
- Runtime error capture remained empty after the test-harness startup correction.

The first attempt exposed a harness-only defect: raw esbuild used classic JSX while Vite uses automatic JSX. The prepared browser script now sets `jsx: 'automatic'`. The manual Mac run used an equivalent QA-only React binding in the previously generated fixture; application source was not changed. The 18 affected utility/UI tests and production build passed again. The corrected full Playwright runner itself has not been run end-to-end: cloud Chromium remains socket-restricted. Screenshots were inspected during testing, not saved as deliverables.

This is isolated component acceptance, not full authenticated-application, real-device, Auth/PostgREST or Storage acceptance. Hosted permission tests remain required. The only connected nonproduction project, `tm-ops-dev`, was verified INACTIVE with no development branches on 2026-11-12; it was not restored or changed.

## Deployment boundary and remaining gates

**No production inspection, migration, data mutation, merge or deployment was performed. Keep the PR draft.** Review commits carry `[CF-Pages-Skip]` to suppress Cloudflare branch previews. Never merge a skip-marked commit as a substitute for a separately authorized release.

1. Confirm active reporting-site definition and review current production schema, time zones and checklist prerequisites. See [backend release plan](checklist-compliance-backend.md).
2. Complete hosted/nonproduction Auth/PostgREST tests for Admin/Store/AM, missing/inactive accounts and no broadened raw-answer/evidence access; check the full authenticated app and target devices.
3. Obtain separate database and application release authorization. Install/verify the additive RPC before releasing the client. Do not use a blind database push or assume a migration ledger.
4. Recovery: hide/revert only this reporting client; the unused read-only RPC can remain. Do not delete checklist data or roll back existing authorization/evidence migrations.

## Deferred follow-on work

QR access and editing submitted weekly checklists are not implemented in this reporting phase. Preserve the confirmed future rule: a submitted weekly checklist may be edited only on its submission day in the site's local time; an unfinished weekly draft may continue across multiple days. Existing submissions remain immutable until a separately reviewed server-enforced correction/audit design is implemented. No temporary workaround or client-only edit unlock was added.
