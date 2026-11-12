-- Local review only. Apply after the QR migration and PT409 correction, with separate release authorization.
-- No row backfill: authoritative capabilities/guards ignore legacy stored deadline values.
-- Retain draft continuation, immutable occurrence/timezone, all versions/evidence and original submitted_at.
begin;
create or replace function checklist_private.deadline(s public.checklist_submissions) returns timestamptz
language sql stable set search_path='' as $$
 select case when s.submitted_at is not null then
  ((s.period_date + case when s.template_snapshot->>'cadence'='weekly' then 7 else 1 end)::timestamp
   at time zone (s.template_snapshot->>'timezone'))
 else null end;
$$;

-- Preserve the corrected dispatcher and its grants; change only deadline storage and explanatory wording.
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
      or exists(select 1 from checklist_private.working_copies wc where wc.submission_id=c.id and wc.status='editing' and clock_timestamp()<checklist_private.deadline(c))) order by c.created_at desc,c.id offset off limit 101
  ) x;
  return jsonb_build_object('location',(select jsonb_build_object('id',id,'site_code',site_code,'timezone',timezone) from public.locations where id=loc),
   'templates',(select jsonb_agg(to_jsonb(ct) order by ct.key) from public.checklist_templates ct),
   'submissions',case when jsonb_array_length(result)>100 then result-100 else result end,'has_more',jsonb_array_length(result)>100,'next_offset',off+100,'server_now',clock_timestamp());
 end if;
 if p_action='start' then
  loc:=case when g.id is not null then g.location_id else (p_body->>'location_id')::uuid end;
  if g.id is null and checklist_private.assigned(loc,p_actor) is not true then raise exception 'Assigned location required' using errcode='42501'; end if;
  select timezone into tz from public.locations where id=loc;
  if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Valid site time zone required'; end if;
  select * into strict t from public.checklist_templates where key=p_body->>'template_key';
  day:=(clock_timestamp() at time zone tz)::date;
  d:=coalesce((p_body->>'period_date')::date,case when t.cadence='weekly' then date_trunc('week',day::timestamp)::date else day end);
  if not isfinite(d) or d>day or (t.cadence='weekly' and d<>date_trunc('week',d::timestamp)::date) then raise exception 'Invalid checklist business date/week'; end if;
  -- Guests start current periods; existing older drafts are resumed by immutable ID.
  if g.id is not null and d<>(case when t.cadence='weekly' then date_trunc('week',day::timestamp)::date else day end) then raise exception 'Start the current checklist period'; end if;
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
    edit_deadline_at=case when coalesce((p_body->>'submit')::boolean,false) then ((s.period_date + case when s.template_snapshot->>'cadence'='weekly' then 7 else 1 end)::timestamp at time zone (s.template_snapshot->>'timezone')) else null end
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
notify pgrst,'reload schema';
commit;
