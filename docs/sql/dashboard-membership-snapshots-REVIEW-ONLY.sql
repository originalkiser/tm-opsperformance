-- REVIEW ONLY: new read-only Dashboard projection. Not installed.
-- No existing endpoint, table values, RLS, grants or write helpers are changed.
begin;
create function public.dashboard_membership_snapshots(
 p_location_ids uuid[], p_month_start date, p_through_date date
) returns table(location_id uuid, starting_members integer, active_members integer, covered_through date)
language plpgsql stable security definer set search_path='' as $$
declare reporting_role text;
begin
 select p.role into reporting_role from public.user_profiles p
 where p.id=auth.uid() and p.is_active=true and p.deleted_at is null;
 if reporting_role is null or reporting_role not in('admin','store','area_manager') then
  raise exception 'An active reporting account is required' using errcode='42501';
 end if;
 if p_month_start is null or p_through_date is null
  or p_month_start<>date_trunc('month',p_month_start)::date
  or p_through_date<p_month_start or p_through_date>=(p_month_start+interval '1 month')::date
  or coalesce(cardinality(p_location_ids),0)>1000 then
  raise exception 'Invalid membership reporting range' using errcode='22023';
 end if;
 return query
 select l.id,
  case when t.starting_members>=0 then t.starting_members end,
  case when latest.mtd_membership_actual>=0 then latest.mtd_membership_actual end,
  latest.entry_date-1
 from public.locations l
 left join public.budget_targets t on t.location_id=l.id and t.target_month=p_month_start
 left join lateral (
  -- Match existing MTD coverage: an entry made today covers through yesterday.
  -- Keep the actual latest snapshot even if its membership count is missing;
  -- do not silently replace it with an older, apparently valid headcount.
  select b.entry_date,b.mtd_membership_actual from public.budget_daily_entries b
  where b.location_id=l.id and b.entry_date>=p_month_start+1 and b.entry_date<=p_through_date+1
   and b.entry_date<=(statement_timestamp() at time zone
    coalesce(nullif(btrim(l.timezone,E' \t\n\r\f\013'),''),'America/Chicago'))::date
  order by b.entry_date desc limit 1
 ) latest on true
 where l.id=any(p_location_ids) and l.show_budget_tracking=true
  and not coalesce(l.exclude_from_reporting,false)
  and (reporting_role<>'area_manager' or exists(
   select 1 from public.manager_locations m where m.manager_id=auth.uid() and m.location_id=l.id));
end;
$$;
alter function public.dashboard_membership_snapshots(uuid[],date,date) owner to postgres;
revoke all on function public.dashboard_membership_snapshots(uuid[],date,date) from public,anon;
grant execute on function public.dashboard_membership_snapshots(uuid[],date,date) to authenticated;
commit;
