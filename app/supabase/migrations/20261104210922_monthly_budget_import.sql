-- DEVELOPMENT REVIEW ONLY. Existing data, policies and helpers are unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter table public.budget_targets alter column membership_goal drop not null;

-- One endpoint: read-only preview (default) or confirmed atomic import.
-- Decimal values travel as strings. No workbook or privileged key is stored.
create function public.import_monthly_budget(
  p_month date, p_sites jsonb, p_confirm boolean default false, p_expected text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor public.user_profiles%rowtype;
  s jsonb; d jsonb; loc public.locations%rowtype; old_target public.budget_targets%rowtype;
  new_target public.budget_targets%rowtype;
  old_daily jsonb; new_daily jsonb; before_state jsonb := '[]'; plan jsonb := '[]'; item jsonb;
  ids uuid[] := '{}'; codes text[] := '{}'; days integer; n integer; day_count integer;
  source_members integer; opening integer; growth numeric; goal integer;
  hours numeric; manager_hours numeric; percentage numeric; revenue numeric; daily_sum numeric;
  total numeric; retail numeric; recurring numeric; candidate numeric;
  signature text; changed integer := 0; replace_members boolean; keep_members boolean;
begin
  select * into actor from public.user_profiles p where p.id=auth.uid()
    and p.role='admin' and p.is_active=true and p.deleted_at is null for share;
  if actor.id is null then raise exception 'Active Admin required' using errcode='42501'; end if;
  if p_confirm is null or p_month is null or p_month<>date_trunc('month',p_month)::date
    or p_month<date '1900-01-01' or p_month>date '9999-12-01'
    or jsonb_typeof(p_sites) is distinct from 'array' then
    raise exception 'Invalid import month or payload' using errcode='22023';
  end if;
  if jsonb_array_length(p_sites) not between 1 and 200 then raise exception 'Invalid site count'; end if;
  if length(p_sites::text)>5000000 then raise exception 'Import payload exceeds size limit'; end if;
  days:=extract(day from p_month+interval '1 month'-interval '1 day')::integer;
  -- Short transaction locks protect preview comparisons and before/after audit.
  -- No actual entries are written, including when membership is approved.
  perform set_config('lock_timeout','3s',true);
  perform set_config('statement_timeout','30s',true);
  lock table public.locations in share mode;
  lock table public.budget_targets, public.budget_daily_revenue_goals in share row exclusive mode;
  lock table public.budget_daily_entries in share mode;

  for s in select value from jsonb_array_elements(p_sites) order by value->>'site' loop
    if s->>'site' is null or s->>'site' !~ '^\d{4}$' or s->>'site'=any(codes) then raise exception 'Invalid or duplicate site'; end if;
    codes:=array_append(codes,s->>'site');
    select count(*) into n from public.locations l where split_part(l.site_code,'-',1)=s->>'site';
    if n<>1 then raise exception 'Missing or ambiguous site %',s->>'site'; end if;
    select * into loc from public.locations l where split_part(l.site_code,'-',1)=s->>'site';
    if loc.show_budget_tracking is distinct from true or coalesce(loc.exclude_from_reporting,false) or loc.id=any(ids) then raise exception 'Site not eligible for Budget import'; end if;
    ids:=array_append(ids,loc.id);
    if jsonb_typeof(s->'daily') is distinct from 'array' then raise exception 'Missing daily goals'; end if;
    if jsonb_array_length(s->'daily')<>days then raise exception 'Incomplete daily goals'; end if;
    new_daily:='[]'; daily_sum:=0; day_count:=0;
    for d in select value from jsonb_array_elements(s->'daily') order by value->>'business_date' loop
      day_count:=day_count+1;
      if d->>'business_date' is distinct from (p_month+day_count-1)::text then raise exception 'Missing, duplicate or out-of-month business date'; end if;
      foreach signature in array array['total','retail','recurring'] loop
        if jsonb_typeof(d->signature) is distinct from 'string' or length(d->>signature)>220 or d->>signature !~ '^\d+(\.\d+)?$' then raise exception 'Daily goals require exact nonnegative decimal strings'; end if;
      end loop;
      total:=(d->>'total')::numeric; retail:=(d->>'retail')::numeric; recurring:=(d->>'recurring')::numeric;
      if abs(total-retail-recurring)>0.000001 then raise exception 'Daily revenue reconciliation failed'; end if;
      daily_sum:=daily_sum+total;
      new_daily:=new_daily||jsonb_build_array(jsonb_build_object('business_date',d->>'business_date',
        'total_revenue_goal',total,'retail_revenue_goal',retail,'recurring_revenue_goal',recurring));
    end loop;
    foreach signature in array array['hours','hours_with_manager','revenue_goal'] loop
      if jsonb_typeof(s->signature) is distinct from 'string' or length(s->>signature)>220 or s->>signature !~ '^\d+(\.\d+)?$' then raise exception 'Invalid monthly decimal values'; end if;
    end loop;
    hours:=(s->>'hours')::numeric; manager_hours:=(s->>'hours_with_manager')::numeric; revenue:=(s->>'revenue_goal')::numeric;
    if revenue<>daily_sum then raise exception 'Monthly revenue reconciliation failed'; end if;
    percentage:=null;
    if s->>'site' in ('1508','1511') then
      if jsonb_typeof(s->'percentage') is distinct from 'string' or length(s->>'percentage')>220 or s->>'percentage' !~ '^\d+(\.\d+)?$' then raise exception 'Missing full-service percentage'; end if;
      percentage:=(s->>'percentage')::numeric;
      if percentage>1 or hours<>0 or manager_hours<>0 then raise exception 'Invalid full-service labor method'; end if;
    elsif s->>'percentage' is not null or manager_hours<>hours+45 then raise exception 'Invalid Express weekly labor method'; end if;

    old_target:=null;
    select * into old_target from public.budget_targets t where t.location_id=loc.id and t.target_month=p_month;
    source_members:=null;
    select count(*) into n from public.budget_daily_entries e where e.location_id=loc.id and e.entry_date=p_month;
    if n>1 then raise exception 'Duplicate first-day membership entry'; end if;
    select e.mtd_membership_actual into candidate from public.budget_daily_entries e where e.location_id=loc.id and e.entry_date=p_month;
    if candidate is not null and (candidate<0 or candidate<>trunc(candidate) or candidate>2147483647) then raise exception 'Invalid first-day membership count'; end if;
    source_members:=candidate::integer;
    keep_members:=old_target.starting_members is not null or coalesce(old_target.membership_goal,0)>0;
    replace_members:=coalesce((s->>'replace_membership')::boolean,false);
    growth:=coalesce(old_target.membership_daily_growth,2);
    if growth<0 or growth>100000 or growth='NaN'::numeric then raise exception 'Invalid existing membership growth setting'; end if;
    if s ? 'opening_members' then
      if s->>'opening_members' is not null and (s->>'opening_members' !~ '^\d+$' or length(s->>'opening_members')>10) then raise exception 'Invalid approved opening membership'; end if;
      opening:=(s->>'opening_members')::integer;
    else opening:=source_members; end if;
    if keep_members and not replace_members then opening:=old_target.starting_members; goal:=old_target.membership_goal;
    else
      if keep_members and opening is null then raise exception 'An approved baseline cannot be cleared'; end if;
      goal:=case when opening is null then null else round(opening+growth*days)::integer end;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('business_date',g.business_date,
      'total_revenue_goal',g.total_revenue_goal,'retail_revenue_goal',g.retail_revenue_goal,
      'recurring_revenue_goal',g.recurring_revenue_goal) order by g.business_date),'[]'::jsonb)
      into old_daily from public.budget_daily_revenue_goals g where g.location_id=loc.id and g.business_date>=p_month and g.business_date<p_month+interval '1 month';
    item:=jsonb_build_object('site',s->>'site','location_id',loc.id,'existing',case when old_target.id is null then null else to_jsonb(old_target) end,
      'source_members',source_members,'source_entry_present',n=1,'daily_before',old_daily);
    before_state:=before_state||jsonb_build_array(item);
    plan:=plan||jsonb_build_array(item||jsonb_build_object('daily',new_daily,'revenue_goal',revenue::text,
      'hours',hours::text,'hours_with_manager',manager_hours::text,'percentage',percentage::text,
      'starting_members',opening,'membership_daily_growth',growth,'membership_goal',goal,'keep_membership',keep_members and not replace_members));
  end loop;
  -- Bind approval to database state AND the exact proposal/override decisions.
  signature:=md5(jsonb_build_object('before_state',before_state,'plan',plan,'proposal',p_sites)::text);
  if not p_confirm then return jsonb_build_object('fingerprint',signature,'state_fingerprint',md5(before_state::text),'month',p_month,'sites',plan); end if;
  if p_expected is distinct from signature then raise exception 'Budget, location, first-day membership or proposed import changed since preview; reopen preview' using errcode='40001'; end if;

  for item in select value from jsonb_array_elements(plan) loop
    select * into old_target from public.budget_targets t where t.location_id=(item->>'location_id')::uuid and t.target_month=p_month;
    insert into public.budget_targets as t (location_id,target_month,revenue_goal,labor_hours_non_salary,labor_hours_with_salary,
      full_service_labor_percentage,starting_members,membership_daily_growth,membership_goal,created_by)
    values ((item->>'location_id')::uuid,p_month,(item->>'revenue_goal')::numeric,(item->>'hours')::numeric,
      (item->>'hours_with_manager')::numeric,(item->>'percentage')::numeric,(item->>'starting_members')::integer,
      (item->>'membership_daily_growth')::numeric,(item->>'membership_goal')::integer,actor.id)
    on conflict(location_id,target_month) do update set
      revenue_goal=excluded.revenue_goal,labor_hours_non_salary=excluded.labor_hours_non_salary,labor_hours_with_salary=excluded.labor_hours_with_salary,
      full_service_labor_percentage=excluded.full_service_labor_percentage,starting_members=excluded.starting_members,
      membership_daily_growth=excluded.membership_daily_growth,membership_goal=excluded.membership_goal,updated_at=now()
    where (t.revenue_goal,t.labor_hours_non_salary,t.labor_hours_with_salary,t.full_service_labor_percentage,t.starting_members,t.membership_daily_growth,t.membership_goal)
      is distinct from (excluded.revenue_goal,excluded.labor_hours_non_salary,excluded.labor_hours_with_salary,excluded.full_service_labor_percentage,excluded.starting_members,excluded.membership_daily_growth,excluded.membership_goal);
    select * into new_target from public.budget_targets t where t.location_id=(item->>'location_id')::uuid and t.target_month=p_month;
    if (new_target.revenue_goal,new_target.labor_hours_non_salary,new_target.labor_hours_with_salary,
      new_target.full_service_labor_percentage,new_target.starting_members,new_target.membership_daily_growth,new_target.membership_goal)
      is distinct from ((item->>'revenue_goal')::numeric,(item->>'hours')::numeric,(item->>'hours_with_manager')::numeric,
      (item->>'percentage')::numeric,(item->>'starting_members')::integer,(item->>'membership_daily_growth')::numeric,(item->>'membership_goal')::integer)
      then raise exception 'Stored monthly targets differ from approved preview'; end if;
    if old_target.id is not null and
      (to_jsonb(old_target)-array['revenue_goal','labor_hours_non_salary','labor_hours_with_salary','full_service_labor_percentage','starting_members','membership_daily_growth','membership_goal','updated_at'])
      is distinct from (to_jsonb(new_target)-array['revenue_goal','labor_hours_non_salary','labor_hours_with_salary','full_service_labor_percentage','starting_members','membership_daily_growth','membership_goal','updated_at']) then raise exception 'Unrelated target fields changed'; end if;
    for d in select value from jsonb_array_elements(item->'daily') loop
      insert into public.budget_daily_revenue_goals as g (location_id,business_date,total_revenue_goal,retail_revenue_goal,recurring_revenue_goal)
      values ((item->>'location_id')::uuid,(d->>'business_date')::date,(d->>'total_revenue_goal')::numeric,(d->>'retail_revenue_goal')::numeric,(d->>'recurring_revenue_goal')::numeric)
      on conflict(location_id,business_date) do update set total_revenue_goal=excluded.total_revenue_goal,retail_revenue_goal=excluded.retail_revenue_goal,recurring_revenue_goal=excluded.recurring_revenue_goal
      where (g.total_revenue_goal,g.retail_revenue_goal,g.recurring_revenue_goal) is distinct from (excluded.total_revenue_goal,excluded.retail_revenue_goal,excluded.recurring_revenue_goal);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('business_date',g.business_date,
      'total_revenue_goal',g.total_revenue_goal,'retail_revenue_goal',g.retail_revenue_goal,
      'recurring_revenue_goal',g.recurring_revenue_goal) order by g.business_date),'[]'::jsonb)
      into new_daily from public.budget_daily_revenue_goals g where g.location_id=(item->>'location_id')::uuid
      and g.business_date>=p_month and g.business_date<p_month+interval '1 month';
    if new_daily is distinct from item->'daily' then raise exception 'Stored daily goals differ from approved preview'; end if;
    -- Audit before/after includes exact daily goals and baseline source; repeated
    -- identical imports do not touch timestamps or append duplicate audit records.
    if item->'daily_before' is distinct from item->'daily' or to_jsonb(old_target) is distinct from to_jsonb(new_target) then
      insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,old_values,new_values)
      values ('budget_targets',(item->>'location_id')::uuid,p_month,actor.id,coalesce(actor.name,actor.email,'Admin'),
        'Monthly budget import; '||case when item->>'starting_members' is null then 'Membership baseline pending' when (item->>'keep_membership')::boolean then 'Approved membership preserved' else 'Membership baseline approved; first-day source or Admin override' end,
        jsonb_build_object('target',item->'existing','daily_goals',item->'daily_before'),
        jsonb_build_object('target',to_jsonb(new_target),'daily_goals',item->'daily','baseline_entry_date',p_month,'baseline_source_count',item->'source_members','membership_preserved',item->'keep_membership'));
      changed:=changed+1;
    end if;
  end loop;
  return jsonb_build_object('month',p_month,'sites',jsonb_array_length(plan),'daily_records',jsonb_array_length(plan)*days,'changed_sites',changed,
    'pending_membership',(select count(*) from jsonb_array_elements(plan) e where e->>'starting_members' is null));
end;
$$;
alter function public.import_monthly_budget(date,jsonb,boolean,text) owner to postgres;
revoke all on function public.import_monthly_budget(date,jsonb,boolean,text) from public, anon;
grant execute on function public.import_monthly_budget(date,jsonb,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
