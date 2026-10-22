-- REVIEW ONLY. Revert/disable the new frontend caller before approved removal.
-- No source data, original RPC, policies or table grants change.
begin;
drop function public.dashboard_membership_snapshots(uuid[],date,date);
commit;
