-- LOCAL REVIEW ONLY. No hosted execution authorized by this file.
-- Apply after PR61's occurrence-deadline migration. Adds only two authenticated audits.
-- Existing templates, QR grants, submissions, history, evidence and reporting are not rewritten.
begin;
alter table public.checklist_templates drop constraint checklist_templates_key_check;
alter table public.checklist_templates add constraint checklist_templates_key_check
 check(key in ('opening','midday','closing','weekly','weekly_pm','monthly_site_assessment','quarterly_safety_audit'));
alter table public.checklist_templates drop constraint checklist_templates_cadence_check;
alter table public.checklist_templates add constraint checklist_templates_cadence_check
 check(cadence in ('daily','weekly','monthly','quarterly'));

-- A future template is authenticated-only unless explicitly added to this allowlist.
create function checklist_private.qr_template_allowed(p_key text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_key in ('opening','midday','closing','weekly','weekly_pm'),false);
$$;
create function checklist_private.period_start(p_cadence text,p_date date) returns date
language sql immutable set search_path='' as $$
 select case p_cadence when 'weekly' then date_trunc('week',p_date::timestamp)::date
 when 'monthly' then date_trunc('month',p_date::timestamp)::date
 when 'quarterly' then date_trunc('quarter',p_date::timestamp)::date else p_date end;
$$;
create function checklist_private.period_end(p_cadence text,p_date date,p_timezone text) returns timestamptz
language sql stable set search_path='' as $$
 select (case p_cadence
 when 'monthly' then date_trunc('month',p_date::timestamp)+interval '1 month'
 when 'quarterly' then date_trunc('quarter',p_date::timestamp)+interval '3 months'
 else (p_date+case when p_cadence='weekly' then 7 else 1 end)::timestamp end) at time zone p_timezone;
$$;
revoke all on function checklist_private.qr_template_allowed(text),checklist_private.period_start(text,date),checklist_private.period_end(text,date,text) from public,anon,authenticated,service_role;


create or replace function checklist_private.actor_allowed(s public.checklist_submissions,p_actor uuid,p_guest uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_guest is not null then checklist_private.qr_template_allowed(s.template_key) and p_actor is null and exists(select 1 from checklist_private.qr_grants g where g.id=p_guest and g.is_active and g.location_id=s.location_id)
 else p_actor is not null and checklist_private.assigned(s.location_id,p_actor) and (s.created_by is not distinct from p_actor or (not p_write and exists(select 1 from public.user_profiles u where u.id=p_actor and u.role='admin'))) end;
$$;

create or replace function checklist_private.deadline(s public.checklist_submissions) returns timestamptz
language sql stable set search_path='' as $$
 select case when s.submitted_at is not null then
 checklist_private.period_end(s.template_snapshot->>'cadence',s.period_date,s.template_snapshot->>'timezone') else null end;
$$;

create or replace function checklist_private.validate_answers(s public.checklist_submissions,p_answers jsonb,p_name text,p_submit boolean,p_work uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare i jsonb; a jsonb; ids uuid[];
begin
 if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>200000 or p_name is null or length(p_name)>200 then raise exception 'Invalid checklist answers or name'; end if;
 if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') e where e->>'id'=k)) then raise exception 'Unknown answer item'; end if;
 ids:=checklist_private.evidence_ids(s,p_work);
 for i in select * from jsonb_array_elements(s.template_snapshot->'definition') loop
  a:=p_answers->(i->>'id');
  if i ? 'condition' and (p_answers->(i->'condition'->>'item_id')->>'value') is distinct from (i->'condition'->>'value') then continue; end if;
  if a is not null and (jsonb_typeof(a)<>'object' or length(coalesce(a->>'explanation',''))>4000 or
   (i->>'type'='text' and (jsonb_typeof(a->'value') is distinct from 'string' or length(a->>'value')>4000)) or
   (coalesce(a->>'value','')<>'' and not (i->>'type'='text' or (i->'options') ? (a->>'value') or (coalesce((i->>'na_allowed')::boolean,false) and a->>'value'='N/A')))) then raise exception 'Invalid answer: %',i->>'id'; end if;
  if p_submit then
   if (i->>'type' is distinct from 'text' or coalesce((i->>'required')::boolean,true)) and (a is null or btrim(coalesce(a->>'value',''))='') then raise exception 'Required response: %',i->>'text'; end if;
   if (coalesce((i->>'explanation_required')::boolean,false) or (i->'failure_values') ? (a->>'value') or a->>'value'='N/A') and btrim(coalesce(a->>'explanation',''))='' then raise exception 'Explanation required: %',i->>'text'; end if;
   if coalesce((i->>'signature_required')::boolean,false) and not exists(select 1 from public.checklist_attachments e join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=e.object_path where e.id=any(ids) and e.kind='signature' and e.item_id=i->>'id') then raise exception 'Item signature required: %',i->>'text'; end if;
   if (coalesce((i->>'photo_required')::boolean,false) or (coalesce((i->>'photo_on_failure')::boolean,false) and (i->'failure_values') ? (a->>'value'))) and not exists(select 1 from public.checklist_attachments e join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=e.object_path where e.id=any(ids) and e.kind='photo' and e.item_id=i->>'id') then raise exception 'Photo required: %',i->>'text'; end if;
  end if;
 end loop;
 if p_submit then
  if btrim(p_name)='' then raise exception 'Manager full name required'; end if;
  if not exists(select 1 from public.checklist_attachments e join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=e.object_path where e.id=any(ids) and e.kind='signature' and e.item_id is null and (p_work is null or e.working_copy_id=p_work)) then raise exception 'A new drawn final signature is required'; end if;
 end if;
end;
$$;

create or replace function checklist_private.access_action(p_actor uuid,p_hash text,p_action text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g checklist_private.qr_grants; s public.checklist_submissions; t public.checklist_templates; w checklist_private.working_copies; u checklist_private.upload_intents;
 loc uuid; ts timestamptz; tz text; day date; d date; n integer; ids uuid[]; a public.checklist_attachments; result jsonb; is_admin boolean; off integer;
begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>220000 then raise exception 'Invalid request'; end if;
 if p_hash is not null then
  if p_actor is not null then raise exception 'Ambiguous checklist actor' using errcode='42501'; end if;
  select * into g from checklist_private.qr_grants where token_hash=p_hash and is_active for share;
  if not found then raise exception 'QR access expired or revoked' using errcode='42501'; end if;
  insert into checklist_private.qr_rate(grant_id,window_start,requests) values(g.id,date_trunc('minute',clock_timestamp()),1)
  on conflict(grant_id) do update set window_start=excluded.window_start,requests=case when checklist_private.qr_rate.window_start=excluded.window_start then checklist_private.qr_rate.requests+1 else 1 end returning requests into n;
  if n>120 then raise exception 'Too many requests. Wait a minute before trying again' using errcode='54000'; end if;
 elsif p_actor is null or not exists(select 1 from public.user_profiles where id=p_actor and is_active=true and deleted_at is null and role in ('admin','store','area_manager')) then raise exception 'Active account required' using errcode='42501'; end if;
 is_admin:=p_actor is not null and exists(select 1 from public.user_profiles where id=p_actor and role='admin');
 if p_action in ('qr_status','qr_rotate','qr_revoke') then
  if not is_admin then raise exception 'Active Admin required' using errcode='42501'; end if;
  loc:=(p_body->>'location_id')::uuid;
  -- Serialize absent-grant creation without conflicting with guest INSERT's location FK KEY SHARE.
  perform 1 from public.locations where id=loc for no key update;
  if not found then raise exception 'Location unavailable'; end if;
  if p_action<>'qr_status' then
   select * into g from checklist_private.qr_grants where location_id=loc for update;
   if (p_body->>'expected_generation')::integer is distinct from coalesce(g.generation,0) then raise exception 'QR access changed elsewhere. Reload before changing it' using errcode='PT409'; end if;
  end if;
  if p_action='qr_rotate' then
   if coalesce(p_body->>'token_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
   insert into checklist_private.qr_grants(location_id,token_hash,created_by) values(loc,p_body->>'token_hash',p_actor)
   on conflict(location_id) do update set token_hash=excluded.token_hash,generation=checklist_private.qr_grants.generation+1,is_active=true,rotated_at=clock_timestamp() returning * into g;
  elsif p_action='qr_revoke' then update checklist_private.qr_grants set is_active=false,generation=generation+1,rotated_at=clock_timestamp() where location_id=loc returning * into g;
  else select * into g from checklist_private.qr_grants where location_id=loc; end if;
  if p_action<>'qr_status' then
   insert into public.edit_audit_log(table_name,location_id,period,changed_by,summary,new_values) values('checklist_qr_access',loc,current_date,p_actor,case when p_action='qr_rotate' then 'Checklist site QR created or rotated' else 'Checklist site QR revoked' end,jsonb_build_object('grant_id',g.id,'generation',g.generation,'is_active',g.is_active));
  end if;
  return jsonb_build_object('grant',case when g.id is null then null else to_jsonb(g)-'token_hash'-'created_by' end);
 end if;
 if p_action='context' then
  loc:=case when g.id is not null then g.location_id else (p_body->>'location_id')::uuid end;
  if g.id is null and checklist_private.assigned(loc,p_actor) is not true then raise exception 'Assigned location required' using errcode='42501'; end if;
  select timezone into tz from public.locations where id=loc;
  if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Valid site time zone required'; end if;
  day:=(clock_timestamp() at time zone tz)::date;off:=coalesce((p_body->>'offset')::integer,0);
  if off<0 or off>10000 then raise exception 'Invalid page'; end if;
  select coalesce(jsonb_agg(x.row order by x.created_at desc,x.id),'[]'::jsonb) into result from (
   select to_jsonb(c)||jsonb_build_object('working_copy_id',(select wc.id from checklist_private.working_copies wc where wc.submission_id=c.id and wc.status='editing' and clock_timestamp()<checklist_private.deadline(c))) row,c.created_at,c.id from public.checklist_submissions c where c.location_id=loc and checklist_private.actor_allowed(c,p_actor,g.id,false)
    and (c.status in ('draft','discarding') or c.period_date=day or (c.template_key in ('weekly','weekly_pm') and c.period_date=date_trunc('week',day::timestamp)::date)
      or (c.template_key='monthly_site_assessment' and c.period_date=date_trunc('month',day::timestamp)::date)
      or (c.template_key='quarterly_safety_audit' and c.period_date=date_trunc('quarter',day::timestamp)::date)
      or exists(select 1 from checklist_private.working_copies wc where wc.submission_id=c.id and wc.status='editing' and clock_timestamp()<checklist_private.deadline(c))) order by c.created_at desc,c.id offset off limit 101
  ) x;
  return jsonb_build_object('location',(select jsonb_build_object('id',id,'site_code',site_code,'timezone',timezone) from public.locations where id=loc),
   'templates',(select jsonb_agg(to_jsonb(ct) order by ct.key) from public.checklist_templates ct where g.id is null or checklist_private.qr_template_allowed(ct.key)),
   'submissions',case when jsonb_array_length(result)>100 then result-100 else result end,'has_more',jsonb_array_length(result)>100,'next_offset',off+100,'server_now',clock_timestamp());
 end if;
 if p_action='start' then
  loc:=case when g.id is not null then g.location_id else (p_body->>'location_id')::uuid end;
  if g.id is null and checklist_private.assigned(loc,p_actor) is not true then raise exception 'Assigned location required' using errcode='42501'; end if;
  select timezone into tz from public.locations where id=loc;
  if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Valid site time zone required'; end if;
  select * into strict t from public.checklist_templates where key=p_body->>'template_key';
  if g.id is not null and not checklist_private.qr_template_allowed(t.key) then raise exception 'Authenticated checklist access required' using errcode='42501'; end if;
  if t.key in ('monthly_site_assessment','quarterly_safety_audit') and not exists(select 1 from public.locations where id=loc and exclude_from_reporting is not true) then raise exception 'Eligible audit location required' using errcode='42501'; end if;
  day:=(clock_timestamp() at time zone tz)::date;
  d:=coalesce((p_body->>'period_date')::date,checklist_private.period_start(t.cadence,day));
  if not isfinite(d) or d>day or d is distinct from checklist_private.period_start(t.cadence,d) then raise exception 'Invalid checklist business date/week'; end if;
  -- Guests start current periods; existing older drafts are resumed by immutable ID.
  if g.id is not null and d<>(checklist_private.period_start(t.cadence,day)) then raise exception 'Start the current checklist period'; end if;
  insert into public.checklist_submissions(template_key,location_id,period_date,created_by,created_by_guest,template_snapshot,answers,manager_name)
   values(t.key,loc,d,p_actor,g.id,jsonb_build_object('name',t.name,'cadence',t.cadence,'version',t.version,'timezone',tz,'definition',t.definition),coalesce(p_body->'answers','{}'::jsonb),coalesce(p_body->>'manager_name','')) returning * into s;
  perform checklist_private.validate_answers(s,s.answers,s.manager_name,false);
  return checklist_private.reply(s,p_actor,g.id);
 end if;
 select * into s from public.checklist_submissions where id=(p_body->>'id')::uuid for update;
 if not found or checklist_private.actor_allowed(s,p_actor,g.id,false) is not true then raise exception 'Checklist access unavailable' using errcode='42501'; end if;
 if p_action='read' then return checklist_private.reply(s,p_actor,g.id); end if;
 if p_action='history' then
  return jsonb_build_object('versions',coalesce((select jsonb_agg(to_jsonb(v)-'actor_user'-'actor_guest'||jsonb_build_object('actor_kind',case when v.actor_guest is null then 'account' else 'guest' end,'evidence',coalesce((select jsonb_agg(to_jsonb(e)-'created_by_guest' order by e.created_at,e.id) from public.checklist_attachments e where e.submission_id=s.id and e.id=any(v.evidence_ids)),'[]'::jsonb)) order by v.revision desc) from checklist_private.versions v where v.submission_id=s.id),'[]'::jsonb));
 end if;
 if p_action='download' then
  select * into a from public.checklist_attachments where id=(p_body->>'attachment_id')::uuid and submission_id=s.id;
  if not found then raise exception 'Evidence unavailable' using errcode='42501'; end if;
  return jsonb_build_object('object_path',a.object_path,'attachment_id',a.id);
 end if;
 if checklist_private.actor_allowed(s,p_actor,g.id,true) is not true then raise exception 'Checklist owner required' using errcode='42501'; end if;
 ts:=clock_timestamp();
 if p_action='begin_edit' then
  if s.status<>'submitted' or ts>=checklist_private.deadline(s) then raise exception 'Checklist period correction window is closed' using errcode='42501'; end if;
  if (p_body->>'revision')::integer is distinct from s.revision then raise exception 'Checklist changed elsewhere. Reload before editing' using errcode='PT409'; end if;
  perform checklist_private.record_version(s,s.created_by,s.created_by_guest,checklist_private.evidence_ids(s));
  insert into checklist_private.working_copies(submission_id,base_revision,answers,manager_name) values(s.id,s.revision,s.answers,s.manager_name)
   on conflict(submission_id) where status='editing' do nothing;
  return checklist_private.reply(s,p_actor,g.id);
 end if;
 if p_body->>'working_copy_id' is not null then
  select * into w from checklist_private.working_copies where id=(p_body->>'working_copy_id')::uuid and submission_id=s.id and status='editing' for update;
  if not found or w.base_revision<>s.revision or s.status<>'submitted' or ts>=checklist_private.deadline(s) then raise exception 'Correction is no longer editable' using errcode='42501'; end if;
 elsif s.status<>'draft' then raise exception 'Start a correction before editing' using errcode='42501'; end if;
 if p_action='save' then
  if (p_body->>'revision')::integer is distinct from (case when w.id is null then s.revision else w.revision end) then raise exception 'Checklist changed elsewhere. Reload before saving' using errcode='PT409'; end if;
  perform checklist_private.validate_answers(s,p_body->'answers',p_body->>'manager_name',coalesce((p_body->>'submit')::boolean,false),w.id);
  ts:=clock_timestamp();
  if w.id is not null and ts>=checklist_private.deadline(s) then raise exception 'Correction window closed before saving' using errcode='42501'; end if;
  if w.id is not null then
   update checklist_private.working_copies set answers=p_body->'answers',manager_name=btrim(p_body->>'manager_name'),revision=revision+1,updated_at=ts,
    status=case when coalesce((p_body->>'submit')::boolean,false) then 'applied' else 'editing' end where id=w.id returning * into w;
   if coalesce((p_body->>'submit')::boolean,false) then
    ids:=checklist_private.evidence_ids(s,w.id);
    update public.checklist_submissions set answers=w.answers,manager_name=w.manager_name,revision=revision+1,updated_at=ts where id=s.id returning * into s;
   end if;
  else
   ids:=checklist_private.evidence_ids(s);
   update public.checklist_submissions set answers=p_body->'answers',manager_name=btrim(p_body->>'manager_name'),revision=revision+1,updated_at=ts,
    status=case when coalesce((p_body->>'submit')::boolean,false) then 'submitted' else 'draft' end,
    submitted_at=case when coalesce((p_body->>'submit')::boolean,false) then ts else null end,
    edit_deadline_at=case when coalesce((p_body->>'submit')::boolean,false) then checklist_private.period_end(s.template_snapshot->>'cadence',s.period_date,s.template_snapshot->>'timezone') else null end
    where id=s.id returning * into s;
  end if;
  if coalesce((p_body->>'submit')::boolean,false) then
   perform checklist_private.record_version(s,p_actor,g.id,ids);
   insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,new_values)
    values('checklist_submissions',s.location_id,s.period_date,p_actor,s.manager_name,case when w.id is null then 'Checklist submitted; MonitorQA remains official' else 'Checklist correction submitted; original retained' end,
    jsonb_build_object('id',s.id,'revision',s.revision,'actor_kind',case when g.id is null then 'account' else 'guest' end,'guest_grant_id',g.id,'guest_generation',g.generation,'submitted_at',s.submitted_at,'edit_deadline_at',checklist_private.deadline(s)));
  end if;
  if g.id is not null and not coalesce((p_body->>'submit')::boolean,false) then
   insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,new_values)
    values('checklist_submissions',s.location_id,s.period_date,null,p_body->>'manager_name','Checklist guest draft saved',
    jsonb_build_object('id',s.id,'revision',case when w.id is null then s.revision else w.revision end,'working_copy_id',w.id,'actor_kind','guest','guest_grant_id',g.id,'guest_generation',g.generation));
  end if;
  return checklist_private.reply(s,p_actor,g.id);
 end if;
 if p_action='upload_begin' then
  if (select count(*) from checklist_private.upload_intents where submission_id=s.id)>=200 then raise exception 'Checklist upload limit reached' using errcode='54000'; end if;
  if (select count(*) from checklist_private.upload_intents where created_at>ts-interval '1 minute' and ((g.id is not null and actor_guest=g.id) or (p_actor is not null and actor_user=p_actor)))>=30 then raise exception 'Upload rate limit reached' using errcode='54000'; end if;
  if p_body->>'kind' not in ('photo','signature') or p_body->>'kind' is null or p_body->>'extension' not in ('png','jpg','webp') or p_body->>'extension' is null then raise exception 'Invalid evidence kind'; end if;
  if (p_body->>'kind'='photo' and not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') i where i->>'id'=p_body->>'item_id')) or
   (p_body->>'kind'='signature' and p_body->>'item_id' is not null and not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') i where i->>'id'=p_body->>'item_id' and coalesce((i->>'signature_required')::boolean,false))) then raise exception 'Invalid evidence item'; end if;
  u.id:=gen_random_uuid();
  insert into checklist_private.upload_intents(id,submission_id,working_copy_id,object_path,kind,item_id,actor_user,actor_guest,guest_generation,expires_at)
   values(u.id,s.id,w.id,s.id::text||'/'||u.id::text||'.'||(p_body->>'extension'),p_body->>'kind',p_body->>'item_id',p_actor,g.id,g.generation,least(ts+interval '5 minutes',coalesce(checklist_private.deadline(s),ts+interval '5 minutes'))) returning * into u;
  return jsonb_build_object('upload_id',u.id,'object_path',u.object_path);
 elsif p_action='upload_finish' then
  select * into u from checklist_private.upload_intents where id=(p_body->>'upload_id')::uuid and submission_id=s.id for update;
  if not found or u.registered or u.expires_at<=clock_timestamp() or u.working_copy_id is distinct from w.id or u.actor_user is distinct from p_actor or u.actor_guest is distinct from g.id or (g.id is not null and u.guest_generation<>g.generation) then raise exception 'Upload authorization expired' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects where bucket_id='manager-checklist-evidence' and name=u.object_path) then raise exception 'Upload must complete before attachment'; end if;
  insert into public.checklist_attachments(id,submission_id,item_id,kind,object_path,created_by,created_by_guest,working_copy_id) values(u.id,s.id,u.item_id,u.kind,u.object_path,p_actor,g.id,w.id) returning * into a;
  update checklist_private.upload_intents set registered=true where id=u.id;
  return jsonb_build_object('attachment',to_jsonb(a)-'created_by_guest');
 end if;
 raise exception 'Unsupported checklist action';
end;
$$;

create or replace function checklist_private.guard_evidence_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.checklist_submissions; u checklist_private.upload_intents; g checklist_private.qr_grants; w checklist_private.working_copies;
begin
 if new.bucket_id is distinct from 'manager-checklist-evidence' then return new; end if;
 select * into u from checklist_private.upload_intents where object_path=new.name;
 if u.id is not null and u.actor_guest is not null then
  select * into g from checklist_private.qr_grants where id=u.actor_guest for share;
  if not g.is_active or g.generation<>u.guest_generation then raise exception 'Checklist upload access revoked' using errcode='42501'; end if;
 end if;
 select * into s from public.checklist_submissions where id::text=split_part(new.name,'/',1) for share;
 if s.id is null then raise exception 'Checklist draft is unavailable for uploads' using errcode='42501'; end if;
 if u.actor_guest is not null and not checklist_private.qr_template_allowed(s.template_key) then raise exception 'Authenticated audit evidence access required' using errcode='42501'; end if;
 if u.id is null then
  if s.status<>'draft' then raise exception 'Checklist draft is unavailable for uploads' using errcode='42501'; end if;
  return new;
 end if;
 if u.registered or u.expires_at<=clock_timestamp() or checklist_private.actor_allowed(s,u.actor_user,u.actor_guest,true) is not true then raise exception 'Checklist upload access revoked' using errcode='42501'; end if;
 if u.working_copy_id is null then
  if s.status<>'draft' then raise exception 'Checklist draft is unavailable for uploads' using errcode='42501'; end if;
 else
  select * into w from checklist_private.working_copies where id=u.working_copy_id and submission_id=s.id for share;
  if w.status is distinct from 'editing' or w.base_revision<>s.revision or s.status<>'submitted' or clock_timestamp()>=checklist_private.deadline(s) then raise exception 'Correction is no longer editable' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;

insert into public.checklist_templates(key,name,cadence,definition) values ('monthly_site_assessment','Monthly Site Assessment','monthly',$audit$[
 {
  "id": "monthly_site_assessment-site-administration-1",
  "section": "Site Administration",
  "number": 1,
  "text": "Communications Board: Posted, up to date, follows guidelines?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-2",
  "section": "Site Administration",
  "number": 2,
  "text": "Schedule: Two weeks posted, schedule guidelines followed, staffing needs met with positioning?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-3",
  "section": "Site Administration",
  "number": 3,
  "text": "Membership Calendar Tracker: Posted and in use?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-4",
  "section": "Site Administration",
  "number": 4,
  "text": "Damage Claims: Reports completed through JotForm, pending submissions resolved within 72 hours, ensure the QR code is accessible for team members?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-5",
  "section": "Site Administration",
  "number": 5,
  "text": "Required Postings: OSHA/Employment Law all-in-one poster, state Worker's Compensation forms and OSHA 300As?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-6",
  "section": "Site Administration",
  "number": 6,
  "text": "Site Manager Preventative Maintenance: Posted and completed weekly?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-7",
  "section": "Site Administration",
  "number": 7,
  "text": "Cash Handling: Procedures followed, deposits timely and accurate (Deposit daily), paid outs reviewed, all counts spot checked?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-8",
  "section": "Site Administration",
  "number": 8,
  "text": "Office Supplies: Stocked (receipt tape, paper, pens, comp cards, business cards, wash pass cards, etc.)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-9",
  "section": "Site Administration",
  "number": 9,
  "text": "RFID Tags: Properly secured and stored?",
  "instruction": "Tags consolidated in one place. Sufficient inventory to supply your site for the month.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-10",
  "section": "Site Administration",
  "number": 10,
  "text": "Register: Organized, neat, properly stocked?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-11",
  "section": "Site Administration",
  "number": 11,
  "text": "Overall Site Health: Sales and KPIs tracking for GM Quarterly Bonus?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-12",
  "section": "Site Administration",
  "number": 12,
  "text": "State Inspector On Duty? (Where applicable)",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-administration-13",
  "section": "Site Administration",
  "number": 13,
  "text": "Site Administration Comments",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": false
 },
 {
  "id": "monthly_site_assessment-site-administration-14",
  "section": "Site Administration",
  "number": 14,
  "text": "Office A/C Filter - Need cleaning or changing?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-1",
  "section": "Site Standards / Exterior",
  "number": 1,
  "text": "Lot: Clean; free of trash, gum, leaves, oil spots, mud; parking lot bollards in good condition, correct messaging?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-2",
  "section": "Site Standards / Exterior",
  "number": 2,
  "text": "Landscaping: Clean, free from debris, plants properly maintained?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-3",
  "section": "Site Standards / Exterior",
  "number": 3,
  "text": "Perimeter: Free of trash, debris, all areas presentable.",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-4",
  "section": "Site Standards / Exterior",
  "number": 4,
  "text": "Fencing: Clean, good condition, free of trash?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-5",
  "section": "Site Standards / Exterior",
  "number": 5,
  "text": "Outside Walls: Clean, free of dirt?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-6",
  "section": "Site Standards / Exterior",
  "number": 6,
  "text": "Dumpster Area: Gate/fencing in good repair, gate locks?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-7",
  "section": "Site Standards / Exterior",
  "number": 7,
  "text": "Menu Signs: Prices correct, no handwritten signs?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-8",
  "section": "Site Standards / Exterior",
  "number": 8,
  "text": "Monument Sign: Clean, current message (if applicable), illuminated?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-exterior-9",
  "section": "Site Standards / Exterior",
  "number": 9,
  "text": "Pay Station and Vacuum Awnings/Canopy: Clean, free of dust and spider webs?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-interior-1",
  "section": "Site Standards / Interior",
  "number": 1,
  "text": "Customer Lobby Area: Floor, windows, and door clean; lights working?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-interior-2",
  "section": "Site Standards / Interior",
  "number": 2,
  "text": "Office Space: Clean, free of clutter, organized, chairs in good condition, microwave and refrigerator clean?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-interior-3",
  "section": "Site Standards / Interior",
  "number": 3,
  "text": "Restrooms: Clean, stocked, operational?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-interior-4",
  "section": "Site Standards / Interior",
  "number": 4,
  "text": "Equipment Room and Storage: Clean and organized, empty chemical drums removed on a timely basis?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-interior-5",
  "section": "Site Standards / Interior",
  "number": 5,
  "text": "Windows and Doors: Clean, free of dust, dirt, stains, smudges?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-vacuum-area-1",
  "section": "Site Standards / Vacuum Area",
  "number": 1,
  "text": "Vacuum Spaces: Gutters and parking spaces clean, vacuums working?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-vacuum-area-2",
  "section": "Site Standards / Vacuum Area",
  "number": 2,
  "text": "Mat Cleaner(s): Clean, working properly, proper signage?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-vacuum-area-3",
  "section": "Site Standards / Vacuum Area",
  "number": 3,
  "text": "Vacuum Hoses and Nozzles: Good condition?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-vacuum-area-4",
  "section": "Site Standards / Vacuum Area",
  "number": 4,
  "text": "Mat Holders: Clean, free of stains?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-vacuum-area-5",
  "section": "Site Standards / Vacuum Area",
  "number": 5,
  "text": "Air tools working properly, hoses in good condition?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-vacuum-area-6",
  "section": "Site Standards / Vacuum Area",
  "number": 6,
  "text": "Garbage Cans: Not overflowing, no more than half full of trash, no odors?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-1",
  "section": "Site Standards / Other",
  "number": 1,
  "text": "Hours of Operations: Are current sites hours of operations posted correctly on digital platforms (i.e Google, Yelp, etc)? Attach photo or screenshot for verification.",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": true,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-2",
  "section": "Site Standards / Other",
  "number": 2,
  "text": "People: Are all employees in proper uniform and look presentable?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-3",
  "section": "Site Standards / Other",
  "number": 3,
  "text": "Lighting: Clean, operational, timed appropriately, covers free of dirt, bugs, spider webs?",
  "instruction": "Vacuum booms, monument lighting, pay station canopy lights, site pole lights, any and all lights attached to building.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-4",
  "section": "Site Standards / Other",
  "number": 4,
  "text": "Tunnel Entrance: Clean? Free of ladders, equipment, non-wash-essential items?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-5",
  "section": "Site Standards / Other",
  "number": 5,
  "text": "Vending: Stocked, working properly (if applicable)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-6",
  "section": "Site Standards / Other",
  "number": 6,
  "text": "Traffic Control Items (Gates, Arrows, Enter/Exit Signage): Clean, good condition?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-7",
  "section": "Site Standards / Other",
  "number": 7,
  "text": "Walkways: Clear, free of trip hazards (tools, supplies, uneven surfaces, holes in the floor or sidewalk, etc.)",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-other-8",
  "section": "Site Standards / Other",
  "number": 8,
  "text": "POS Signage: Up to date, clean; free of dirt, bugs, spider webs?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-site-standards-5",
  "section": "Site Standards",
  "number": 5,
  "text": "Site Standards Comments:",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": false
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-1",
  "section": "Tunnel and Equipment",
  "number": 1,
  "text": "Conveyor: Chain tension correct, roller wheels functioning correctly and in good repair?",
  "instruction": "There should be more than 1\" of space on carriage to allow for chain tension to be in safe/operable position.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-2",
  "section": "Tunnel and Equipment",
  "number": 2,
  "text": "Prep Gun Hoses: Hanging properly, off the floor and in good condition?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-3",
  "section": "Tunnel and Equipment",
  "number": 3,
  "text": "Tunnel: Arches, equipment, signs, lights, walls, windows, floors clean and up to standard? No buildup of dirt, debris, etc.",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-4",
  "section": "Tunnel and Equipment",
  "number": 4,
  "text": "Wraps, Rockers, and Tire Brushes: Proper speed and pressure?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-5",
  "section": "Tunnel and Equipment",
  "number": 5,
  "text": "Nozzles/Applicator: Not clogged, proper spray pattern?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-6",
  "section": "Tunnel and Equipment",
  "number": 6,
  "text": "Trench: Properly cleaned every Wednesday, free of large debris, water drains effectively?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-7",
  "section": "Tunnel and Equipment",
  "number": 7,
  "text": "Chemical Applications: Have proper coverage and \"show\" , chemical inventory is sufficient for operations?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-8",
  "section": "Tunnel and Equipment",
  "number": 8,
  "text": "Chemical Lines: Primed and pulling?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-9",
  "section": "Tunnel and Equipment",
  "number": 9,
  "text": "Tire Shine: Has proper coverage?",
  "instruction": "Inspect dispensing manifold underneath guard.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-10",
  "section": "Tunnel and Equipment",
  "number": 10,
  "text": "Blower Screens: Clean, free of debris?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-11",
  "section": "Tunnel and Equipment",
  "number": 11,
  "text": "Tunnel Exit: Clean of Excess Debris, Wait/Go Signage Working?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-12",
  "section": "Tunnel and Equipment",
  "number": 12,
  "text": "Conveyor Speed: Appropriate based on volume and size of tunnel?",
  "instruction": "Read the tunnel speed on Motor Control Center (MCC). 100' tunnel - 120 CPH 120' tunnel - 150 CPH 150' tunnel - 170 CPH",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-13",
  "section": "Tunnel and Equipment",
  "number": 13,
  "text": "MCC and Tunnel Controller Filter: Clean?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-14",
  "section": "Tunnel and Equipment",
  "number": 14,
  "text": "Watch at least three vehicles: is tunnel equipment timed accurately, engaging with the vehicle at the appropriate point in the wash?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-15",
  "section": "Tunnel and Equipment",
  "number": 15,
  "text": "Watch at least three vehicles: are vehicles coming out of the wash clean, dry, and with tire shine appropriately applied?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-16",
  "section": "Tunnel and Equipment",
  "number": 16,
  "text": "Chemical Rep visits site regularly?",
  "instruction": "When Chemical Rep is on site, one should watch vehicles and inspect wash packages.",
  "type": "yesno",
  "options": [
   "Yes",
   "No"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-tunnel-and-equipment-17",
  "section": "Tunnel and Equipment",
  "number": 17,
  "text": "Tunnel and Equipment Comments:",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": false
 },
 {
  "id": "monthly_site_assessment-safety-1",
  "section": "Safety",
  "number": 1,
  "text": "Are employees performing tasks only in/on designated walking/working area(NOT stepping on track rails, rollers, correlators, companion plates, vehicle tires, door frames, running boards, bumpers, tailgates)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-safety-2",
  "section": "Safety",
  "number": 2,
  "text": "Are employees wearing required PPE (hearing protection, gloves, goggles, etc.), where and when required (designated high noise areas, when handling chemicals, etc.)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-safety-3",
  "section": "Safety",
  "number": 3,
  "text": "Are employees wearing slip resistant shoes?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-safety-4",
  "section": "Safety",
  "number": 4,
  "text": "Are all fire extinguisher inspections within the past 30 days?",
  "instruction": "Monthly inspection consists of a team member reading the gauge on the extinguisher and, if the needle is in the green, initialing the tag on the extinguisher.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-safety-5",
  "section": "Safety",
  "number": 5,
  "text": "Are employees standing clear of vehicles when guiding them in and out?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-safety-6",
  "section": "Safety",
  "number": 6,
  "text": "Is the team inspecting tunnels hourly?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-safety-7",
  "section": "Safety",
  "number": 7,
  "text": "Safety Comments:",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": false
 },
 {
  "id": "monthly_site_assessment-customer-journey-1",
  "section": "Customer Journey",
  "number": 1,
  "text": "Car Wash Attendant at Pay Station greeting customers appropriately?",
  "instruction": "Smiling, waving, and demonstrating positive attitude.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-2",
  "section": "Customer Journey",
  "number": 2,
  "text": "Car Wash Attendant following sales script and presenting current promotions?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-2-followup",
  "section": "Customer Journey",
  "number": 1,
  "text": "What needs to change?",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true,
  "condition": {
   "item_id": "monthly_site_assessment-customer-journey-2",
   "value": "Failed"
  }
 },
 {
  "id": "monthly_site_assessment-customer-journey-3",
  "section": "Customer Journey",
  "number": 3,
  "text": "Car Wash Attendant knowledgeable on wash pricing and included features?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-3-followup",
  "section": "Customer Journey",
  "number": 1,
  "text": "What was missed?",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true,
  "condition": {
   "item_id": "monthly_site_assessment-customer-journey-3",
   "value": "Failed"
  }
 },
 {
  "id": "monthly_site_assessment-customer-journey-4",
  "section": "Customer Journey",
  "number": 4,
  "text": "Is loader visible and offering clear signals to load vehicles smoothly and accurately?",
  "instruction": "Slow, controlled, clear, calm hand signals.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-5",
  "section": "Customer Journey",
  "number": 5,
  "text": "Is loader staying at tunnel entrance for the duration of the wash, available to hit the emergency stop if needed?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-6",
  "section": "Customer Journey",
  "number": 6,
  "text": "Is vacuum attendant engaging with each customer in the vacuum lot to ensure wash satisfaction, discussing our membership program as time permits?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-6-followup",
  "section": "Customer Journey",
  "number": 1,
  "text": "What was missed?",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true,
  "condition": {
   "item_id": "monthly_site_assessment-customer-journey-6",
   "value": "Failed"
  }
 },
 {
  "id": "monthly_site_assessment-customer-journey-7",
  "section": "Customer Journey",
  "number": 7,
  "text": "Proper vacuum suction and air tool function?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "monthly_site_assessment-customer-journey-8",
  "section": "Customer Journey",
  "number": 8,
  "text": "Customer Journey Comments:",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": false
 }
]$audit$::jsonb);

insert into public.checklist_templates(key,name,cadence,definition) values ('quarterly_safety_audit','Quarterly Safety Audit','quarterly',$audit$[
 {
  "id": "quarterly_safety_audit-safety-1",
  "section": "Safety",
  "number": 1,
  "text": "Are employees performing tasks only in/on designated walking/working area (NOT stepping on track rails, rollers, correlators, companion plates, vehicle tires, door frames, running boards, bumpers, tailgates)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-2",
  "section": "Safety",
  "number": 2,
  "text": "Are first aid kits easily accessible to each work area, periodically inspected and replenished as needed?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-3",
  "section": "Safety",
  "number": 3,
  "text": "Is there an eye-wash station available for flushing of the eyes in areas where corrosive liquids or materials are handled, periodically inspected and refilled as needed?",
  "instruction": "If eye-wash station is missing or not functioning please reach out to Allison Lewis at Allison.lewis@acceleratedbrands.com",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-3-followup",
  "section": "Safety",
  "number": 1,
  "text": "Describe what's missing or if there is an issue",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true,
  "condition": {
   "item_id": "quarterly_safety_audit-safety-3",
   "value": "Failed"
  }
 },
 {
  "id": "quarterly_safety_audit-safety-4",
  "section": "Safety",
  "number": 4,
  "text": "Have high noise work areas been identified and signs posted?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-5",
  "section": "Safety",
  "number": 5,
  "text": "Are all emergency exits marked with an illuminated exit sign and kept free of obstructions (at least 5ft)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-6",
  "section": "Safety",
  "number": 6,
  "text": "Are portable fire extinguishers provided in adequate number and mounted in readily accessible locations?",
  "instruction": "Note: Fire Extinguishers will be managed by third party vendors of Trademark",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-7",
  "section": "Safety",
  "number": 7,
  "text": "Are all extinguishers inspections within the past 30 days, and professionally serviced annually?",
  "instruction": "Monthly inspection consists of a team member reading the gauge on the extinguisher and, if the needle is in the green, initialing the tag on the extinguisher.",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-8",
  "section": "Safety",
  "number": 8,
  "text": "Is all required PPE (ear plugs, ear muffs, chemical resistant gloves, safety glasses, chemical apron and chemical goggles) readily available, maintained in a sanitary condition and ready for use?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-9",
  "section": "Safety",
  "number": 9,
  "text": "Are employees wearing required PPE (hearing protection, gloves, goggles, etc.), where and when required (designated high noise areas, when handling chemicals, etc.)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-10",
  "section": "Safety",
  "number": 10,
  "text": "Are employees wearing slip resistant shoes?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-11",
  "section": "Safety",
  "number": 11,
  "text": "Are all walkways kept clear of clutter?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-12",
  "section": "Safety",
  "number": 12,
  "text": "Are trip hazards such as uneven surfaces, holes in the floor, sidewalk, or other walking surface, etc., repaired or otherwise made safe?",
  "instruction": "If not, please submit a ticket through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-13",
  "section": "Safety",
  "number": 13,
  "text": "Are grates in place over the trench and floor drains so that they are flush with the floor and there are no gaps?",
  "instruction": "If not, please submit a ticket through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-14",
  "section": "Safety",
  "number": 14,
  "text": "Is a safe means of access - step stools, portable ladders, staircases, etc.- provided to elevated storage and work surfaces?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-15",
  "section": "Safety",
  "number": 15,
  "text": "Are all ladders maintained and in good condition?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-16",
  "section": "Safety",
  "number": 16,
  "text": "Are tools and equipment in good condition and used with proper shields, guards, or attachments, as recommended by the manufacturer?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-17",
  "section": "Safety",
  "number": 17,
  "text": "Are corded electrical tools and equipment grounded or of the double insulated type?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-18",
  "section": "Safety",
  "number": 18,
  "text": "Is equipment and machinery securely placed and anchored to prevent tipping or other movement that could result in personal injury?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-19",
  "section": "Safety",
  "number": 19,
  "text": "All wastewater and wash byproduct is contained at the site and flows to the wash tunnel trench?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-20",
  "section": "Safety",
  "number": 20,
  "text": "Is trench waste disposed of only in designated separator tanks?",
  "instruction": "If not, please submit a ticket through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-21",
  "section": "Safety",
  "number": 21,
  "text": "Are separator tanks professionally pumped, and frequently enough to prevent overflow or plumbing issues?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-22",
  "section": "Safety",
  "number": 22,
  "text": "Are spill kits stocked and readily available for containing chemical spills or overflows?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-23",
  "section": "Safety",
  "number": 23,
  "text": "Are there any plumbing issues, especially those impacting your site's ability to safely contain and process wastewater (i.e.- backed up trench or separator drains)?",
  "instruction": "If failed, please submit a ticket through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-24",
  "section": "Safety",
  "number": 24,
  "text": "Are all containers (chemical totes, storage tanks, etc.) and secondary containers (spray bottles, pump-action sprayers, etc.) labeled as to their contents (e.g., Lustra, Hydraulic Oil, Windex, water, etc.)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-25",
  "section": "Safety",
  "number": 25,
  "text": "Are any exposed cords or wires observed?",
  "instruction": "If so, please submit a ticket through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-26",
  "section": "Safety",
  "number": 26,
  "text": "Are all switches and circuit breakers labeled to indicate their use or equipment served?",
  "instruction": "If not labeled, please try to identify breakers first. If unable to identify, submit a request through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-27",
  "section": "Safety",
  "number": 27,
  "text": "Are all energized electrical panels enclosed in approved cabinets with doors that close?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-28",
  "section": "Safety",
  "number": 28,
  "text": "Is there an adequate number of Lockout/Tagout devices available?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-29",
  "section": "Safety",
  "number": 29,
  "text": "Is there at least one E-Stop installed to prevent startup of wash equipment while cleaning or performing maintenance in the wash tunnel?",
  "instruction": "If not, please submit a ticket through MaintainX",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-30",
  "section": "Safety",
  "number": 30,
  "text": "Is there an up to date OSHA binder?",
  "instruction": "If not please reach out to Allison Lewis at Allison.lewis@acceleratedbrands.com",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-31",
  "section": "Safety",
  "number": 31,
  "text": "Is the OSHA 300A log posted near the communication board (Feb 1st - April 30th)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-32",
  "section": "Safety",
  "number": 32,
  "text": "Is the shoes for crews poster posted and visible for employees?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-33",
  "section": "Safety",
  "number": 33,
  "text": "Is the most up-to-date labor poster (provided by Paychex) posted and visible to all employees",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-34",
  "section": "Safety",
  "number": 34,
  "text": "Are extension cords only being used for temporary means and not permanent wiring?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-35",
  "section": "Safety",
  "number": 35,
  "text": "Are stairs, steps and landings in safe condition?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-36",
  "section": "Safety",
  "number": 36,
  "text": "Is hot and cold water available in the lavatories?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-37",
  "section": "Safety",
  "number": 37,
  "text": "Have all old propane tanks been returned to the vendor?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-38",
  "section": "Safety",
  "number": 38,
  "text": "Are employees locking/tagging out when performing any maintenance tasks?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-39",
  "section": "Safety",
  "number": 39,
  "text": "Are all cameras accessible and working?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-40",
  "section": "Safety",
  "number": 40,
  "text": "Are there any areas that could potentially be a slip hazard (e.g., chemical buildup, ice, standing water, etc.)?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-41",
  "section": "Safety",
  "number": 41,
  "text": "Is there any standing water or flooding that's building up inside or outside?",
  "instruction": "",
  "type": "passfail",
  "options": [
   "Passed",
   "Failed"
  ],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": true
 },
 {
  "id": "quarterly_safety_audit-safety-42",
  "section": "Safety",
  "number": 42,
  "text": "Additional Safety Comments:",
  "instruction": "",
  "type": "text",
  "options": [],
  "failure_values": [],
  "critical": false,
  "photo_required": false,
  "na_allowed": false,
  "required": false
 }
]$audit$::jsonb);

notify pgrst,'reload schema';
commit;
