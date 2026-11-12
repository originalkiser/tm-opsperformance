-- Development/review only. No production execution authorized by this file.
-- Additive capability access and preserved corrections; existing records/evidence stay intact.
begin;
create table checklist_private.qr_grants (
 id uuid primary key default gen_random_uuid(), location_id uuid not null unique references public.locations(id),
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'), generation integer not null default 1,
 is_active boolean not null default true, created_at timestamptz not null default clock_timestamp(),
 rotated_at timestamptz not null default clock_timestamp(), created_by uuid not null references public.user_profiles(id)
);
create unique index checklist_qr_token_hash on checklist_private.qr_grants(token_hash);
create table checklist_private.qr_rate (
 grant_id uuid primary key references checklist_private.qr_grants(id), window_start timestamptz not null, requests integer not null
);
alter table public.checklist_submissions alter column created_by drop not null;
alter table public.checklist_submissions add column created_by_guest uuid references checklist_private.qr_grants(id);
alter table public.checklist_submissions add column edit_deadline_at timestamptz;
alter table public.checklist_submissions add constraint checklist_submission_actor check((created_by is null)<>(created_by_guest is null));
alter table public.checklist_attachments alter column created_by drop not null;
alter table public.checklist_attachments add column created_by_guest uuid references checklist_private.qr_grants(id);
alter table public.checklist_attachments add constraint checklist_attachment_actor check((created_by is null)<>(created_by_guest is null));
create table checklist_private.working_copies (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.checklist_submissions(id),
 base_revision integer not null, revision integer not null default 1, status text not null default 'editing' check(status in ('editing','applied')),
 answers jsonb not null, manager_name text not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create unique index checklist_one_working_copy on checklist_private.working_copies(submission_id) where status='editing';
alter table public.checklist_attachments add column working_copy_id uuid references checklist_private.working_copies(id);
create table checklist_private.versions (
 submission_id uuid not null references public.checklist_submissions(id), revision integer not null,
 answers jsonb not null, manager_name text not null, template_snapshot jsonb not null, evidence_ids uuid[] not null,
 recorded_at timestamptz not null, actor_user uuid references public.user_profiles(id), actor_guest uuid references checklist_private.qr_grants(id),
 primary key(submission_id,revision), check((actor_user is null)<>(actor_guest is null))
);
create table checklist_private.upload_intents (
 id uuid primary key, submission_id uuid not null references public.checklist_submissions(id) on delete cascade, working_copy_id uuid references checklist_private.working_copies(id),
 object_path text unique not null, kind text not null check(kind in ('photo','signature')), item_id text,
 actor_user uuid references public.user_profiles(id), actor_guest uuid references checklist_private.qr_grants(id), guest_generation integer,
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(), registered boolean not null default false,
 check((actor_user is null)<>(actor_guest is null))
);
create index checklist_upload_submission on checklist_private.upload_intents(submission_id);
create index checklist_upload_actor_user on checklist_private.upload_intents(actor_user,created_at);
create index checklist_upload_actor_guest on checklist_private.upload_intents(actor_guest,created_at);
-- Private objects remain inaccessible through the Data API, even with broad default grants.
alter table checklist_private.qr_grants enable row level security;
alter table checklist_private.qr_rate enable row level security;
alter table checklist_private.working_copies enable row level security;
alter table checklist_private.versions enable row level security;
alter table checklist_private.upload_intents enable row level security;
revoke all on checklist_private.qr_grants,checklist_private.qr_rate,checklist_private.working_copies,checklist_private.versions,checklist_private.upload_intents from public,anon,authenticated,service_role;

create function checklist_private.deadline(s public.checklist_submissions) returns timestamptz
language sql stable set search_path='' as $$
 select coalesce(s.edit_deadline_at,(((s.submitted_at at time zone (s.template_snapshot->>'timezone'))::date+1)::timestamp at time zone (s.template_snapshot->>'timezone')));
$$;
create function checklist_private.actor_allowed(s public.checklist_submissions,p_actor uuid,p_guest uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_guest is not null then p_actor is null and exists(select 1 from checklist_private.qr_grants g where g.id=p_guest and g.is_active and g.location_id=s.location_id)
 else p_actor is not null and checklist_private.assigned(s.location_id,p_actor) and (s.created_by is not distinct from p_actor or (not p_write and exists(select 1 from public.user_profiles u where u.id=p_actor and u.role='admin'))) end;
$$;
create function checklist_private.evidence_ids(s public.checklist_submissions,p_work uuid default null) returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(a.id order by a.created_at,a.id),'{}'::uuid[]) from public.checklist_attachments a
 where a.submission_id=s.id and (
  (a.working_copy_id is not distinct from p_work and (p_work is not null or s.status='draft')) or
  (s.status='submitted' and (not exists(select 1 from checklist_private.versions v where v.submission_id=s.id and v.revision=s.revision)
    or exists(select 1 from checklist_private.versions v where v.submission_id=s.id and v.revision=s.revision and a.id=any(v.evidence_ids)))
    and (p_work is null or a.kind<>'signature'))
 );
$$;
create function checklist_private.record_version(s public.checklist_submissions,p_actor uuid,p_guest uuid,p_ids uuid[]) returns void
language sql security definer set search_path='' as $$
 insert into checklist_private.versions(submission_id,revision,answers,manager_name,template_snapshot,evidence_ids,recorded_at,actor_user,actor_guest)
 values(s.id,s.revision,s.answers,s.manager_name,s.template_snapshot,p_ids,coalesce(s.updated_at,s.submitted_at),p_actor,p_guest)
 on conflict(submission_id,revision) do nothing;
$$;
create function checklist_private.validate_answers(s public.checklist_submissions,p_answers jsonb,p_name text,p_submit boolean,p_work uuid default null) returns void
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
   if a is null or btrim(coalesce(a->>'value',''))='' then raise exception 'Required response: %',i->>'text'; end if;
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
create function checklist_private.reply(s public.checklist_submissions,p_actor uuid,p_guest uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w checklist_private.working_copies; result jsonb; ids uuid[]; writable boolean; correction boolean; ts timestamptz:=clock_timestamp();
begin
 if checklist_private.actor_allowed(s,p_actor,p_guest,false) is not true then raise exception 'Checklist access unavailable' using errcode='42501'; end if;
 writable:=checklist_private.actor_allowed(s,p_actor,p_guest,true);
 correction:=writable and s.status='submitted' and ts<checklist_private.deadline(s);
 if correction then select * into w from checklist_private.working_copies where submission_id=s.id and status='editing'; end if;
 result:=to_jsonb(s)||jsonb_build_object('actor_kind',case when s.created_by_guest is null then 'account' else 'guest' end);
 if w.id is not null then result:=result||jsonb_build_object('working_copy_id',w.id,'base_revision',s.revision,'revision',w.revision,'answers',w.answers,'manager_name',w.manager_name); end if;
 ids:=checklist_private.evidence_ids(s,w.id);
 return jsonb_build_object('submission',result,'evidence',coalesce((select jsonb_agg(to_jsonb(a)-'created_by_guest' order by a.created_at,a.id) from public.checklist_attachments a where a.id=any(ids)),'[]'::jsonb),
 'capabilities',jsonb_build_object('can_edit',writable and (s.status='draft' or (correction and w.id is not null)),
 'can_begin_edit',correction and w.id is null,'can_correct',correction and w.id is null,'can_upload',writable and (s.status='draft' or (correction and w.id is not null)),
 'can_discard',p_guest is null and s.status in ('draft','discarding') and (writable or exists(select 1 from public.user_profiles where id=p_actor and role='admin')),
 'edit_deadline_at',checklist_private.deadline(s),'server_now',ts));
end;
$$;

-- One private dispatcher; only the verified server wrapper can supply an actor/guest hash.
create function checklist_private.access_action(p_actor uuid,p_hash text,p_action text,p_body jsonb) returns jsonb
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
   if (p_body->>'expected_generation')::integer is distinct from coalesce(g.generation,0) then raise exception 'QR access changed elsewhere. Reload before changing it' using errcode='40001'; end if;
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
  if s.status<>'submitted' or ts>=checklist_private.deadline(s) then raise exception 'Same-submission-day correction window is closed' using errcode='42501'; end if;
  if (p_body->>'revision')::integer is distinct from s.revision then raise exception 'Checklist changed elsewhere. Reload before editing' using errcode='40001'; end if;
  perform checklist_private.record_version(s,s.created_by,s.created_by_guest,checklist_private.evidence_ids(s));
  insert into checklist_private.working_copies(submission_id,base_revision,answers,manager_name) values(s.id,s.revision,s.answers,s.manager_name)
   on conflict(submission_id) where status='editing' do nothing;
  return checklist_private.reply(s,p_actor,g.id);
 end if;
 if p_body->>'working_copy_id' is not null then
  select * into w from checklist_private.working_copies where id=(p_body->>'working_copy_id')::uuid and submission_id=s.id and status='editing' for update;
  if not found or w.base_revision<>s.revision or s.status<>'submitted' or ts>=checklist_private.deadline(s) then raise exception 'Correction is no longer editable' using errcode='42501'; end if;
 elsif s.status<>'draft' then raise exception 'Start a same-day correction before editing' using errcode='42501'; end if;
 if p_action='save' then
  if (p_body->>'revision')::integer is distinct from (case when w.id is null then s.revision else w.revision end) then raise exception 'Checklist changed elsewhere. Reload before saving' using errcode='40001'; end if;
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
    edit_deadline_at=case when coalesce((p_body->>'submit')::boolean,false) then (((ts at time zone (s.template_snapshot->>'timezone'))::date+1)::timestamp at time zone (s.template_snapshot->>'timezone')) else null end
    where id=s.id returning * into s;
  end if;
  if coalesce((p_body->>'submit')::boolean,false) then
   perform checklist_private.record_version(s,p_actor,g.id,ids);
   insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,new_values)
    values('checklist_submissions',s.location_id,s.period_date,p_actor,s.manager_name,case when w.id is null then 'Checklist submitted; MonitorQA remains official' else 'Checklist same-day correction submitted; original retained' end,
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
-- The server verifies auth.getUser or hashes a presented QR secret; clients cannot spoof p_actor.
create function public.checklist_access_server(p_actor uuid,p_token_hash text,p_action text,p_body jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select checklist_private.access_action(p_actor,p_token_hash,p_action,p_body); $$;
revoke all on function public.checklist_access_server(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.checklist_access_server(uuid,text,text,jsonb) to service_role;
grant usage on schema checklist_private to service_role;
grant execute on function checklist_private.access_action(uuid,text,text,jsonb) to service_role;

-- Preserve the existing authenticated RPC surface, with null-safe centralized ownership.
create or replace function public.save_checklist(p_template text,p_location uuid,p_date date,p_id uuid default null,
 p_revision integer default null,p_answers jsonb default '{}'::jsonb,p_name text default '',p_submit boolean default false)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; s public.checklist_submissions;
begin
 if p_id is null then
  if p_submit then raise exception 'Save a draft and evidence before submitting'; end if;
  if p_date is null then raise exception 'Invalid checklist business date/week'; end if;
  result:=checklist_private.access_action(auth.uid(),null,'start',jsonb_build_object('template_key',p_template,'location_id',p_location,'period_date',p_date,'answers',p_answers,'manager_name',coalesce(p_name,'')));
 else
  select * into strict s from public.checklist_submissions where id=p_id;
  if s.created_by is distinct from auth.uid() or s.location_id is distinct from p_location or s.template_key is distinct from p_template or s.period_date is distinct from p_date then raise exception 'Draft owner or occurrence mismatch'; end if;
  if s.status<>'draft' then raise exception 'Submitted checklists are immutable through the legacy draft endpoint'; end if;
  result:=checklist_private.access_action(auth.uid(),null,'save',jsonb_build_object('id',p_id,'revision',p_revision,'answers',p_answers,'manager_name',coalesce(p_name,''),'submit',p_submit));
 end if;
 return result->'submission';
end;
$$;

-- Storage may finish using a service key after its initial permission probe.
-- Capability and account validity, freeze state and correction deadline are checked again here.
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
revoke all on function checklist_private.deadline(public.checklist_submissions),checklist_private.actor_allowed(public.checklist_submissions,uuid,uuid,boolean),checklist_private.evidence_ids(public.checklist_submissions,uuid),checklist_private.record_version(public.checklist_submissions,uuid,uuid,uuid[]),checklist_private.validate_answers(public.checklist_submissions,jsonb,text,boolean,uuid),checklist_private.reply(public.checklist_submissions,uuid,uuid),checklist_private.access_action(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function checklist_private.access_action(uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
