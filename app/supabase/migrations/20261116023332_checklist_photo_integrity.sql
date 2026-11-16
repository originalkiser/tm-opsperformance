-- BOOTSTRAP ONLY. Enforcement starts DISABLED; no hosted execution is authorized.
-- Existing audits, upload clients, Storage policies and submission snapshots remain compatible.
begin;
create table checklist_private.photo_rollout (
 singleton boolean primary key default true check(singleton), enforced boolean not null default false,
 endpoint_version text, endpoint_deployment text, endpoint_verified_at timestamptz, activated_at timestamptz
);
insert into checklist_private.photo_rollout(singleton) values(true);
alter table checklist_private.photo_rollout enable row level security;
revoke all on checklist_private.photo_rollout from public,anon,authenticated,service_role;
alter table checklist_private.upload_intents add column photo_verifier_version text;
create table checklist_private.photo_fingerprints (
 attachment_id uuid primary key, submission_id uuid not null, location_id uuid not null,
 object_path text not null, sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 legacy boolean not null default false, state text not null check(state in ('pending','inaccessible','verified')),
 error_code text, checked_at timestamptz,
 check((state='verified')=(sha256 is not null))
);
create index checklist_photo_history_pending on checklist_private.photo_fingerprints(location_id,attachment_id) where state<>'verified';
-- No FK: retain only the fingerprint if draft evidence is discarded, never its image.
create table checklist_private.photo_claims (
 location_id uuid not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 attachment_id uuid not null, primary key(location_id,sha256)
);
alter table checklist_private.photo_fingerprints enable row level security;
alter table checklist_private.photo_claims enable row level security;
revoke all on checklist_private.photo_fingerprints,checklist_private.photo_claims from public,anon,authenticated,service_role;
create function checklist_private.claim_photo(p_attachment uuid,p_submission uuid,p_location uuid,p_path text,p_sha text) returns void
language plpgsql security definer set search_path='' as $$
declare winner uuid; enabled boolean; old_f checklist_private.photo_fingerprints;
begin
 select enforced into strict enabled from checklist_private.photo_rollout where singleton for share;
 select * into old_f from checklist_private.photo_fingerprints where attachment_id=p_attachment for update;
 if old_f.attachment_id is not null and (old_f.submission_id<>p_submission or old_f.location_id<>p_location or old_f.object_path<>p_path or (old_f.state='verified' and old_f.sha256 is distinct from p_sha)) then raise exception 'Photo verification mismatch'; end if;
 if p_sha is null or p_sha !~ '^[a-f0-9]{64}$' then raise exception 'Server photo verification required'; end if;
 -- The unique constraint arbitrates simultaneous requests even under different statement snapshots.
 insert into checklist_private.photo_claims(location_id,sha256,attachment_id) values(p_location,p_sha,p_attachment)
 on conflict(location_id,sha256) do update set sha256=excluded.sha256 returning attachment_id into winner;
 if enabled and winner<>p_attachment and old_f.attachment_id is null then raise exception 'This photo was already used for this location. Take a new photo of the current inspection.' using errcode='P0002'; end if;
 insert into checklist_private.photo_fingerprints(attachment_id,submission_id,location_id,object_path,sha256,legacy,state,checked_at)
 values(p_attachment,p_submission,p_location,p_path,p_sha,not enabled,'verified',clock_timestamp())
 on conflict(attachment_id) do update set sha256=excluded.sha256,state='verified',error_code=null,checked_at=excluded.checked_at;
end;
$$;
revoke all on function checklist_private.claim_photo(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;

create function checklist_private.guard_photo_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
declare enabled boolean;
begin
 if new.kind='photo' and exists(select 1 from public.checklist_submissions s where s.id=new.submission_id and s.template_key in ('opening','midday','closing','weekly','weekly_pm')) then
  select enforced into strict enabled from checklist_private.photo_rollout where singleton for share;
  if not enabled then
   insert into checklist_private.photo_fingerprints(attachment_id,submission_id,location_id,object_path,legacy,state)
    select new.id,new.submission_id,s.location_id,new.object_path,true,'pending' from public.checklist_submissions s where s.id=new.submission_id
    on conflict(attachment_id) do nothing;
   return new;
  end if;
  if not exists(select 1 from checklist_private.photo_fingerprints f join checklist_private.upload_intents u on u.id=f.attachment_id
   where f.attachment_id=new.id and f.submission_id=new.submission_id and f.object_path=new.object_path and f.state='verified' and not f.legacy
   and u.submission_id=new.submission_id and u.object_path=new.object_path and u.kind='photo' and u.item_id is not distinct from new.item_id
   and u.working_copy_id is not distinct from new.working_copy_id and u.actor_user is not distinct from new.created_by and u.actor_guest is not distinct from new.created_by_guest) then
   raise exception 'Server photo verification required';
  end if;
 end if;
 return new;
end;
$$;
revoke all on function checklist_private.guard_photo_attachment() from public,anon,authenticated,service_role;
create trigger checklist_photo_integrity before insert on public.checklist_attachments for each row execute function checklist_private.guard_photo_attachment();
-- Existing and transition-era photos are grandfathered; every later staging insert is queued by the trigger.
insert into checklist_private.photo_fingerprints(attachment_id,submission_id,location_id,object_path,legacy,state)
 select a.id,s.id,s.location_id,a.object_path,true,'pending' from public.checklist_attachments a
 join public.checklist_submissions s on s.id=a.submission_id
 where a.kind='photo' and s.template_key in ('opening','midday','closing','weekly','weekly_pm') on conflict(attachment_id) do nothing;


-- Authorized discard can remove an unhashed legacy draft. Do not strand its location behind a queue entry.
create function checklist_private.discard_pending_fingerprint() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from checklist_private.photo_fingerprints where attachment_id=old.id and legacy and state<>'verified';
 return old;
end;
$$;
revoke all on function checklist_private.discard_pending_fingerprint() from public,anon,authenticated,service_role;
create trigger checklist_photo_pending_discard after delete on public.checklist_attachments for each row execute function checklist_private.discard_pending_fingerprint();


create or replace function checklist_private.validate_answers(s public.checklist_submissions,p_answers jsonb,p_name text,p_submit boolean,p_work uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare i jsonb; a jsonb; ids uuid[];
begin
 if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>200000 or p_name is null or length(p_name)>200 then raise exception 'Invalid checklist answers or name'; end if;
 if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(s.template_snapshot->'definition') e where e->>'id'=k)) then raise exception 'Unknown answer item'; end if;
 ids:=checklist_private.evidence_ids(s,p_work);
 if p_submit and (select enforced from checklist_private.photo_rollout where singleton) and checklist_private.qr_template_allowed(s.template_key) and exists(
  select 1 from public.checklist_attachments e where e.id=any(ids) and e.kind='photo' and not exists(
   select 1 from checklist_private.photo_fingerprints f where f.attachment_id=e.id and (f.legacy or f.state='verified'))
 ) then raise exception 'Server photo verification required'; end if;

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


-- Readiness includes every eligible location, and all operational photos (even outside that set).
create function checklist_private.photo_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'enforced',(select enforced from checklist_private.photo_rollout where singleton),
 'endpoint_version',(select endpoint_version from checklist_private.photo_rollout where singleton),
 'endpoint_deployment',(select endpoint_deployment from checklist_private.photo_rollout where singleton),
 'endpoint_drained',(select coalesce(endpoint_verified_at<=clock_timestamp()-interval '10 minutes',false) from checklist_private.photo_rollout where singleton),
 'endpoint_drain_until',(select endpoint_verified_at+interval '10 minutes' from checklist_private.photo_rollout where singleton),
 'eligible_location_ids',(select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.locations where exclude_from_reporting is not true),
 'unverified_photos',(select count(*) from public.checklist_attachments a join public.checklist_submissions s on s.id=a.submission_id
   where a.kind='photo' and checklist_private.qr_template_allowed(s.template_key) and not exists(select 1 from checklist_private.photo_fingerprints f where f.attachment_id=a.id and f.object_path=a.object_path and f.location_id=s.location_id and f.state='verified')),
 'missing_objects',(select count(*) from public.checklist_attachments a join public.checklist_submissions s on s.id=a.submission_id
   where a.kind='photo' and checklist_private.qr_template_allowed(s.template_key) and not exists(select 1 from storage.objects o where o.bucket_id='manager-checklist-evidence' and o.name=a.object_path)),
 'in_flight_uploads',(select count(*) from checklist_private.upload_intents u join public.checklist_submissions s on s.id=u.submission_id
   where u.kind='photo' and checklist_private.qr_template_allowed(s.template_key) and not u.registered and u.expires_at>clock_timestamp()),
 'legacy_in_flight_uploads',(select count(*) from checklist_private.upload_intents u join public.checklist_submissions s on s.id=u.submission_id
   where u.kind='photo' and checklist_private.qr_template_allowed(s.template_key) and not u.registered and u.expires_at>clock_timestamp() and u.photo_verifier_version is distinct from 'sha256-v1'),
 'locations',(select coalesce(jsonb_agg(x order by x.location_id),'[]'::jsonb) from (
   select l.id location_id,l.site_code,count(a.id) photos,
    count(a.id) filter(where f.state is distinct from 'verified') unverified,
    count(a.id) filter(where f.state='inaccessible') inaccessible,
    count(a.id) filter(where o.id is null) missing_objects
   from public.locations l left join public.checklist_submissions s on s.location_id=l.id and checklist_private.qr_template_allowed(s.template_key)
   left join public.checklist_attachments a on a.submission_id=s.id and a.kind='photo'
   left join checklist_private.photo_fingerprints f on f.attachment_id=a.id and f.object_path=a.object_path and f.location_id=l.id
   left join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=a.object_path
   where l.exclude_from_reporting is not true group by l.id,l.site_code
 ) x));
$$;
revoke all on function checklist_private.photo_readiness() from public,anon,authenticated,service_role;

-- Service-only maintenance surface. Never exposed through checklist-access or to QR/account callers.
create function public.checklist_photo_history(p_action text,p_body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f checklist_private.photo_fingerprints; result jsonb; enabled boolean; expected_ids jsonb; changed integer;
begin
 if p_action='attest_endpoint' then
  if p_body->>'version' is distinct from 'sha256-v1' or btrim(coalesce(p_body->>'deployment_id',''))='' then raise exception 'Verified endpoint deployment required'; end if;
  -- Operator attestation only after observing the deployed version and compatible upload checks.
  update checklist_private.photo_rollout set endpoint_version='sha256-v1',endpoint_deployment=p_body->>'deployment_id',endpoint_verified_at=clock_timestamp() where singleton and (endpoint_deployment is distinct from p_body->>'deployment_id' or endpoint_version is distinct from 'sha256-v1');
  return jsonb_build_object('attested',true);
 elsif p_action='activate' then
  -- EXCLUSIVE phase barrier: all insertion, finish and maintenance writers take SHARE first.
  select enforced into strict enabled from checklist_private.photo_rollout where singleton for update;
  result:=checklist_private.photo_readiness();
  if result->>'endpoint_version' is distinct from 'sha256-v1' or btrim(coalesce(result->>'endpoint_deployment',''))='' then raise exception 'Verified endpoint deployment required'; end if;
  -- Exceeds Supabase's documented 400-second maximum paid-worker lifetime after verified deployment.
  if (result->>'endpoint_drained')::boolean is not true then raise exception 'Endpoint drain window is still open. Submissions remain available; retry activation later'; end if;
  if jsonb_typeof(p_body->'expected_location_ids') is distinct from 'array' then raise exception 'Confirm every eligible location before activation'; end if;
  select jsonb_agg(value order by value) into expected_ids from jsonb_array_elements_text(p_body->'expected_location_ids');
  if expected_ids is distinct from result->'eligible_location_ids' then raise exception 'Eligible locations changed; review every location before activation'; end if;
  if (result->>'unverified_photos')::bigint<>0 or (result->>'missing_objects')::bigint<>0 then raise exception 'Photo history is not ready. Resolve pending, inaccessible or missing photos before activation'; end if;
  if (result->>'in_flight_uploads')::bigint<>0 then raise exception 'Photo uploads are still in flight. Submissions remain available; retry activation after uploads finish'; end if;
  update checklist_private.photo_rollout set enforced=true,activated_at=coalesce(activated_at,clock_timestamp()) where singleton;
  return checklist_private.photo_readiness();
 elsif p_action='reconcile' then
  select enforced into strict enabled from checklist_private.photo_rollout where singleton for share;
  if enabled then raise exception 'Reconciliation is only available before activation'; end if;
  insert into checklist_private.photo_fingerprints(attachment_id,submission_id,location_id,object_path,legacy,state)
   select a.id,s.id,s.location_id,a.object_path,true,'pending' from public.checklist_attachments a join public.checklist_submissions s on s.id=a.submission_id
   where a.kind='photo' and checklist_private.qr_template_allowed(s.template_key) on conflict(attachment_id) do nothing;
  get diagnostics changed=row_count;
  return jsonb_build_object('queued',changed);
 elsif p_action='batch' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select attachment_id,object_path from checklist_private.photo_fingerprints
   where state=case when coalesce((p_body->>'retry_inaccessible')::boolean,false) then 'inaccessible' else 'pending' end
   and (p_body->>'after' is null or attachment_id>(p_body->>'after')::uuid) order by attachment_id limit 25
  ) x; return jsonb_build_object('objects',result);
 elsif p_action='record' then
  perform 1 from checklist_private.photo_rollout where singleton for share;
  select * into strict f from checklist_private.photo_fingerprints where attachment_id=(p_body->>'attachment_id')::uuid and legacy for update;
  if f.state='verified' then
   if f.sha256 is distinct from p_body->>'sha256' then raise exception 'Historical photo fingerprint mismatch'; end if;
   return jsonb_build_object('recorded',true);
  end if;
  if not exists(select 1 from storage.objects where bucket_id='manager-checklist-evidence' and name=f.object_path) then
   update checklist_private.photo_fingerprints set state='inaccessible',error_code='missing_object',checked_at=clock_timestamp() where attachment_id=f.attachment_id;
  elsif coalesce(p_body->>'sha256','') ~ '^[a-f0-9]{64}$' then
   -- Existing historical duplicates remain legitimate. They still block new reuse.
   insert into checklist_private.photo_claims values(f.location_id,p_body->>'sha256',f.attachment_id) on conflict do nothing;
   update checklist_private.photo_fingerprints set sha256=p_body->>'sha256',state='verified',error_code=null,checked_at=clock_timestamp() where attachment_id=f.attachment_id;
  else
   if p_body->>'error_code' not in ('download_failed','invalid_image') or p_body->>'error_code' is null then raise exception 'Explicit history error required'; end if;
   update checklist_private.photo_fingerprints set state='inaccessible',error_code=p_body->>'error_code',checked_at=clock_timestamp() where attachment_id=f.attachment_id;
  end if;
  return jsonb_build_object('recorded',true);
 elsif p_action='report' then
  return checklist_private.photo_readiness() || jsonb_build_object('counts',(select jsonb_object_agg(state,n) from (select state,count(*) n from checklist_private.photo_fingerprints group by state) x),
   'inaccessible',coalesce((select jsonb_agg(jsonb_build_object('attachment_id',attachment_id,'location_id',location_id,'error_code',error_code)) from checklist_private.photo_fingerprints where state='inaccessible'),'[]'::jsonb));
 end if;
 raise exception 'Unsupported photo history action';
end;
$$;
revoke all on function public.checklist_photo_history(text,jsonb) from public,anon,authenticated;
grant execute on function public.checklist_photo_history(text,jsonb) to service_role;
commit;
