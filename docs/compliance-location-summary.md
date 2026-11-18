# Checklist Compliance location summaries

UI/reporting-only change based on current main after PR #72. No migration, backend scoring, authorization, template or evidence changes.

Default report: Daily WTD, one collapsed row per eligible location. Each row uses the existing summarizeCompliance function over existing buildComplianceRows results, showing compliant/eligible period counts and the overall percentage. Status filters restrict detail rows/CSV but do not inflate summary percentages. Expansion never affects CSV contents.

LW selects the previous complete Monday–Sunday week; WTD selects Monday through each site's local today; MTD selects the first through local today. The existing authenticated RPC supplies server local_today and weekly scores/deadlines. Requests span the union of site ranges, then each site's rows are limited to its own range. The server snapshot corrects the initial client clock anchor. Weekly views include whole Monday–Sunday periods intersecting selected dates, including a preceding-month Monday when applicable. Manual daily ranges and the manual week selector remain available in the collapsed filter panel.

Pending is a display label for open incomplete periods; their existing zero score and eligibility remain unchanged. Future periods remain excluded. New-policy weekly scores continue to come from the server, including permanent Completed Late zero credit; earlier weekly completion-only behavior and existing Daily 3/3 behavior are retained. No alternate scoring formula or raw-table fallback was added.

Validation: 20 focused unit checks (existing compliance/weekly tests plus site-local rollover, month/week intersection, aggregation, pending/future, mixed historical/new weekly scoring). Isolated actual-page browser checks use fictional fixtures and block non-local requests: all 20 collapsed Admin rows, one Store site, inactive denial, shortcuts/manual dates, expansion, filters, detailed CSV and desktop/mobile light/dark with no horizontal overflow. Production build passed with inherited duplicate-title and bundle-size warnings.

Targeted read-only production compatibility check: existing three-argument RPC succeeded under authenticated Admin permissions for all 20 sites. Current WTD baseline was 19/60 compliant Daily periods and 8/20 historical Weekly periods; no new-policy rows apply before November 23. These are live snapshot counts, not frozen operational data. Existing source is reused without database writes. No broad suite was repeated.
