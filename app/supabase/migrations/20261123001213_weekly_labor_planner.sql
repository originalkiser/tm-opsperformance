begin;

create schema labor_planner_private;
revoke all on schema labor_planner_private from public, anon, authenticated;

create table labor_planner_private.drafts (
  location_id uuid not null references public.locations(id),
  week_start date not null check (extract(dow from week_start) = 0),
  revision integer not null default 1 check (revision > 0),
  plan jsonb not null,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (location_id, week_start)
);

create table labor_planner_private.full_service_caps (
  location_id uuid not null references public.locations(id),
  week_start date not null check (extract(dow from week_start) = 0),
  hours numeric not null check (hours > 0 and hours <= 2000),
  approved_by uuid not null,
  primary key (location_id, week_start)
);

alter table labor_planner_private.drafts enable row level security;
alter table labor_planner_private.full_service_caps enable row level security;
revoke all on all tables in schema labor_planner_private from public, anon, authenticated;

create function labor_planner_private.site_role(p_location uuid) returns text
language sql stable set search_path = '' as $$
  select p.role::text from public.user_profiles p
  where p.id = auth.uid() and p.is_active is true and p.deleted_at is null
    and (p.role = 'admin' or (p.role = 'store' and p.location_id = p_location))
    and exists (select 1 from public.locations l where l.id = p_location);
$$;
revoke all on function labor_planner_private.site_role(uuid) from public, anon, authenticated;

create function public.weekly_labor_planner(p_location uuid, p_week date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if labor_planner_private.site_role(p_location) is null then
    raise exception 'Location access denied' using errcode = '42501';
  end if;
  if p_week is null or extract(dow from p_week) <> 0 then raise exception 'Select a Sunday'; end if;
  select jsonb_build_object(
    'network', (select s.value from public.app_settings s where s.key = 'operating_hours'),
    'location', jsonb_build_object('timezone', l.timezone, 'operating_hours_override', l.operating_hours_override),
    'target', (select jsonb_build_object('labor_hours_non_salary', t.labor_hours_non_salary,
      'labor_hours_with_salary', t.labor_hours_with_salary, 'full_service_labor_percentage', t.full_service_labor_percentage)
      from public.budget_targets t where t.location_id = p_location
        and t.target_month = date_trunc('month', p_week::timestamp)::date),
    'cap', (select c.hours from labor_planner_private.full_service_caps c where c.location_id = p_location and c.week_start = p_week),
    'draft', (select jsonb_build_object('plan', d.plan, 'revision', d.revision)
      from labor_planner_private.drafts d where d.location_id = p_location and d.week_start = p_week)
  ) into result from public.locations l where l.id = p_location;
  return result;
end;
$$;

create function public.save_weekly_labor_plan(p_location uuid, p_week date, p_revision integer, p_plan jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  next_revision integer;
  current_budget jsonb;
  prior_budget jsonb;
  submitted_budget jsonb := p_plan#>'{inputs,budget}';
begin
  if labor_planner_private.site_role(p_location) is null then
    raise exception 'Location access denied' using errcode = '42501';
  end if;
  if p_week is null or extract(dow from p_week) <> 0 or p_revision is null or p_revision < 0
    or jsonb_typeof(p_plan) is distinct from 'object'
    or octet_length(p_plan::text) > 180000
    or jsonb_typeof(p_plan->'shifts') is distinct from 'array'
    or jsonb_typeof(p_plan->'inputs') is distinct from 'object'
    or jsonb_typeof(submitted_budget) is distinct from 'object' then
    raise exception 'Invalid schedule draft';
  end if;
  if jsonb_array_length(p_plan->'shifts') > 300 then raise exception 'Too many shifts'; end if;
  if jsonb_typeof(p_plan#>'{inputs,hours,monSat}') is distinct from 'object'
    or jsonb_typeof(p_plan#>'{inputs,hours,sun}') is distinct from 'object'
    or jsonb_typeof(p_plan#>'{inputs,settings}') is distinct from 'object'
    or jsonb_typeof(p_plan#>'{inputs,traffic}') is distinct from 'object'
    or coalesce(p_plan#>>'{inputs,trafficEnd}', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or not isfinite((p_plan#>>'{inputs,trafficEnd}')::date)
    or coalesce(p_plan#>>'{inputs,timezone}', '') = ''
    or coalesce(p_plan#>>'{inputs,settings,prep}', '') !~ '^[0-9]{1,3}$'
    or (p_plan#>>'{inputs,settings,prep}')::integer > 120
    or coalesce(p_plan#>>'{inputs,settings,middayStart}', '') !~ '^[0-9]{1,4}$'
    or coalesce(p_plan#>>'{inputs,settings,middayEnd}', '') !~ '^[0-9]{1,4}$'
    or coalesce(p_plan#>>'{inputs,settings,peak}', '') !~ '^[0-9]{1,4}$'
  then raise exception 'Invalid planning inputs'; end if;
  if exists (
    select 1 from jsonb_each(p_plan#>'{inputs,traffic}') t
    where jsonb_typeof(t.value->'average') is distinct from 'number'
      or jsonb_typeof(t.value->'samples') is distinct from 'number'
  ) then raise exception 'Invalid traffic summary'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_plan->'shifts') s
    where jsonb_typeof(s) is distinct from 'object'
      or coalesce(s->>'day', '') !~ '^[0-6]$'
      or jsonb_typeof(s->'day') is distinct from 'number'
      or coalesce(s->>'role', '') !~ '^(GM|AGM|TL [12]|CWA [1-9][0-9]{0,3})$'
      or coalesce(jsonb_typeof(s->'employeeId'), '') <> 'string'
      or exists (
        select 1 from unnest(array['start','end','adminStart','breakStart']) as field
        where s->field <> 'null'::jsonb and (
          jsonb_typeof(s->field) <> 'number' or s->>field !~ '^[0-9]{1,4}$' or (s->>field)::integer > case when field = 'end' then 1440 else 1439 end
        )
      )
  ) then raise exception 'Invalid shift fields'; end if;

  select jsonb_build_object('method', case when t.full_service_labor_percentage is null then 'hours' else 'percentage' end,
    'hourly', case when t.full_service_labor_percentage is null then t.labor_hours_non_salary end,
    'combined', case when t.full_service_labor_percentage is null then t.labor_hours_with_salary else c.hours end,
    'percentage', t.full_service_labor_percentage)
  into current_budget
  from public.locations l
  left join public.budget_targets t on t.location_id = l.id and t.target_month = date_trunc('month', p_week::timestamp)::date
  left join labor_planner_private.full_service_caps c on c.location_id = l.id and c.week_start = p_week
  where l.id = p_location;
  select d.plan#>'{inputs,budget}' into prior_budget from labor_planner_private.drafts d
  where d.location_id = p_location and d.week_start = p_week and d.revision = p_revision;
  if p_revision > 0 and prior_budget is null then
    raise exception 'Draft changed in another session. Reload before saving.' using errcode = '40001';
  end if;
  if submitted_budget is distinct from current_budget and submitted_budget is distinct from prior_budget then
    raise exception 'Labor targets changed or are invalid. Reload before saving.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_plan->'shifts') s
    where nullif(s->>'employeeId', '') is not null
      and not exists (select 1 from public.employees e where e.id::text = s->>'employeeId' and e.location_id = p_location)
  ) then raise exception 'An assigned employee is outside this location' using errcode = '42501'; end if;

  if p_revision = 0 then
    insert into labor_planner_private.drafts(location_id, week_start, plan, updated_by)
    values (p_location, p_week, p_plan, auth.uid()) on conflict do nothing
    returning revision into next_revision;
  else
    update labor_planner_private.drafts d
    set plan = p_plan, revision = d.revision + 1, updated_by = auth.uid(), updated_at = now()
    where d.location_id = p_location and d.week_start = p_week and d.revision = p_revision
    returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'Draft changed in another session. Reload before saving.' using errcode = '40001'; end if;
  return next_revision;
end;
$$;

create function public.approve_weekly_labor_cap(p_location uuid, p_week date, p_hours numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
begin
  if labor_planner_private.site_role(p_location) is distinct from 'admin' then
    raise exception 'Only authorized Admin accounts can approve a cap' using errcode = '42501';
  end if;
  if p_week is null or extract(dow from p_week) <> 0 or not exists (
    select 1 from public.budget_targets t where t.location_id = p_location
      and t.target_month = date_trunc('month', p_week::timestamp)::date and t.full_service_labor_percentage is not null
  ) then raise exception 'Select a full-service site and a Sunday'; end if;
  insert into labor_planner_private.full_service_caps(location_id, week_start, hours, approved_by)
  values (p_location, p_week, p_hours, auth.uid())
  on conflict (location_id, week_start) do update set hours = excluded.hours, approved_by = excluded.approved_by;
  return p_hours;
end;
$$;

revoke all on function public.weekly_labor_planner(uuid,date), public.save_weekly_labor_plan(uuid,date,integer,jsonb),
  public.approve_weekly_labor_cap(uuid,date,numeric) from public, anon, authenticated;
grant execute on function public.weekly_labor_planner(uuid,date), public.save_weekly_labor_plan(uuid,date,integer,jsonb),
  public.approve_weekly_labor_cap(uuid,date,numeric) to authenticated;

commit;
