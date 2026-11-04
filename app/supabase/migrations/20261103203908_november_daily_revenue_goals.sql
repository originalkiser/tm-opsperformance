-- REVIEW ONLY. Apply only with separate production approval.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.budget_daily_revenue_goals (
  location_id uuid not null references public.locations(id),
  business_date date not null,
  total_revenue_goal numeric not null,
  retail_revenue_goal numeric not null,
  recurring_revenue_goal numeric not null,
  primary key (location_id, business_date),
  constraint budget_daily_revenue_goals_finite_nonnegative check (
    total_revenue_goal >= 0 and total_revenue_goal < 'Infinity'::numeric
    and retail_revenue_goal >= 0 and retail_revenue_goal < 'Infinity'::numeric
    and recurring_revenue_goal >= 0 and recurring_revenue_goal < 'Infinity'::numeric
  )
);
alter table public.budget_daily_revenue_goals enable row level security;
-- Do not inherit broad client grants from public-schema default privileges.
revoke all on public.budget_daily_revenue_goals from public, anon, authenticated;
grant select on public.budget_daily_revenue_goals to authenticated;
create policy budget_daily_revenue_goals_select
  on public.budget_daily_revenue_goals for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.is_active = true and p.deleted_at is null
        and (
          p.role in ('admin', 'store')
          or (p.role = 'area_manager'
              and public.user_can_edit_location(budget_daily_revenue_goals.location_id))
        )
    )
    and exists (
      select 1 from public.locations l
      where l.id = budget_daily_revenue_goals.location_id
        and l.show_budget_tracking = true
        and not coalesce(l.exclude_from_reporting, false)
    )
  );
-- No client write policies/grants: changes use the separately approved SQL import.

alter table public.budget_targets
  add column full_service_labor_percentage numeric
  constraint budget_targets_full_service_labor_percentage_range
  check (full_service_labor_percentage >= 0 and full_service_labor_percentage <= 1);
comment on column public.budget_targets.full_service_labor_percentage is
  'Non-null selects percentage budgeting. Existing zero hour fields are not an allowance for these rows. Effective month is target_month.';

notify pgrst, 'reload schema';
commit;
