-- REVIEW ONLY: never convert unknown membership goals to zero for rollback.
-- Revert the importer UI first. Retain NULL-safe reporting if pending rows exist.
begin;
set local lock_timeout = '3s';
lock table public.budget_targets in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.budget_targets where membership_goal is null) then
    raise exception 'Pending membership goals exist. Keep the nullable column and NULL-safe application; review verified resolutions before schema rollback.';
  end if;
end $$;
drop function public.import_monthly_budget(date,jsonb,boolean,text);
alter table public.budget_targets alter column membership_goal set not null;
notify pgrst, 'reload schema';
commit;
