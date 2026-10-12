-- October 2026 transition only. No existing revenue, policies or rows changed.
begin;
create table public.revenue_starting_balances (
  location_id uuid primary key references public.locations(id),
  revenue_month date not null default '2026-10-01' check (revenue_month = '2026-10-01'),
  cutoff_business_date date not null default '2026-10-11' check (cutoff_business_date = '2026-10-11'),
  amount numeric(12,2) not null check (amount >= 0 and amount < 'Infinity'::numeric),
  verification_note text not null check (length(btrim(verification_note)) between 1 and 1000),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id)
);
create table public.revenue_starting_balance_audit (
  id bigint generated always as identity primary key,
  location_id uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid not null references auth.users(id),
  old_value jsonb,
  new_value jsonb not null
);
alter table public.revenue_starting_balances enable row level security;
alter table public.revenue_starting_balance_audit enable row level security;
revoke all on public.revenue_starting_balances, public.revenue_starting_balance_audit from anon, authenticated;
grant select, insert, update on public.revenue_starting_balances to authenticated;
grant select on public.revenue_starting_balance_audit to authenticated;
create policy starting_balance_read on public.revenue_starting_balances for select to authenticated using (true);
create policy starting_balance_admin_insert on public.revenue_starting_balances for insert to authenticated
  with check (exists(select 1 from public.user_profiles where id=auth.uid() and role='admin'));
create policy starting_balance_admin_update on public.revenue_starting_balances for update to authenticated
  using (exists(select 1 from public.user_profiles where id=auth.uid() and role='admin'))
  with check (exists(select 1 from public.user_profiles where id=auth.uid() and role='admin'));
create policy starting_balance_audit_admin_read on public.revenue_starting_balance_audit for select to authenticated
  using (exists(select 1 from public.user_profiles where id=auth.uid() and role='admin'));
create function public.stamp_revenue_starting_balance() returns trigger language plpgsql
set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Signed-in Admin required' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.location_id is distinct from old.location_id) then
    raise exception 'Starting balance location cannot change';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create function public.audit_revenue_starting_balance() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.revenue_starting_balance_audit(location_id,changed_by,old_value,new_value)
    values(new.location_id,auth.uid(),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end;
$$;
revoke all on function public.stamp_revenue_starting_balance(), public.audit_revenue_starting_balance() from public, anon, authenticated;
create trigger stamp_revenue_starting_balance before insert or update on public.revenue_starting_balances
  for each row execute function public.stamp_revenue_starting_balance();
create trigger audit_revenue_starting_balance after insert or update on public.revenue_starting_balances
  for each row execute function public.audit_revenue_starting_balance();
commit;
