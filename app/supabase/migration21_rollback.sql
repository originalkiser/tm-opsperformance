-- Removes only the proposed Dashboard reporting endpoint. No data is changed.
-- Revert the client first, or it will report that company MTD is unavailable.
begin;
drop function if exists public.dashboard_mtd_performance(uuid[], date, date);
commit;
