-- Editable October 2026 cutoffs. No revenue rows, audit history or policies changed.
-- Apply after migration16; never rerun earlier migrations.
begin;
alter table public.revenue_starting_balances
  drop constraint revenue_starting_balances_cutoff_business_date_check;
alter table public.revenue_starting_balances
  add constraint revenue_starting_balances_cutoff_business_date_check
  check (cutoff_business_date >= revenue_month
    and cutoff_business_date < (revenue_month + interval '1 month')::date);

-- Keep the existing invoker/search-path/identity protections and audit trigger.
-- A dynamic completed-day limit belongs in a write trigger, not a CHECK whose
-- validity would change with time. Site timezone matches the Admin editor.
create or replace function public.stamp_revenue_starting_balance() returns trigger language plpgsql
set search_path = '' as $$
declare
  business_timezone text;
  last_completed_date date;
begin
  if auth.uid() is null then raise exception 'Signed-in Admin required' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.location_id is distinct from old.location_id) then
    raise exception 'Starting balance location cannot change';
  end if;
  select coalesce(l.timezone, 'America/Chicago') into business_timezone
    from public.locations l where l.id=new.location_id;
  if business_timezone is null then raise exception 'Site unavailable for cutoff validation' using errcode='42501'; end if;
  last_completed_date := (clock_timestamp() at time zone business_timezone)::date - 1;
  if new.cutoff_business_date > last_completed_date then
    raise exception 'Cutoff cannot be later than the last completed business day at this site (%)', last_completed_date using errcode='23514';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
-- CREATE OR REPLACE retains the existing restricted function privileges.
commit;
