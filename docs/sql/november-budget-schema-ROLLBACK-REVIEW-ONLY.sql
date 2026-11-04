-- REVIEW ONLY. Revert dependent application first. Separate approval required.
-- Data-bearing rollback requires a private export and reviewed data restoration;
-- this file deliberately refuses to discard imported budgets.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $$ begin
  if exists (select 1 from public.budget_daily_revenue_goals)
    or exists (select 1 from public.budget_targets
               where full_service_labor_percentage is not null) then
    raise exception 'Budget data exists. Export it and review data rollback before removing schema.';
  end if;
end $$;
drop table public.budget_daily_revenue_goals;
alter table public.budget_targets drop column full_service_labor_percentage;
notify pgrst, 'reload schema';
commit;
