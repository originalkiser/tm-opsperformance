# Dashboard: Today's Performance and MTD Performance

Today's Performance replaces the Dashboard Network cards and day buttons with a compact sortable table. Each location uses its own current business date and the latest populated cumulative hourly Daily Log, breaking split-hour ties by split index. Totals never sum cumulative hourly rows. Opportunity formulas and location KPI thresholds remain in effect. Locations without reported data remain visible with unavailable metrics. Last Updated distinguishes successful refresh time from each site's latest saved log timestamp (shown in the site's timezone).

MTD Performance uses the existing Budget Tracking source selector: the latest eligible cumulative snapshot replaces covered Daily Logs. Missing, invalid or stale Budget snapshots remain unavailable/provisional; there is no fallback to partial hourly logs for Budget-enabled sites. Non-Budget sites retain Daily Log day totals. Existing completed-day cutoff, source details, exports, and company market/site filters remain. The global date filter continues to control other Dashboard sections; the performance tables explicitly use today/current MTD.

Both tables refresh every 60 seconds while the Dashboard tab is visible and when it regains visibility. Hidden tabs skip polling; overlapping requests are skipped, queries are paginated, and failed Daily Log pages cannot become partial company totals. Failed refreshes show an error while retaining the prior successful refresh timestamp. Collapsing a section unmounts its polling; reopening reloads it.

## Store / GM read scope

Here GM means the existing single-location `store` role, not `area_manager`. The Dashboard loads company locations into a separate reporting-only list. AuthContext's assigned locations, Site Entry selection and write checks, Admin routes, security policies, functions, and all entry/save code remain unchanged. Other Dashboard sections retain their prior assigned-location scope.

Important review limitation: repository SQL (`migration6.sql`) restricts Budget Tracking SELECT to `user_can_edit_location(location_id)`. A store account therefore may see every company location but cannot necessarily read other sites' Budget Tracking totals. The UI labels absent totals unavailable and never bypasses RLS or substitutes misleading partial logs. Complete company-wide GM MTD values require an independently approved read-access solution if production retains those policies. No database access or policy changes are included in this PR, and live GM cross-site data access has not been verified.

## Validation / release

Run the full Node suite and both Vite builds (default GitHub Pages base and Cloudflare `--base=/`). Added fictional-data checks cover cumulative/split-hour selection, zero member washes, missing/zero entries, timezone rollover, formulas, pagination failures, configured KPI colors, missing-site rows, sortable headers/order, responsive table containment, and preserving assigned-location entry scope. The existing refresh test covers the 60-second timer, hidden tabs, overlap prevention and cleanup. Existing Budget/cash/scoring/history regressions remain required.

No migrations, data changes, credential changes, backfills, or edge-function deployments. Keep this PR unmerged until reviewed. Both production hosts deploy automatically from main; Cloudflare also normally creates branch previews, so suppress branch previews when publishing a review branch if deployment is not authorized. Ensure the eventual approved merge commit does not contain a Cloudflare skip marker.
