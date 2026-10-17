# Dashboard: Today's Performance and MTD Performance

Today's Performance replaces the Dashboard Network cards and day buttons with a compact sortable table. Each location uses its own current business date and the latest populated cumulative hourly Daily Log, breaking split-hour ties by split index. Totals never sum cumulative hourly rows. Opportunity formulas and location KPI thresholds remain in effect. Locations without reported data remain visible with unavailable metrics. Last Refreshed identifies fetch time; Last Updated shows each site's genuine saved reporting timestamp in local time. Missing current-day reports show No Update Yet.

MTD Performance uses the existing Budget Tracking source selector: the latest eligible cumulative snapshot replaces covered Daily Logs. Missing, invalid or stale Budget snapshots remain unavailable/provisional; there is no fallback to partial hourly logs for Budget-enabled sites. Non-Budget sites retain Daily Log day totals. Existing completed-day cutoff, source details, exports, and company market/site filters remain. The global date filter continues to control other Dashboard sections; the performance tables explicitly use today/current MTD.

Both tables refresh every 60 seconds while the Dashboard tab is visible and when it regains visibility. Hidden tabs skip polling; overlapping requests are skipped, queries are paginated, and failed Daily Log pages cannot become partial company totals. Failed refreshes show an error while retaining the prior successful refresh timestamp. Collapsing a section unmounts its polling; reopening reloads it.

## Store / GM read scope

Here GM means the `store` role. In the local two-role model Store entry scope includes primary and explicitly assigned additional locations. The Dashboard loads company locations into a separate reporting-only list. AuthContext's operational assignment scope remains separate from reporting visibility. Site Entry ignores reporting filters; Admin routes require Admin. Database RLS remains authoritative. Other Dashboard sections retain their prior assigned-location scope.

A narrow company-read RPC is now proposed in migration21.sql, with rollback and an isolated-verification plan in [gm-mtd-read-access.md](gm-mtd-read-access.md). It exposes only MTD performance counts and review count, without expanding raw-table or write access. Dashboard MTD opts into this endpoint. It passed development SQL/security and authenticated browser validation. Production compatibility and separately approved installation remain release blockers.

## Validation / release

Run the full Node suite and both Vite builds (default GitHub Pages base and Cloudflare `--base=/`). Added fictional-data checks cover cumulative/split-hour selection, zero member washes, missing/zero entries, timezone rollover, formulas, pagination failures, configured KPI colors, missing-site rows, sortable headers/order, responsive table containment, and preserving assigned-location entry scope. The existing refresh test covers the 60-second timer, hidden tabs, overlap prevention and cleanup. Existing Budget/cash/scoring/history regressions remain required.

Migration21 and its rollback are included for production review; development installation is verified. Production migrations, account conversions and Edge Function deployments remain unapproved. Keep this PR unmerged until reviewed. Both production hosts deploy automatically from main; Cloudflare also normally creates branch previews, so suppress branch previews when publishing a review branch if deployment is not authorized. Ensure the eventual approved merge commit does not contain a Cloudflare skip marker.
