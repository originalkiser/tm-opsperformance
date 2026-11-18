-- LOCAL PREPARATION ONLY. Install separately; activate only after frontend deployment.
-- No backfill, existing snapshot/template updates, or role/capability changes.
begin;
set local lock_timeout='3s';
create table checklist_private.weekly_deadline_policy (
 singleton boolean primary key default true check(singleton),
 installed_at timestamptz not null default clock_timestamp(), activated_at timestamptz
);
insert into checklist_private.weekly_deadline_policy(singleton) values(true);
alter table checklist_private.weekly_deadline_policy enable row level security;
revoke all on checklist_private.weekly_deadline_policy from public,anon,authenticated,service_role;
create function checklist_private.freeze_weekly_policy() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.activated_at is not null or new.installed_at is distinct from old.installed_at
 or new.activated_at is null or new.activated_at<old.installed_at or new.activated_at>clock_timestamp() then
  raise exception 'Weekly policy activation is one-time, cannot precede installation, and cannot be removed';
 end if;
 return new;
end;
$$;
create trigger freeze_weekly_deadline_policy before update or delete on checklist_private.weekly_deadline_policy
for each row execute function checklist_private.freeze_weekly_policy();
create function checklist_private.weekly_policy_start(p_timezone text) returns date
language sql stable security definer set search_path='' as $$
 select date_trunc('week',activated_at at time zone p_timezone)::date+7
 from checklist_private.weekly_deadline_policy where singleton;
$$;
create function checklist_private.weekly_due(p_key text,p_period date,p_timezone text) returns timestamptz
language sql stable security definer set search_path='' as $$
 select case when p_key in ('weekly','weekly_pm') and p_period>=checklist_private.weekly_policy_start(p_timezone)
 then (p_period+8)::timestamp at time zone p_timezone else null end;
$$;
-- First submitted_at and immutable snapshot timezone determine timeliness permanently.
create function checklist_private.weekly_timing(p_key text,p_period date,p_timezone text,p_status text,p_submitted timestamptz,p_now timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when due is null then null else jsonb_build_object('due_at',due,'due_date',p_period+7,
 'phase',case when p_status='submitted' then case when p_submitted<due then 'submitted_on_time' else 'completed_late' end
 when p_now>=due then 'overdue' when p_status in ('draft','discarding') then 'in_progress' else 'not_started' end) end
 from (select checklist_private.weekly_due(p_key,p_period,p_timezone) due) d;
$$;
create function checklist_private.weekly_options(p_timezone text,p_now timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('period_date',period,'period_end',period+6,'previous',period=start-7,'older',period<start-7,'recent',period>=start-7,'legacy_carryover',period<start and checklist_private.weekly_due('weekly',period,p_timezone) is null,
 'weekly_timing',checklist_private.weekly_timing('weekly',period,p_timezone,'missing',null,p_now)) order by period),'[]'::jsonb)
 from (select (p_now at time zone p_timezone)::date as local_day,date_trunc('week',p_now at time zone p_timezone)::date start) d
 cross join lateral (select start period union select start-7 where extract(isodow from local_day)=1 union select d::date from generate_series(checklist_private.weekly_policy_start(p_timezone)::timestamp,(start-7)::timestamp,interval '7 days') d) periods;
$$;
create function checklist_private.authenticated_weekly_periods(p_location uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tz text; ts timestamptz:=now(); day date; result jsonb; selected date;
begin
 if checklist_private.assigned(p_location,auth.uid()) is not true then raise exception 'Assigned location required' using errcode='42501'; end if;
 select timezone into tz from public.locations where id=p_location;
 if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Valid site time zone required'; end if;
 day:=(ts at time zone tz)::date;
 if p_date is null or not isfinite(p_date) or p_date>day then raise exception 'Valid checklist date required'; end if;
 result:=checklist_private.weekly_options(tz,ts); selected:=date_trunc('week',p_date::timestamp)::date;
 -- Authenticated historical selection remains possible, with its original policy.
 if selected<>date_trunc('week',day::timestamp)::date then
  result:=jsonb_build_array(jsonb_build_object('period_date',selected,'period_end',selected+6,'previous',false,
   'weekly_timing',checklist_private.weekly_timing('weekly',selected,tz,'missing',null,ts)));
 end if;
 select jsonb_agg(o||jsonb_build_object('checklists',coalesce((select jsonb_object_agg(s.template_key,checklist_private.weekly_timing(s.template_key,s.period_date,s.template_snapshot->>'timezone',s.status,s.submitted_at,ts)) from public.checklist_submissions s where s.location_id=p_location and s.period_date=(o->>'period_date')::date and s.template_key in ('weekly','weekly_pm')),'{}'::jsonb)) order by o->>'period_date') into result from jsonb_array_elements(result) o;
 return result;
end;
$$;
create function public.checklist_weekly_periods(p_location uuid,p_date date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select checklist_private.authenticated_weekly_periods(p_location,p_date);
$$;

create or replace function checklist_private.deadline(s public.checklist_submissions) returns timestamptz
language sql stable set search_path='' as $$
 select case when s.submitted_at is not null then
 coalesce(checklist_private.weekly_due(s.template_key,s.period_date,s.template_snapshot->>'timezone'),checklist_private.period_end(s.template_snapshot->>'cadence',s.period_date,s.template_snapshot->>'timezone')) else null end;
$$;
create or replace function checklist_private.reply(s public.checklist_submissions,p_actor uuid,p_guest uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w checklist_private.working_copies; result jsonb; ids uuid[]; writable boolean; correction boolean; ts timestamptz:=clock_timestamp();
begin
 if checklist_private.actor_allowed(s,p_actor,p_guest,false) is not true then raise exception 'Checklist access unavailable' using errcode='42501'; end if;
 writable:=checklist_private.actor_allowed(s,p_actor,p_guest,true);
 correction:=writable and s.status='submitted' and ts<checklist_private.deadline(s);
 if correction then select * into w from checklist_private.working_copies where submission_id=s.id and status='editing'; end if;
 result:=to_jsonb(s)||jsonb_build_object('weekly_timing',checklist_private.weekly_timing(s.template_key,s.period_date,s.template_snapshot->>'timezone',s.status,s.submitted_at,ts))||jsonb_build_object('actor_kind',case when s.created_by_guest is null then 'account' else 'guest' end);
 if w.id is not null then result:=result||jsonb_build_object('working_copy_id',w.id,'base_revision',s.revision,'revision',w.revision,'answers',w.answers,'manager_name',w.manager_name); end if;
 ids:=checklist_private.evidence_ids(s,w.id);
 return jsonb_build_object('submission',result,'evidence',coalesce((select jsonb_agg(to_jsonb(a)-'created_by_guest' order by a.created_at,a.id) from public.checklist_attachments a where a.id=any(ids)),'[]'::jsonb),
 'capabilities',jsonb_build_object('can_edit',writable and (s.status='draft' or (correction and w.id is not null)),
 'can_begin_edit',correction and w.id is null,'can_correct',correction and w.id is null,'can_upload',writable and (s.status='draft' or (correction and w.id is not null)),
 'can_discard',p_guest is null and s.status in ('draft','discarding') and (writable or exists(select 1 from public.user_profiles where id=p_actor and role='admin')),
 'edit_deadline_at',checklist_private.deadline(s),'weekly_timing',checklist_private.weekly_timing(s.template_key,s.period_date,s.template_snapshot->>'timezone',s.status,s.submitted_at,ts),'server_now',ts));
end;
$$;
create or replace function checklist_private.access_action(p_actor uuid,p_hash text,p_action text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g checklist_private.qr_grants; s public.checklist_submissions; t public.checklist_templates; w checklist_private.working_copies; u checklist_private.upload_intents;
 loc uuid; ts timestamptz; tz text; day date; d date; n integer; ids uuid[]; a public.checklist_attachments; result jsonb; is_admin boolean; off integer; existing_intent checklist_private.upload_intents; photo_enabled boolean;
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
   select to_jsonb(c)||jsonb_build_object('weekly_timing',checklist_private.weekly_timing(c.template_key,c.period_date,c.template_snapshot->>'timezone',c.status,c.submitted_at,clock_timestamp()),'working_copy_id',(select wc.id from checklist_private.working_copies wc where wc.submission_id=c.id and wc.status='editing' and clock_timestamp()<checklist_private.deadline(c))) row,c.created_at,c.id from public.checklist_submissions c where c.location_id=loc and checklist_private.actor_allowed(c,p_actor,g.id,false)
    and (c.status in ('draft','discarding') or c.period_date=day or (c.template_key in ('weekly','weekly_pm') and c.period_date=date_trunc('week',day::timestamp)::date)
      or (c.template_key in ('weekly','weekly_pm') and c.period_date<=date_trunc('week',day::timestamp)::date and checklist_private.weekly_due(c.template_key,c.period_date,c.template_snapshot->>'timezone') is not null)
      or (c.template_key='monthly_site_assessment' and c.period_date=date_trunc('month',day::timestamp)::date)
      or (c.template_key='quarterly_safety_audit' and c.period_date=date_trunc('quarter',day::timestamp)::date)
      or exists(select 1 from checklist_private.working_copies wc where wc.submission_id=c.id and wc.status='editing' and clock_timestamp()<checklist_private.deadline(c))) order by c.created_at desc,c.id offset off limit 101
  ) x;
  return jsonb_build_object('location',(select jsonb_build_object('id',id,'site_code',site_code,'timezone',timezone) from public.locations where id=loc),
   'templates',(select jsonb_agg(to_jsonb(ct) order by ct.key) from public.checklist_templates ct where g.id is null or checklist_private.qr_template_allowed(ct.key)),
   'submissions',case when jsonb_array_length(result)>100 then result-100 else result end,'has_more',jsonb_array_length(result)>100,'next_offset',off+100,'server_now',clock_timestamp(),'weekly_periods',checklist_private.weekly_options(tz,clock_timestamp()));
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
  -- New-policy weekly late starts are allowed; other guest start rules are unchanged.
  if g.id is not null and d<>(checklist_private.period_start(t.cadence,day)) and not (t.key in ('weekly','weekly_pm') and checklist_private.weekly_due(t.key,d,tz) is not null) then raise exception 'Start the current checklist period'; end if;
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
    edit_deadline_at=case when coalesce((p_body->>'submit')::boolean,false) then coalesce(checklist_private.weekly_due(s.template_key,s.period_date,s.template_snapshot->>'timezone'),checklist_private.period_end(s.template_snapshot->>'cadence',s.period_date,s.template_snapshot->>'timezone')) else null end
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
  if p_body->>'kind' not in ('photo','signature') or p_body->>'kind' is null or p_body->>'extension' not in ('png','jpg','webp') or p_body->>'extension' is null then raise exception 'Invalid evidence kind'; end if;
  if (p_body->>'kind'='photo' and not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') i where i->>'id'=p_body->>'item_id')) or
   (p_body->>'kind'='signature' and p_body->>'item_id' is not null and not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') i where i->>'id'=p_body->>'item_id' and coalesce((i->>'signature_required')::boolean,false))) then raise exception 'Invalid evidence item'; end if;
  -- Operational photos only: a stable request UUID permits safe verification retries.
  if p_body->>'kind'='photo' and checklist_private.qr_template_allowed(s.template_key) then
   select enforced into strict photo_enabled from checklist_private.photo_rollout where singleton for share;
   u.id:=coalesce((p_body->>'upload_id')::uuid,gen_random_uuid());
   select * into existing_intent from checklist_private.upload_intents where id=u.id;
   if found then
    if existing_intent.submission_id<>s.id or existing_intent.working_copy_id is distinct from w.id or existing_intent.actor_user is distinct from p_actor or existing_intent.actor_guest is distinct from g.id or existing_intent.kind<>'photo' or existing_intent.item_id is distinct from p_body->>'item_id' or (g.id is not null and existing_intent.guest_generation<>g.generation) or (not existing_intent.registered and existing_intent.expires_at<=clock_timestamp()) then raise exception 'Upload authorization expired' using errcode='42501'; end if;
    return jsonb_build_object('upload_id',existing_intent.id,'object_path',existing_intent.object_path,'photo_integrity',true,'registered',existing_intent.registered);
   end if;
  else u.id:=gen_random_uuid(); end if;
  if (select count(*) from checklist_private.upload_intents where submission_id=s.id)>=200 then raise exception 'Checklist upload limit reached' using errcode='54000'; end if;
  if (select count(*) from checklist_private.upload_intents where created_at>ts-interval '1 minute' and ((g.id is not null and actor_guest=g.id) or (p_actor is not null and actor_user=p_actor)))>=30 then raise exception 'Upload rate limit reached' using errcode='54000'; end if;
  insert into checklist_private.upload_intents(id,submission_id,working_copy_id,object_path,kind,item_id,actor_user,actor_guest,guest_generation,expires_at,photo_verifier_version)
   values(u.id,s.id,w.id,s.id::text||'/'||u.id::text||'.'||(p_body->>'extension'),p_body->>'kind',p_body->>'item_id',p_actor,g.id,g.generation,least(ts+interval '5 minutes',coalesce(checklist_private.deadline(s),ts+interval '5 minutes')),case when p_body->>'kind'='photo' and checklist_private.qr_template_allowed(s.template_key) and p_body->>'verifier_version'='sha256-v1' then 'sha256-v1' end) returning * into u;
  return jsonb_build_object('upload_id',u.id,'object_path',u.object_path,'photo_integrity',u.kind='photo' and checklist_private.qr_template_allowed(s.template_key));
 elsif p_action='upload_finish' then
  select * into u from checklist_private.upload_intents where id=(p_body->>'upload_id')::uuid and submission_id=s.id for update;
  if not found or (not u.registered and u.expires_at<=clock_timestamp()) or u.working_copy_id is distinct from w.id or u.actor_user is distinct from p_actor or u.actor_guest is distinct from g.id or (g.id is not null and u.guest_generation<>g.generation) then raise exception 'Upload authorization expired' using errcode='42501'; end if;
  if u.kind='photo' and checklist_private.qr_template_allowed(s.template_key) then
   select enforced into strict photo_enabled from checklist_private.photo_rollout where singleton for share;
   if coalesce(p_body->>'sha256','') ~ '^[a-f0-9]{64}$' then
    perform checklist_private.claim_photo(u.id,s.id,s.location_id,u.object_path,p_body->>'sha256');
   elsif photo_enabled and not u.registered then raise exception 'Server photo verification required'; end if;
   if u.registered then
    return jsonb_build_object('attachment',(select to_jsonb(e)-'created_by_guest' from public.checklist_attachments e where e.id=u.id));
   end if;
  elsif u.registered then raise exception 'Upload authorization expired' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects where bucket_id='manager-checklist-evidence' and name=u.object_path) then raise exception 'Upload must complete before attachment'; end if;
  insert into public.checklist_attachments(id,submission_id,item_id,kind,object_path,created_by,created_by_guest,working_copy_id) values(u.id,s.id,u.item_id,u.kind,u.object_path,p_actor,g.id,w.id) returning * into a;
  update checklist_private.upload_intents set registered=true where id=u.id;
  return jsonb_build_object('attachment',to_jsonb(a)-'created_by_guest');
 end if;
 raise exception 'Unsupported checklist action';
end;
$$;
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
  select s.location_id,s.template_key,s.period_date,s.status,s.is_pilot,checklist_private.weekly_timing(s.template_key,s.period_date,s.template_snapshot->>'timezone',s.status,s.submitted_at,now()) weekly_timing
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
  'submissions',coalesce((select jsonb_agg((to_jsonb(s)-'weekly_timing')||case when s.weekly_timing is null then '{}'::jsonb else jsonb_build_object('weekly_timing',s.weekly_timing) end order by s.location_id,s.period_date,s.template_key) from summaries s),'[]'::jsonb)
 ) into result;
 -- New-policy site/week scores are authoritative even with no saved occurrence.
 result:=result||jsonb_build_object('weekly_periods',coalesce((select jsonb_agg(jsonb_build_object(
  'location_id',l.id,'period_date',d::date,'weekly_timing',checklist_private.weekly_timing('weekly',d::date,l.timezone,'missing',null,now()),
  'score',case when (select count(*) from public.checklist_submissions s where s.location_id=l.id and s.period_date=d::date
   and s.template_key in ('weekly','weekly_pm') and s.status='submitted'
   and s.submitted_at<checklist_private.weekly_due(s.template_key,s.period_date,s.template_snapshot->>'timezone'))=2 then 100 else 0 end)
  order by l.id,d) from public.locations l
  cross join lateral generate_series(date_trunc('week',p_start::timestamp),p_end::timestamp,interval '7 days') d
  where l.id=any(site_ids) and checklist_private.weekly_due('weekly',d::date,l.timezone) is not null),'[]'::jsonb));
 return result;
end;
$$;
-- Old clients cannot silently turn Completed Late into on-time completion.
create or replace function public.get_checklist_compliance(p_start date,p_end date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=checklist_private.compliance_summary(p_start,p_end);
 if exists(select 1 from jsonb_array_elements(result->'submissions') s where s->'weekly_timing'->>'phase'='completed_late') then
  raise exception 'Refresh TM Ops to view weekly on-time compliance' using errcode='22023';
 end if;
 return result;
end;
$$;
create function public.get_checklist_compliance(p_start date,p_end date,p_weekly_contract integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_weekly_contract is distinct from 1 then raise exception 'Refresh TM Ops to view weekly on-time compliance' using errcode='22023'; end if;
 return checklist_private.compliance_summary(p_start,p_end);
end;
$$;
revoke all on function public.get_checklist_compliance(date,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_checklist_compliance(date,date,integer) to authenticated;

revoke all on function checklist_private.freeze_weekly_policy(),checklist_private.weekly_policy_start(text),checklist_private.weekly_due(text,date,text),checklist_private.weekly_timing(text,date,text,text,timestamptz,timestamptz),checklist_private.weekly_options(text,timestamptz),checklist_private.authenticated_weekly_periods(uuid,date),public.checklist_weekly_periods(uuid,date) from public,anon,authenticated,service_role;
grant execute on function checklist_private.authenticated_weekly_periods(uuid,date),public.checklist_weekly_periods(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
