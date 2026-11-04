-- PRIVATE REVIEW ARTIFACT. Confirm production qbdvixxooofdlfurcpqy in Dashboard.
-- Do not execute without separate approval. Approval requires a captured private
-- before-image. Weekly labor field semantics are confirmed.
-- Default is blocked AND rolled back. Only an approved copy may enable the gate
-- and replace the final ROLLBACK with COMMIT. No retries on an error.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local tm_ops.november_import_approved = 'false';
do $$ begin
  if current_user <> 'postgres'
    or current_setting('tm_ops.november_import_approved', true) is distinct from 'true' then
    raise exception 'Separate production import approval is required';
  end if;
end $$;
-- Prevent intervening target edits while taking the before-image and updating.
lock table public.budget_targets, public.budget_daily_revenue_goals in share row exclusive mode;
lock table public.locations in share mode;

create temp table november_daily_source on commit drop as
with /* SOURCE_CTES */
select d.site, l.id as location_id, d.business_date::date as business_date,
 d.total_goal::numeric as total_revenue_goal,
 d.retail_goal::numeric as retail_revenue_goal,
 d.recurring_goal::numeric as recurring_revenue_goal,
 m.hours::numeric as hours, m.hours_with_manager::numeric as hours_with_manager,
 m.percentage::numeric as percentage, m.revenue_goal::numeric as revenue_goal,
 m.was_existing::boolean as was_existing,
 b.starting_members::integer as starting_members,
 b.evidence::text as evidence
from daily d join monthly m on m.site=d.site
left join public.locations l on split_part(l.site_code, '-', 1)=d.site
left join baselines b on b.site=d.site
where not coalesce(l.exclude_from_reporting, false) and coalesce(l.show_budget_tracking,false);

do $$ begin
  if (select count(*) from november_daily_source) <> 600
    or (select count(distinct location_id) from november_daily_source) <> 20
    or exists (select 1 from november_daily_source where location_id is null
        or business_date < date '2026-11-01' or business_date > date '2026-11-30')
    or exists (select 1 from november_daily_source group by location_id,business_date having count(*)<>1)
    or (select sum(total_revenue_goal) from november_daily_source) <> /* TOTAL_CONTROL */::numeric then
    raise exception 'Source coverage/mapping/control changed; stop';
  end if;
  if exists (
    select 1 from (select distinct location_id,was_existing from november_daily_source) s
    left join public.budget_targets t on t.location_id=s.location_id and t.target_month=date '2026-11-01'
    where s.was_existing <> (t.location_id is not null)
  ) then raise exception 'November target existence differs from reviewed 10/10 inventory'; end if;

end $$;

create temp table november_targets_before on commit drop as
select t.* from public.budget_targets t
where t.target_month=date '2026-11-01'
  and t.location_id in (select location_id from november_daily_source);
create temp table november_daily_before on commit drop as
select t.* from public.budget_daily_revenue_goals t
join november_daily_source s using(location_id,business_date);

-- Capture this result privately before any approved commit; it is the precise
-- pre-import snapshot. No actual-performance rows are read or changed.
select jsonb_build_object(
 'monthly_before', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from november_targets_before t),
 'daily_before', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from november_daily_before t)
) as private_rollback_snapshot;

insert into public.budget_daily_revenue_goals
 (location_id,business_date,total_revenue_goal,retail_revenue_goal,recurring_revenue_goal)
select location_id,business_date,total_revenue_goal,retail_revenue_goal,recurring_revenue_goal
from november_daily_source
on conflict(location_id,business_date) do update set
 total_revenue_goal=excluded.total_revenue_goal,
 retail_revenue_goal=excluded.retail_revenue_goal,
 recurring_revenue_goal=excluded.recurring_revenue_goal;

update public.budget_targets t set
 revenue_goal=s.revenue_goal,
 labor_hours_non_salary=s.hours,
 labor_hours_with_salary=s.hours_with_manager,
 full_service_labor_percentage=s.percentage,
 starting_members=coalesce(s.starting_members,t.starting_members),
 membership_daily_growth=case when s.starting_members is not null then 2 else t.membership_daily_growth end,
 membership_goal=case when s.starting_members is not null then s.starting_members+60 else t.membership_goal end,
 updated_at=now()
from (select distinct location_id,revenue_goal,hours,hours_with_manager,percentage,starting_members
      from november_daily_source where was_existing) s
where t.location_id=s.location_id and t.target_month=date '2026-11-01'
 and (t.revenue_goal,t.labor_hours_non_salary,t.labor_hours_with_salary,t.full_service_labor_percentage,
      t.starting_members,t.membership_daily_growth,t.membership_goal)
   is distinct from (s.revenue_goal,s.hours,s.hours_with_manager,s.percentage,
      coalesce(s.starting_members,t.starting_members),
      case when s.starting_members is not null then 2 else t.membership_daily_growth end,
      case when s.starting_members is not null then s.starting_members+60 else t.membership_goal end);

-- Missing membership values NEVER fall through to membership_goal DEFAULT 0.
insert into public.budget_targets
 (location_id,target_month,revenue_goal,labor_hours_non_salary,labor_hours_with_salary,
  full_service_labor_percentage,starting_members,membership_daily_growth,membership_goal)
select distinct location_id,date '2026-11-01',revenue_goal,hours,hours_with_manager,
 percentage,starting_members,2,starting_members+60
from november_daily_source
where not was_existing and starting_members is not null and nullif(btrim(evidence),'') is not null;

insert into public.edit_audit_log
 (table_name,location_id,period,changed_by_name,summary,old_values,new_values)
select 'budget_targets',t.location_id,date '2026-11-01','Approved workbook SQL import',
 'November budget import. Workbook SHA-256: ' || /* SOURCE_HASH */ || '. '
   || case when b.location_id is null then 'New target. '
           else 'Official November opening balance replaces prior membership values. ' end
   || coalesce('Opening-count evidence: ' || s.evidence,''),
 to_jsonb(b),to_jsonb(t)
from public.budget_targets t
join (select distinct location_id,evidence from november_daily_source) s on s.location_id=t.location_id
left join november_targets_before b on b.location_id=t.location_id
where t.target_month=date '2026-11-01' and to_jsonb(t) is distinct from to_jsonb(b);

do $$ begin
  if exists (
    select 1 from november_daily_source s
    left join public.budget_daily_revenue_goals t using(location_id,business_date)
    where (t.total_revenue_goal,t.retail_revenue_goal,t.recurring_revenue_goal)
      is distinct from (s.total_revenue_goal,s.retail_revenue_goal,s.recurring_revenue_goal)
  ) or exists (
    select 1 from november_targets_before b
    join public.budget_targets t on t.location_id=b.location_id and t.target_month=b.target_month
    where (to_jsonb(t) - array['revenue_goal','labor_hours_non_salary','labor_hours_with_salary',
       'full_service_labor_percentage','updated_at','starting_members','membership_daily_growth','membership_goal'])
      is distinct from (to_jsonb(b) - array['revenue_goal','labor_hours_non_salary','labor_hours_with_salary',
       'full_service_labor_percentage','updated_at','starting_members','membership_daily_growth','membership_goal'])
  ) or exists (
    select 1 from (select distinct location_id,starting_members,was_existing,revenue_goal,hours,hours_with_manager,percentage from november_daily_source) s
    left join public.budget_targets t on t.location_id=s.location_id and t.target_month=date '2026-11-01'
    where (s.was_existing or s.starting_members is not null) and
      (t.location_id is null
       or (t.revenue_goal,t.labor_hours_non_salary,t.labor_hours_with_salary,t.full_service_labor_percentage)
         is distinct from (s.revenue_goal,s.hours,s.hours_with_manager,s.percentage)
       or (s.starting_members is not null and
         (t.starting_members,t.membership_daily_growth,t.membership_goal)
           is distinct from (s.starting_members,2,s.starting_members+60)))
  ) or exists (
    select 1 from november_targets_before b
    join public.budget_targets t on t.location_id=b.location_id and t.target_month=b.target_month
    join (select distinct location_id,starting_members from november_daily_source) s on s.location_id=b.location_id
    where s.starting_members is null and (t.starting_members,t.membership_daily_growth,t.membership_goal)
      is distinct from (b.starting_members,b.membership_daily_growth,b.membership_goal)
  ) then raise exception 'Imported budget/membership or preserved unrelated-field verification failed'; end if;
  if /* MEMBERSHIP_START_CONTROL */::bigint is not null and (
    (select count(*) from public.budget_targets where target_month=date '2026-11-01'
       and location_id in(select location_id from november_daily_source)) <> 20
    or (select sum(starting_members) from public.budget_targets where target_month=date '2026-11-01'
       and location_id in(select location_id from november_daily_source)) is distinct from /* MEMBERSHIP_START_CONTROL */::bigint
    or (select sum(membership_goal) from public.budget_targets where target_month=date '2026-11-01'
       and location_id in(select location_id from november_daily_source)) is distinct from /* MEMBERSHIP_EOM_CONTROL */::bigint
  ) then raise exception 'Membership network controls failed'; end if;
end $$;

select jsonb_build_object(
 'daily_records', (select count(*) from public.budget_daily_revenue_goals
   where business_date between date '2026-11-01' and date '2026-11-30'
     and location_id in(select location_id from november_daily_source)),
 'total_revenue_goal', (select round(sum(total_revenue_goal),2) from november_daily_source),
 'membership_starting_total', (select sum(starting_members) from public.budget_targets
   where target_month=date '2026-11-01' and location_id in(select location_id from november_daily_source)),
 'membership_eom_total', (select sum(membership_goal) from public.budget_targets
   where target_month=date '2026-11-01' and location_id in(select location_id from november_daily_source)),
 'monthly_before', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from november_targets_before t),
 'daily_before', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from november_daily_before t),
 'monthly_after', (select jsonb_agg(to_jsonb(t)) from public.budget_targets t
   where t.target_month=date '2026-11-01' and t.location_id in(select location_id from november_daily_source)),
 'deferred_sites', (select coalesce(jsonb_agg(site order by site),'[]'::jsonb)
   from (select distinct site from november_daily_source where not was_existing and starting_members is null) d)
) as private_import_result;
rollback;
