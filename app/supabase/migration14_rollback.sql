-- Only if the revenue constraint needs rollback. Keep additive columns/data.
-- Never undo migration12, security migration13 or any security fix when reverting this feature.
begin;
alter table public.budget_daily_entries
  drop constraint if exists budget_daily_revenue_valid;
commit;

