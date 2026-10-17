-- REVIEW ONLY: Store company Dashboard counts; preserves Admin/Store/Area Manager roles.
-- Apply only after explicit approval and verification in an isolated database.
-- No raw-table grants, RLS policies, write helpers, stored data or settings change.
begin;

create or replace function public.dashboard_mtd_performance(
  p_location_ids uuid[], p_month_start date, p_through_date date
)
returns table (
  location_id uuid, entry_date date,
  mtd_washes integer, mtd_redemptions integer,
  mtd_basic integer, mtd_good integer, mtd_better integer, mtd_best integer,
  current_reviews integer
)
language plpgsql stable security definer
set search_path = ''
as $$
declare reporting_role text;
begin
  select p.role into reporting_role from public.user_profiles p
    where p.id=auth.uid() and p.is_active=true and p.deleted_at is null;
  if reporting_role is null or reporting_role not in ('admin','area_manager','store') then
    raise exception 'An active reporting account is required' using errcode = '42501';
  end if;

  if p_month_start is null or p_through_date is null
    or p_month_start <> date_trunc('month', p_month_start)::date
    or p_through_date < p_month_start
    or p_through_date >= (p_month_start + interval '1 month')::date
    or coalesce(cardinality(p_location_ids), 0) > 1000 then
    raise exception 'Invalid Dashboard reporting range' using errcode = '22023';
  end if;

  -- Deliberately privileged, narrow read projection. No cash, revenue, rating,
  -- author, notes, targets, reconciliation or audit fields leave this function.
  -- Only the latest eligible snapshot per site, never overlapping MTD rows.
  return query
    select distinct on (b.location_id)
      b.location_id, b.entry_date,
      b.mtd_washes, b.mtd_redemptions, b.mtd_basic, b.mtd_good,
      b.mtd_better, b.mtd_best, b.current_reviews
    from public.budget_daily_entries b
    join public.locations l on l.id = b.location_id
    where l.show_budget_tracking = true
      and b.location_id = any(p_location_ids)
      -- Retain Area Manager assignment scope; Store company counts grant no writes.
      and (reporting_role <> 'area_manager' or exists (
        select 1 from public.manager_locations m
        where m.manager_id=auth.uid() and m.location_id=b.location_id
      ))
      and b.entry_date >= p_month_start + 1
      and b.entry_date <= p_through_date + 1
      -- Missing/blank (including tabs/newlines) uses Chicago; valid zones are retained.
      -- Invalid nonblank identifiers are rejected by AT TIME ZONE (SQLSTATE 22023).
      -- Never expose today's partial/future business day as completed MTD.
      and b.entry_date <= (statement_timestamp() at time zone coalesce(nullif(btrim(l.timezone, E' \t\n\r\f\013'), ''), 'America/Chicago'))::date
    order by b.location_id, b.entry_date desc;
end;
$$;

-- Explicit trusted owner and fixed search_path are required for this narrow
-- SECURITY DEFINER boundary. Do not grant raw-table access to implement it.
alter function public.dashboard_mtd_performance(uuid[], date, date) owner to postgres;
revoke all on function public.dashboard_mtd_performance(uuid[], date, date) from public, anon;
grant execute on function public.dashboard_mtd_performance(uuid[], date, date) to authenticated;

commit;
