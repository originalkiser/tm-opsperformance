-- Correct October transition coverage to October 1–10. Apply once after migration15.
-- No balance, daily entry, historical value, audit row or security policy is changed.
begin;
lock table public.revenue_starting_balances in access exclusive mode;
do $$
begin
  if exists (select 1 from public.revenue_starting_balances
    where cutoff_business_date <> date '2026-10-10') then
    raise exception 'STOP: existing starting balances require verified October 1–10 amounts and an audited correction plan. No balances were changed.';
  end if;
end;
$$;
alter table public.revenue_starting_balances
  drop constraint revenue_starting_balances_cutoff_business_date_check;
alter table public.revenue_starting_balances
  alter column cutoff_business_date set default '2026-10-10',
  add constraint revenue_starting_balances_cutoff_business_date_check
    check (cutoff_business_date = date '2026-10-10');
commit;
