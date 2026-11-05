-- REVIEW ONLY. Additive pilot; no existing operational tables, helpers or policies changed.
-- Apply only after production metadata/storage preflight, backup and separate authorization.
begin;
create schema checklist_private;
revoke all on schema checklist_private from public, anon, authenticated;
grant usage on schema checklist_private to authenticated;

create table public.checklist_templates (
 key text primary key check(key in ('opening','midday','closing','weekly')),
 name text not null, cadence text not null check(cadence in ('daily','weekly')),
 definition jsonb not null check(jsonb_typeof(definition)='array'),
 version integer not null default 1, updated_at timestamptz not null default now(),
 updated_by uuid references public.user_profiles(id)
);
create table public.checklist_pilot_access (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
 user_id uuid references public.user_profiles(id) on delete cascade, is_active boolean not null default true,
 enabled_from date not null, updated_at timestamptz not null default now()
);
create unique index checklist_pilot_access_scope on public.checklist_pilot_access(location_id,coalesce(user_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index checklist_pilot_access_user on public.checklist_pilot_access(user_id);
create table public.checklist_submissions (
 id uuid primary key default gen_random_uuid(), template_key text not null references public.checklist_templates(key),
 location_id uuid not null references public.locations(id), period_date date not null,
 created_by uuid not null references public.user_profiles(id), status text not null default 'draft' check(status in ('draft','submitted')),
 is_pilot boolean not null default true check(is_pilot), template_snapshot jsonb not null,
 answers jsonb not null default '{}'::jsonb, manager_name text not null default '',
 revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 submitted_at timestamptz, unique(location_id,template_key,period_date),
 check((status='submitted')=(submitted_at is not null))
);
create index checklist_submissions_actor on public.checklist_submissions(created_by);
create index checklist_submissions_period on public.checklist_submissions(period_date,location_id);
create table public.checklist_attachments (
 id uuid primary key, submission_id uuid not null references public.checklist_submissions(id),
 item_id text, kind text not null check(kind in ('photo','signature')), object_path text unique not null,
 created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
 check((kind='signature' and item_id is null) or (kind='photo' and item_id is not null))
);
create index checklist_attachments_submission on public.checklist_attachments(submission_id);

create function checklist_private.active_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active=true and p.deleted_at is null and p.role='admin');
$$;
create function checklist_private.assigned(p_location uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=p_user and p.is_active=true and p.deleted_at is null and
 (p.role='admin' or (p.role='store' and p.location_id=p_location) or
 (p.role='area_manager' and exists(select 1 from public.manager_locations m where m.manager_id=p.id and m.location_id=p_location))));
$$;
create function checklist_private.can_access(p_location uuid,p_date date default null) returns boolean
language sql stable security definer set search_path='' as $$
 select checklist_private.active_admin() or (checklist_private.assigned(p_location,(select auth.uid())) and exists(
 select 1 from public.checklist_pilot_access g join public.locations l on l.id=g.location_id
 where g.location_id=p_location and g.is_active and (g.user_id is null or g.user_id=(select auth.uid()))
 and g.enabled_from<=coalesce(p_date,(now() at time zone l.timezone)::date)));
$$;
create function checklist_private.can_read_submission(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.checklist_submissions s where s.id=p_id and
 (checklist_private.active_admin() or (s.created_by=(select auth.uid()) and checklist_private.can_access(s.location_id,s.period_date))));
$$;
-- Lock the draft before authorizing an upload: final submission and uploads serialize.
create function checklist_private.can_upload(p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare s public.checklist_submissions;
begin
 if p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$' then return false; end if;
 select * into s from public.checklist_submissions where id::text=split_part(p_path,'/',1) for share;
 return found and s.created_by=(select auth.uid()) and s.status='draft' and checklist_private.can_access(s.location_id,s.period_date);
end;
$$;

alter table public.checklist_templates enable row level security;
alter table public.checklist_pilot_access enable row level security;
alter table public.checklist_submissions enable row level security;
alter table public.checklist_attachments enable row level security;
revoke all on public.checklist_templates,public.checklist_pilot_access,public.checklist_submissions,public.checklist_attachments from public,anon,authenticated;
grant select on public.checklist_templates,public.checklist_pilot_access,public.checklist_submissions,public.checklist_attachments to authenticated;
create policy checklist_templates_read on public.checklist_templates for select to authenticated using
 (checklist_private.active_admin() or exists(select 1 from public.checklist_pilot_access g where checklist_private.can_access(g.location_id)));
create policy checklist_access_read on public.checklist_pilot_access for select to authenticated using
 (checklist_private.active_admin() or (is_active and (user_id is null or user_id=(select auth.uid())) and checklist_private.can_access(location_id)));
create policy checklist_submissions_read on public.checklist_submissions for select to authenticated using(checklist_private.can_read_submission(id));
create policy checklist_attachments_read on public.checklist_attachments for select to authenticated using(checklist_private.can_read_submission(submission_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('manager-checklist-evidence','manager-checklist-evidence',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy checklist_evidence_read on storage.objects for select to authenticated using
 (bucket_id='manager-checklist-evidence' and exists(select 1 from public.checklist_attachments a where a.object_path=name and checklist_private.can_read_submission(a.submission_id)));
create policy checklist_evidence_upload on storage.objects for insert to authenticated with check
 (bucket_id='manager-checklist-evidence' and checklist_private.can_upload(name));
-- Restrictive policies also protect this bucket if production already has broad permissive policies.
create policy checklist_evidence_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id is distinct from 'manager-checklist-evidence') with check(bucket_id is distinct from 'manager-checklist-evidence');
create policy checklist_evidence_select_guard on storage.objects as restrictive for select to authenticated using
 (bucket_id is distinct from 'manager-checklist-evidence' or exists(select 1 from public.checklist_attachments a where a.object_path=name and checklist_private.can_read_submission(a.submission_id)));
create policy checklist_evidence_insert_guard on storage.objects as restrictive for insert to authenticated with check
 (bucket_id is distinct from 'manager-checklist-evidence' or checklist_private.can_upload(name));
create policy checklist_evidence_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id is distinct from 'manager-checklist-evidence') with check(bucket_id is distinct from 'manager-checklist-evidence');
create policy checklist_evidence_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id is distinct from 'manager-checklist-evidence');
-- No client UPDATE/DELETE policies: evidence is append-only, including signatures.

create function public.save_checklist(p_template text,p_location uuid,p_date date,p_id uuid default null,
 p_revision integer default null,p_answers jsonb default '{}'::jsonb,p_name text default '',p_submit boolean default false)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.checklist_submissions; t public.checklist_templates; i jsonb; a jsonb; tz text; local_today date; expected_date date;
begin
 if not checklist_private.can_access(p_location,p_date) then raise exception 'Checklist pilot access required'; end if;
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
   values('checklist_submissions',s.location_id,s.period_date,auth.uid(),s.manager_name,'Pilot checklist submitted; MonitorQA remains official',null,jsonb_build_object('id',s.id,'template_key',s.template_key,'status',s.status,'is_pilot',s.is_pilot,'submitted_at',s.submitted_at));
 end if;
 return to_jsonb(s);
end;
$$;

create function public.attach_checklist_evidence(p_submission uuid,p_file uuid,p_item text,p_kind text,p_path text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.checklist_submissions; a public.checklist_attachments;
begin
 select * into strict s from public.checklist_submissions where id=p_submission for update;
 if not checklist_private.can_upload(p_path) or split_part(p_path,'/',1)<>p_submission::text or split_part(split_part(p_path,'/',2),'.',1)<>p_file::text then raise exception 'Draft evidence access required'; end if;
 if p_kind not in ('photo','signature') or p_kind is null then raise exception 'Invalid evidence kind'; end if;
 if (p_kind='signature' and p_item is not null) or (p_kind='photo' and not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') i where i->>'id'=p_item)) then raise exception 'Invalid evidence item'; end if;
 if not exists(select 1 from storage.objects where bucket_id='manager-checklist-evidence' and name=p_path) then raise exception 'Upload must complete before attachment'; end if;
 insert into public.checklist_attachments(id,submission_id,item_id,kind,object_path,created_by) values(p_file,p_submission,p_item,p_kind,p_path,auth.uid()) returning * into a;
 return to_jsonb(a);
end;
$$;

create function public.configure_checklist_pilot(p_action text,p_value jsonb)
 returns void language plpgsql security definer set search_path='' as $$
declare t public.checklist_templates; i jsonb; g public.checklist_pilot_access; loc uuid; person uuid; tz text; day date;
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
  loc:=(p_value->>'location_id')::uuid;person:=nullif(p_value->>'user_id','')::uuid;
  select timezone into strict tz from public.locations where id=loc;
  if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Valid site time zone required'; end if;
  if person is not null and not checklist_private.assigned(loc,person) then raise exception 'Pilot access cannot expand existing assignments'; end if;
  day:=(now() at time zone tz)::date;
  select * into g from public.checklist_pilot_access where location_id=loc and user_id is not distinct from person for update;
  if found then
   if (p_value->>'updated_at')::timestamptz is distinct from g.updated_at then raise exception 'Pilot access changed. Reload'; end if;
   update public.checklist_pilot_access set enabled_from=case when not is_active and (p_value->>'is_active')::boolean then day else enabled_from end,is_active=(p_value->>'is_active')::boolean,updated_at=clock_timestamp() where id=g.id;
  else
   insert into public.checklist_pilot_access(location_id,user_id,enabled_from,is_active) values(loc,person,day,(p_value->>'is_active')::boolean);
  end if;
  insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,old_values,new_values)
   values('checklist_pilot_access',loc,day,auth.uid(),(select name from public.user_profiles where id=auth.uid()),'Checklist pilot access changed',to_jsonb(g),(select to_jsonb(n) from public.checklist_pilot_access n where n.location_id=loc and n.user_id is not distinct from person));
 else raise exception 'Unknown checklist configuration action'; end if;
end;
$$;

-- Every new helper/function starts closed; grant only required predicates and RPCs.
revoke all on all functions in schema checklist_private from public,anon,authenticated;
grant execute on function checklist_private.active_admin(),checklist_private.can_access(uuid,date),checklist_private.can_read_submission(uuid),checklist_private.can_upload(text) to authenticated;
revoke all on function public.save_checklist(text,uuid,date,uuid,integer,jsonb,text,boolean),public.attach_checklist_evidence(uuid,uuid,text,text,text),public.configure_checklist_pilot(text,jsonb) from public,anon,authenticated;
grant execute on function public.save_checklist(text,uuid,date,uuid,integer,jsonb,text,boolean),public.attach_checklist_evidence(uuid,uuid,text,text,text),public.configure_checklist_pilot(text,jsonb) to authenticated;
insert into public.checklist_templates(key,name,cadence,definition) values ('opening','Opening Checklist','daily',$checklist$[
 {"id": "opening-1", "section": "Mechanical Room Actions", "text": "Turn air valve on air compressors, breakers, ball valves", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-2", "section": "Mechanical Room Actions", "text": "Turn control power on for conveyor", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-3", "section": "Mechanical Room Actions", "text": "Check chemical levels - fill to the line", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-4", "section": "Mechanical Room Actions", "text": "Check water levels on RO holding tanks (full)", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-5", "section": "Mechanical Room Actions", "text": "Turn on and check computers (POS, tunnel controller)", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-6", "section": "Mechanical Room Actions", "text": "Power pack hydraulic fluid at optimal levels?", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": true, "instruction": "Take Photo of the fluid gauge", "na_allowed": false},
 {"id": "opening-7", "section": "Mechanical Room Actions", "text": "Air compressor tanks drained of condensation?", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-8", "section": "Mechanical Room Actions", "text": "Inspect air compressor motor and belt for wear or oil leaks.", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-9", "section": "Tunnel Inspection", "text": "Check entry trap door (pull grates), inspect carriage for proper tension", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-10", "section": "Tunnel Inspection", "text": "Check exit trap door (pull grates) for signs of air leaks or debris", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-11", "section": "Tunnel Inspection", "text": "Check for leaks or debris under and around rotating equipment", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-12", "section": "Tunnel Inspection", "text": "Walk Tunnel and check for leaks and damage. Correct as necessary. Complete Tunnel Maintenance Daily at this time", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-13", "section": "Tunnel Inspection", "text": "From Tunnel Control Podium, run Wet Down, go to tunnel entrance and verify wet down. Listen for abnormal noises.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-14", "section": "Tunnel Inspection", "text": "Check for any signs of hydraulic fluid leaks near Heco drive (exit end of conveyor), spinning wraps, or any hose connections", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-15", "section": "Tunnel Inspection", "text": "Pull top brush down and spin it around to ensure no debris has wrapped around it from the prior day.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-16", "section": "Tunnel Inspection", "text": "Run ghost wash and complete tunnel walk board - listen for any unusual noises that may help detect an issue", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-17", "section": "Tunnel Inspection", "text": "Fill prep buckets", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-18", "section": "Property Actions", "text": "Inspect vacuum filter bags and ensure separators are empty", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-19", "section": "Property Actions", "text": "Turn vacuum systems on one at a time - walk lot and inspect hoses for proper suction and listen for air leaks", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-20", "section": "Property Actions", "text": "Ensure trash cans are prepped for opening", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-21", "section": "Property Actions", "text": "Detail center is stationed, stocked, organized, and cleaned - wash dirty towels", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-22", "section": "Property Actions", "text": "Ensure lot, landscaping, vacuum area, and all signage are clean and free of trash or debris.", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-23", "section": "Property Actions", "text": "Turn on Paystation/XPT, close entry gate and return switch to normal position.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-24", "section": "Property Actions", "text": "Make sure lobby area and bathroom are clean and well stocked with supplies.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-25", "section": "Property Actions", "text": "Are the vacuum separators and producers clean and empty?", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-26", "section": "Administrative Actions", "text": "Complete cash audit tracker and daily cash handling process", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-27", "section": "Administrative Actions", "text": "Complete rotation schedule for the day", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-28", "section": "Administrative Actions", "text": "Set daily/individual goals for the day", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-29", "section": "Administrative Actions", "text": "Execute Team Huddle", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-30", "section": "Administrative Actions", "text": "Turn open sign on and open entrance lanes", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "opening-31", "section": "Administrative Actions", "text": "Open up tunnel doors", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false}
]$checklist$::jsonb);
insert into public.checklist_templates(key,name,cadence,definition) values ('midday','Mid-Day Checklist','daily',$checklist$[
 {"id": "midday-1", "section": "Section", "text": "Are the tunnel floors clear of debris?", "type": "yesno", "options": ["Yes", "No"], "failure_values": ["No"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "midday-2", "section": "Section", "text": "Are the tunnel wraps and brushes clear of debris?", "type": "yesno", "options": ["Yes", "No"], "failure_values": ["No"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "midday-3", "section": "Section", "text": "Are all of the vacuum hoses and nozzles clear and unclogged?", "type": "yesno", "options": ["Yes", "No"], "failure_values": ["No"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "midday-4", "section": "Section", "text": "Do all of your vacuums have full suction?", "type": "yesno", "options": ["Yes", "No"], "failure_values": ["No"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "midday-5", "section": "Section", "text": "Are the waste bins in the vacuum lot overflowing?", "type": "choice", "options": ["Empty", "Half full", "Overflowing/needs to be emptied"], "failure_values": ["Overflowing/needs to be emptied"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false}
]$checklist$::jsonb);
insert into public.checklist_templates(key,name,cadence,definition) values ('closing','Closing Checklist','daily',$checklist$[
 {"id": "closing-1", "section": "Property Actions", "text": "Turn OFF Open Sign and close entrance lanes", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-2", "section": "Property Actions", "text": "Refill detail center chemicals, fold towels, stage detail center, and store in designated area", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-3", "section": "Property Actions", "text": "Empty all trash bins", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-4", "section": "Property Actions", "text": "Check every vacuum hose for clogs", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-5", "section": "Property Actions", "text": "Shut off vacuums, shake filters, and empty separator", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": true, "instruction": "Take photo(s) of clean/empty producer/separator basket(s)", "na_allowed": false},
 {"id": "closing-6", "section": "Property Actions", "text": "Empty prep buckets into the trench", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-7", "section": "Property Actions", "text": "Wash and fold towels - place for opening team. DO NOT leave towels in washer overnight.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-8", "section": "Property Actions", "text": "Pick up all trash and debris outside of the building, walk around the entire property.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-9", "section": "Property Actions", "text": "Leaf blow parking lot. Photo of clean lot.", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": true, "instruction": "", "na_allowed": false},
 {"id": "closing-10", "section": "Administrative Actions", "text": "If applicable, count and balance your cash drawer and store cash in safe", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": true},
 {"id": "closing-11", "section": "Administrative Actions", "text": "Lock all doors from office", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-12", "section": "Administrative Actions", "text": "Secure the site - Lock front and back door and set alarm system", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-13", "section": "Administrative Actions", "text": "Review GSR to evaluate that day's performance and what needs improvement tomorrow.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-14", "section": "Tunnel Actions", "text": "Pick up and throw away trash and debris from the tunnel (do not blow trash/debris into trench)", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-15", "section": "Tunnel Actions", "text": "Hose walls", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-16", "section": "Tunnel Actions", "text": "Complete tonight's Arch-a-Night section", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-17", "section": "Tunnel Actions", "text": "Close entry and exit overhead doors", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-18", "section": "Mechanical Room Actions", "text": "Shut ball valve from air compressors and drain air compressor of water", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "closing-19", "section": "Mechanical Room Actions", "text": "Are the hydraulic power packs operating with optimal fluid levels? Take a photo of the gauge(s)", "type": "passfail", "options": ["Passed", "Failed"], "failure_values": ["Failed"], "critical": true, "photo_required": true, "instruction": "", "na_allowed": false}
]$checklist$::jsonb);
insert into public.checklist_templates(key,name,cadence,definition) values ('weekly','Weekly Manager Administrative Checklist','weekly',$checklist$[
 {"id": "weekly-1", "section": "Financial & Deposits", "text": "All weekend deposits completed.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-2", "section": "Financial & Deposits", "text": "All Ramp receipts uploaded with itemized details.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-3", "section": "ADP", "text": "Timecards reviewed and approved.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-4", "section": "ADP", "text": "Employee schedule completed.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-5", "section": "ADP", "text": "Outstanding onboarding and performance reviews completed.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": true},
 {"id": "weekly-6", "section": "TM Ops", "text": "Budget Tracker completed, including missing entries.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-7", "section": "TM Ops", "text": "Dashboard Performance Review completed. How does the site compare with other locations?", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-8", "section": "TM Ops", "text": "Dashboard Team Performance reviewed. Are the right employees scheduled at the right times?", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-9", "section": "Communications Board", "text": "Latest biweekly newsletter posted.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": true, "instruction": "Current photo of the communications board required for this section.", "na_allowed": false},
 {"id": "weekly-10", "section": "Communications Board", "text": "Monthly webinar recap posted.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": true},
 {"id": "weekly-11", "section": "Communications Board", "text": "Employee schedule posted at least two weeks ahead.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-12", "section": "Communications Board", "text": "TM Ops Ownership Log Site Goals printed and posted.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-13", "section": "Membership Calendar Tracking Board", "text": "Confirm board is current.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": true, "instruction": "", "na_allowed": false},
 {"id": "weekly-14", "section": "Inventory & Customer Follow-Up", "text": "Chemical inventory completed.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-15", "section": "Inventory & Customer Follow-Up", "text": "Office supplies stocked and necessary items ordered.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": false},
 {"id": "weekly-16", "section": "Inventory & Customer Follow-Up", "text": "Outstanding damage claims followed up and customers updated.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": false, "photo_required": false, "instruction": "", "na_allowed": true}
]$checklist$::jsonb);
notify pgrst, 'reload schema';
commit;
