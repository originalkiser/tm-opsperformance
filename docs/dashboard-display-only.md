# Dashboard display-only release

Changes: Today and current-MTD tables; genuine local reporting timestamps/No Update Yet; separate Last Refreshed fetch time; visible-tab 60-second refresh; numeric sorting, unavailable/provisional states, KPI colors and internal table scrolling; responsive navigation without changing existing role gates. The global date filter continues to control the other sections. Reporting market storage is separate from Site Entry storage.

Data uses existing AuthContext locations and ordinary daily_logs/budget_daily_entries SELECTs under existing RLS. No new company-location discovery, company-wide Store access, reporting RPC, migration21, role conversion, route changes, Edge Function changes or database/config files are included. Admin keeps its existing company view; Area Manager/Store retain exactly their existing assigned scopes. Store navigation remains My Dashboard/Snapshot as on main; this release does not introduce new Store navigation access. Missing or denied Budget data remains unavailable/provisional rather than bypassing RLS or fabricating totals.

Independently deployable with the current database. No database/Edge deployment is required. Review-branch commit uses [CF-Pages-Skip] to suppress Cloudflare previews; merge/deployment requires separate approval.
