-- REVIEW ONLY. Production inspection completed read-only on 2026-11-09.
-- Availability only; no enrollment, obligations, notifications or data backfill.
begin;

create or replace function checklist_private.can_access(p_location uuid,p_date date default null) returns boolean
language sql stable security definer set search_path='' as $$
 select checklist_private.assigned(p_location,(select auth.uid()));
$$;

-- The template predicate must not depend on unrelated locations-table SELECT grants/RLS.
create function checklist_private.can_read_templates() returns boolean
language sql stable security definer set search_path='' as $$
 select checklist_private.active_admin() or exists(select 1 from public.locations l where checklist_private.can_access(l.id));
$$;
revoke all on function checklist_private.can_read_templates() from public,anon,authenticated;
grant execute on function checklist_private.can_read_templates() to authenticated;
alter policy checklist_templates_read on public.checklist_templates using
 (checklist_private.can_read_templates());

-- Keep historical rows unchanged. Only new drafts default to non-pilot.
alter table public.checklist_submissions drop constraint checklist_submissions_is_pilot_check;
alter table public.checklist_submissions alter column is_pilot set default false;

create or replace function public.configure_checklist_pilot(p_action text,p_value jsonb)
 returns void language plpgsql security definer set search_path='' as $$
declare t public.checklist_templates; i jsonb;
begin
 if not checklist_private.active_admin() then raise exception 'Active Admin required'; end if;
 if p_action='template' then
  select * into strict t from public.checklist_templates where key=p_value->>'key' for update;
  if (p_value->>'version')::integer is distinct from t.version then raise exception 'Template changed. Reload before saving'; end if;
  if jsonb_typeof(p_value->'definition') is distinct from 'array' or jsonb_array_length(p_value->'definition')<>jsonb_array_length(t.definition) or octet_length((p_value->'definition')::text)>200000 then raise exception 'Invalid template definition'; end if;
  for i in select * from jsonb_array_elements(p_value->'definition') loop
   -- Fixed IDs, response choices, critical designations, N/A permissions and sections: only question wording and evidence rules are editable.
   if not exists(select 1 from jsonb_array_elements(t.definition) old where
     old->>'id'=i->>'id' and old-'text'-'photo_required'-'instruction'-'explanation_required'-'photo_on_failure' = i-'text'-'photo_required'-'instruction'-'explanation_required'-'photo_on_failure')
     or jsonb_typeof(i->'text') is distinct from 'string' or btrim(coalesce(i->>'text',''))='' or length(i->>'text')>2000 or jsonb_typeof(i->'photo_required') is distinct from 'boolean'
     or (i ? 'instruction' and jsonb_typeof(i->'instruction') is distinct from 'string') or length(coalesce(i->>'instruction',''))>2000 or (i ? 'explanation_required' and jsonb_typeof(i->'explanation_required') is distinct from 'boolean') or (i ? 'photo_on_failure' and jsonb_typeof(i->'photo_on_failure') is distinct from 'boolean') then raise exception 'Invalid template item'; end if;
  end loop;
  if (select count(distinct entry->>'id') from jsonb_array_elements(p_value->'definition') entry)<>jsonb_array_length(t.definition) then raise exception 'Duplicate template items'; end if;
  if (select jsonb_agg(entry->>'id' order by n) from jsonb_array_elements(p_value->'definition') with ordinality x(entry,n)) is distinct from (select jsonb_agg(entry->>'id' order by n) from jsonb_array_elements(t.definition) with ordinality x(entry,n)) then raise exception 'Preserve approved question order'; end if;
  update public.checklist_templates set definition=p_value->'definition',version=version+1,updated_at=now(),updated_by=auth.uid() where key=t.key;
 elsif p_action='access' then
  raise exception 'Pilot grant changes are disabled; existing site assignments control checklist access';
 else raise exception 'Unknown checklist configuration action'; end if;
end;
$$;

create or replace function public.save_checklist(p_template text,p_location uuid,p_date date,p_id uuid default null,
 p_revision integer default null,p_answers jsonb default '{}'::jsonb,p_name text default '',p_submit boolean default false)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.checklist_submissions; t public.checklist_templates; i jsonb; a jsonb; tz text; local_today date; expected_date date;
begin
 if not checklist_private.can_access(p_location,p_date) then raise exception 'Assigned checklist location required'; end if;
 select timezone into tz from public.locations where id=p_location;
 if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Valid site time zone required'; end if;
 local_today:=(now() at time zone tz)::date;
 select * into strict t from public.checklist_templates where key=p_template;
 expected_date:=case when t.cadence='weekly' then date_trunc('week',p_date::timestamp)::date else p_date end;
 if p_date is null or p_date<>expected_date or p_date>local_today then raise exception 'Invalid checklist business date/week'; end if;
 if jsonb_typeof(p_answers)<>'object' or p_answers is null or octet_length(p_answers::text)>200000 or length(p_name)>200 then raise exception 'Invalid checklist answers or name'; end if;
 if p_id is null then
  if p_submit then raise exception 'Save a draft and evidence before submitting'; end if;
  insert into public.checklist_submissions(template_key,location_id,period_date,created_by,template_snapshot,answers,manager_name)
   values(p_template,p_location,p_date,auth.uid(),jsonb_build_object('name',t.name,'cadence',t.cadence,'version',t.version,'timezone',tz,'definition',t.definition),p_answers,coalesce(p_name,'')) returning * into s;
  return to_jsonb(s);
 end if;
 select * into strict s from public.checklist_submissions where id=p_id for update;
 if s.created_by<>auth.uid() or s.location_id<>p_location or s.template_key<>p_template or s.period_date<>p_date then raise exception 'Draft owner or occurrence mismatch'; end if;
 if s.status<>'draft' then raise exception 'Submitted checklists are immutable'; end if;
 if p_revision is distinct from s.revision then raise exception 'Draft changed elsewhere. Reload before saving'; end if;
 if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') entry where entry->>'id'=k)) then raise exception 'Unknown answer item'; end if;
 for i in select * from jsonb_array_elements(s.template_snapshot->'definition') loop
  a:=p_answers->(i->>'id');
  if a is not null and (jsonb_typeof(a)<>'object' or length(coalesce(a->>'explanation',''))>4000 or
    (coalesce(a->>'value','')<>'' and not ((i->'options') ? (a->>'value') or ((i->>'na_allowed')::boolean and a->>'value'='N/A')))) then raise exception 'Invalid answer: %',i->>'id'; end if;
  if p_submit then
   if a is null or coalesce(a->>'value','')='' then raise exception 'Required response: %',i->>'text'; end if;
   if (coalesce((i->>'explanation_required')::boolean,false) or (i->'failure_values') ? (a->>'value') or a->>'value'='N/A') and btrim(coalesce(a->>'explanation',''))='' then raise exception 'Explanation required: %',i->>'text'; end if;
   if ((i->>'photo_required')::boolean or (coalesce((i->>'photo_on_failure')::boolean,false) and (i->'failure_values') ? (a->>'value'))) and not exists(select 1 from public.checklist_attachments e join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=e.object_path where e.submission_id=s.id and e.kind='photo' and e.item_id=i->>'id') then raise exception 'Photo required: %',i->>'text'; end if;
  end if;
 end loop;
 if p_submit then
  if btrim(coalesce(p_name,''))='' then raise exception 'Manager full name required'; end if;
  if not exists(select 1 from public.checklist_attachments e join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=e.object_path where e.submission_id=s.id and e.kind='signature') then raise exception 'Drawn signature required'; end if;
 end if;
 update public.checklist_submissions set answers=p_answers,manager_name=btrim(coalesce(p_name,'')),revision=revision+1,
 status=case when p_submit then 'submitted' else 'draft' end,submitted_at=case when p_submit then now() else null end,updated_at=now() where id=s.id returning * into s;
 if p_submit then
  insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,old_values,new_values)
   values('checklist_submissions',s.location_id,s.period_date,auth.uid(),s.manager_name,'Checklist submitted; MonitorQA remains official',null,jsonb_build_object('id',s.id,'template_key',s.template_key,'status',s.status,'is_pilot',s.is_pilot,'submitted_at',s.submitted_at));
 end if;
 return to_jsonb(s);
end;
$$;

notify pgrst,'reload schema';
commit;
