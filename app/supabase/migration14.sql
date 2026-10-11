-- Daily revenue tracking. migration14.sql. Apply AFTER Kiser's security migrations12 and 13.
-- Additive and repeatable; preserves all historical MTD values and RLS.
-- NOT VALID retains existing legacy rows while checking future inserts/updates.
begin;
alter table public.budget_daily_entries
  add column if not exists yesterday_total_revenue numeric(12,2),
  add column if not exists yesterday_cc_revenue numeric(12,2),
  add column if not exists yesterday_house_revenue numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budget_daily_entries'::regclass
      and conname = 'budget_daily_revenue_valid'
  ) then
    alter table public.budget_daily_entries
      add constraint budget_daily_revenue_valid check (
        (yesterday_total_revenue is null and yesterday_cc_revenue is null and yesterday_house_revenue is null)
        or (
          yesterday_total_revenue is not null and yesterday_cc_revenue is not null and yesterday_house_revenue is not null
          and yesterday_total_revenue >= 0 and yesterday_cc_revenue >= 0 and yesterday_house_revenue >= 0
          and yesterday_cc_revenue + yesterday_house_revenue <= yesterday_total_revenue
          and yesterday_total_revenue < 'Infinity'::numeric
        )
      ) not valid;
  end if;
end;
$$;
commit;

