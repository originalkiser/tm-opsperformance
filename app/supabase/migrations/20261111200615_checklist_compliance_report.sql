-- REVIEW ONLY. Status-only reporting; no new obligations, backfill, or evidence access.
-- Prerequisites: companywide/weekly PM migrations; dashboard-created locations columns
-- name, market, timezone and exclude_from_reporting must be verified before release.
begin;

create or replace function checklist_private.compliance_summary(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 caller uuid := auth.uid();
 site_ids uuid[];
 result jsonb;
begin
 if caller is null or not exists (
  select 1 from public.user_profiles p where p.id=caller and p.is_active=true
   and p.deleted_at is null and p.role in ('admin','store','area_manager')
 ) then raise exception 'Active supported profile required' using errcode='42501'; end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_end<p_start or p_end-p_start>91 then
  raise exception 'Select a valid range of 1 to 92 calendar days' using errcode='22023';
 end if;
 -- There is no locations.is_active. Match existing !exclude_from_reporting behavior,
 -- including legacy NULL flags. Current reporting eligibility, not historical obligation.
 select coalesce(array_agg(l.id),'{}'::uuid[]) into site_ids
 from public.locations l join public.user_profiles p on p.id=caller
 where l.exclude_from_reporting is not true and (
  p.role='admin' or (p.role='store' and p.location_id=l.id) or
  (p.role='area_manager' and exists(select 1 from public.manager_locations m
    where m.manager_id=caller and m.location_id=l.id))
 );
 if exists(select 1 from public.locations l where l.id=any(site_ids)
  and (l.timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=l.timezone))) then
  raise exception 'Valid site time zone required for every reporting location' using errcode='22023';
 end if;
 with sites as materialized (
  select l.id,l.site_code,l.name,l.market,l.timezone,(now() at time zone l.timezone)::date local_today
  from public.locations l where l.id=any(site_ids)
 ), summaries as (
  select s.location_id,s.template_key,s.period_date,s.status,s.is_pilot
  from public.checklist_submissions s join sites l on l.id=s.location_id
  where s.period_date<=least(p_end,l.local_today) and (
   (s.template_key in ('opening','midday','closing') and s.period_date>=p_start) or
   (s.template_key in ('weekly','weekly_pm')
    and s.period_date>=date_trunc('week',p_start::timestamp)::date
    and extract(isodow from s.period_date)=1)
  )
 )
 select jsonb_build_object(
  'generated_at',now(),'range_start',p_start,'range_end',p_end,
  'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.site_code,l.id) from sites l),'[]'::jsonb),
  'submissions',coalesce((select jsonb_agg(to_jsonb(s) order by s.location_id,s.period_date,s.template_key) from summaries s),'[]'::jsonb)
 ) into result;
 return result;
end;
$$;
revoke all on function checklist_private.compliance_summary(date,date) from public,anon,authenticated;
grant execute on function checklist_private.compliance_summary(date,date) to authenticated;

-- One scalar JSON document avoids PostgREST's set-returning row cap. The exposed
-- invoker wrapper has no elevated privileges; the private helper enforces scope.
create or replace function public.get_checklist_compliance(p_start date,p_end date)
returns jsonb language sql stable security invoker set search_path='' as $$
 select checklist_private.compliance_summary(p_start,p_end);
$$;
revoke all on function public.get_checklist_compliance(date,date) from public,anon,authenticated;
grant execute on function public.get_checklist_compliance(date,date) to authenticated;
comment on function public.get_checklist_compliance(date,date) is
 'Read-only site-scoped checklist status summary. No answers, identities or evidence. Inclusive range capped at 92 days.';
notify pgrst,'reload schema';
commit;
