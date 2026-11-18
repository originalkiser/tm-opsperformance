-- PREPARED LOCALLY ONLY. No production grants or identities are included.
-- Install only after separate release approval and production metadata verification.
begin;
set local lock_timeout='3s';
revoke insert,update,delete,truncate,references,trigger on public.checklist_templates from public,anon,authenticated;
revoke insert(key,name,cadence,definition,version,updated_at,updated_by),update(key,name,cadence,definition,version,updated_at,updated_by),references(key,name,cadence,definition,version,updated_at,updated_by) on public.checklist_templates from public,anon,authenticated;
create schema if not exists configuration_private;
revoke all on schema configuration_private from public,anon,authenticated,service_role;

create table configuration_private.super_admins (
 user_id uuid primary key references public.user_profiles(id) on delete restrict,
 granted_at timestamptz not null default clock_timestamp()
);
-- Deliberately empty. Provision verified existing accounts separately, never by display name.
create table configuration_private.template_drafts (
 template_key text primary key references public.checklist_templates(key),
 base_version integer not null, revision integer not null default 0,
 definition jsonb not null, editing boolean not null default true,
 preview_revision integer, restored_from integer, updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null
);
create table configuration_private.template_versions (
 template_key text not null references public.checklist_templates(key), version integer not null,
 definition jsonb not null, name text not null,cadence text not null,
 published_at timestamptz not null, published_by uuid, note text not null,
 restored_from integer,
 primary key(template_key,version)
);
create table configuration_private.template_revisions (
 template_key text not null references public.checklist_templates(key), revision integer not null,
 base_version integer not null, definition jsonb not null,
 action text not null check(action in ('save','restore','publish')),
 note text not null, recorded_at timestamptz not null default clock_timestamp(), actor uuid not null,
 primary key(template_key,revision)
);
alter table configuration_private.super_admins enable row level security;
alter table configuration_private.template_drafts enable row level security;
alter table configuration_private.template_versions enable row level security;
alter table configuration_private.template_revisions enable row level security;
revoke all on all tables in schema configuration_private from public,anon,authenticated,service_role;

-- Capture installed published definitions exactly; never overwrite saved snapshots.
insert into configuration_private.template_versions(template_key,version,definition,name,cadence,published_at,published_by,note)
 select key,version,definition,name,cadence,updated_at,updated_by,'Verified installation baseline' from public.checklist_templates;

create function configuration_private.is_super_admin(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from configuration_private.super_admins c join public.user_profiles p on p.id=c.user_id
 where c.user_id=p_actor and p.role='admin' and p.is_active=true and p.deleted_at is null);
$$;
create function configuration_private.capabilities() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_edit_templates',configuration_private.is_super_admin(auth.uid()));
$$;
create function public.configuration_capabilities() returns jsonb
language sql stable security invoker set search_path='' as $$
 select configuration_private.capabilities();
$$;

-- All profile mutations, including direct API updates/deletes, are protected.
-- Service requests without an end-user identity fail closed for protected profiles.
create function configuration_private.guard_super_admin_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from configuration_private.super_admins where user_id=old.id)
 and not configuration_private.is_super_admin(auth.uid()) then
  raise exception 'Super Admin required to modify this protected account' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger protect_super_admin_profile before update or delete on public.user_profiles
 for each row execute function configuration_private.guard_super_admin_profile();

-- Called with the signed-in client's JWT before any privileged Auth API mutation.
create function configuration_private.authorize_admin_user_action(p_target uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and role='admin' and is_active=true and deleted_at is null)
 then raise exception 'Active Admin required' using errcode='42501'; end if;
 if exists(select 1 from configuration_private.super_admins where user_id=p_target)
 and not configuration_private.is_super_admin(auth.uid()) then
  raise exception 'Super Admin required to manage this protected account' using errcode='42501';
 end if;
 return true;
end;
$$;
create function public.authorize_admin_user_action(p_target uuid) returns boolean
language sql security invoker set search_path='' as $$
 select configuration_private.authorize_admin_user_action(p_target);
$$;

-- Validate only approved presentation/evidence edits. All operational semantics stay frozen.
create function configuration_private.validate_template(p_key text,p_definition jsonb,p_restore boolean default false,p_base_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.checklist_templates; i jsonb; old jsonb; normalized jsonb:='[]';
 ids text[]:='{}'; prior_sections text[]:='{}'; current_section text; item_id text; amount integer;
 n integer; number_in_section integer:=0; required_uploads integer:=1; j integer; baseline jsonb; renumber boolean;
 editable text[]:=array['text','instruction','critical','section','number','photo_required','photo_min_count'];
begin
 select * into strict t from public.checklist_templates where key=p_key;
 baseline:=t.definition;
 if p_base_version is not null then select definition into strict baseline from configuration_private.template_versions where template_key=p_key and version=p_base_version; end if;
 if jsonb_typeof(p_definition) is distinct from 'array' then raise exception 'Question list required'; end if;
 if jsonb_array_length(p_definition) not between 1 and 150 or octet_length(p_definition::text)>200000 then raise exception 'Checklist exceeds question or size limits'; end if;
 -- Existing questions cannot be removed through an arbitrary save. Restore uses trusted history.
 if not p_restore and exists(select 1 from jsonb_array_elements(baseline) e where not exists(
  select 1 from jsonb_array_elements(p_definition) candidate where candidate->>'id'=e->>'id')) then raise exception 'Existing question IDs must be preserved'; end if;
 renumber:=not p_restore and ((select jsonb_agg(e->>'id' order by ord) from jsonb_array_elements(baseline) with ordinality x(e,ord)) is distinct from
   (select jsonb_agg(e->>'id' order by ord) from jsonb_array_elements(p_definition) with ordinality x(e,ord)));
 for i in select value from jsonb_array_elements(p_definition) loop
  if jsonb_typeof(i) is distinct from 'object' then raise exception 'Invalid question'; end if;
  item_id:=i->>'id';
  if item_id is null or item_id=any(ids) or length(item_id)>150 then raise exception 'Missing or duplicate question ID'; end if;
  ids:=array_append(ids,item_id);
  select e into old from configuration_private.template_versions v cross join lateral jsonb_array_elements(v.definition) e
   where v.template_key=p_key and e->>'id'=item_id order by v.version limit 1;
  if old is not null then
   if (old-editable) is distinct from (i-editable) then raise exception 'Protected response, signature or conditional rules changed: %',item_id; end if;
   if not p_restore and not renumber and (i->'number') is distinct from
    (select e->'number' from jsonb_array_elements(baseline) e where e->>'id'=item_id) then raise exception 'Question numbering is generated, not directly editable'; end if;
  else
   if item_id !~ '^q-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'New question requires a unique generated ID'; end if;
   if (select count(*) from jsonb_object_keys(i))<>(12+case when i ? 'number' then 1 else 0 end) or not (i ?& array['id','section','text','instruction','type','options','failure_values','critical','photo_required','photo_min_count','na_allowed','required'])
    or i->'required'<>'true'::jsonb or i->'na_allowed'<>'false'::jsonb then raise exception 'Invalid new question fields'; end if;
   if jsonb_typeof(i->'type') is distinct from 'string' then raise exception 'Choose an approved question type'; end if;
   if not ((i->>'type'='completion' and i->'options'='["Completed","Not Completed"]'::jsonb and i->'failure_values'='["Not Completed"]'::jsonb)
    or (i->>'type'='yesno' and i->'options'='["Yes","No"]'::jsonb and i->'failure_values'='["No"]'::jsonb)
    or (i->>'type'='passfail' and i->'options'='["Passed","Failed"]'::jsonb and i->'failure_values'='["Failed"]'::jsonb)
    or (i->>'type'='text' and i->'options'='[]'::jsonb and i->'failure_values'='[]'::jsonb)) then raise exception 'Choose an approved question type'; end if;
  end if;
  if jsonb_typeof(i->'text') is distinct from 'string' or length(btrim(i->>'text')) not between 1 and 2000
   or jsonb_typeof(i->'section') is distinct from 'string' or length(btrim(i->>'section')) not between 1 and 200
   or jsonb_typeof(i->'instruction') is distinct from 'string' or length(i->>'instruction')>2000
   or jsonb_typeof(i->'critical') is distinct from 'boolean' or jsonb_typeof(i->'photo_required') is distinct from 'boolean' then raise exception 'Invalid question text or flags'; end if;
  if i ? 'photo_min_count' then
   if jsonb_typeof(i->'photo_min_count') is distinct from 'number' or (i->>'photo_min_count') !~ '^(10|[0-9])$' then raise exception 'Required photo count must be 0–10'; end if;
   amount:=(i->>'photo_min_count')::integer;
  else amount:=case when (i->>'photo_required')::boolean then 1 else 0 end; end if;
  if (i->>'photo_required')::boolean is distinct from (amount>0) then raise exception 'Photo flag must match required count'; end if;
  required_uploads:=required_uploads+greatest(amount,case when coalesce((i->>'photo_on_failure')::boolean,false) then 1 else 0 end)
    +case when coalesce((i->>'signature_required')::boolean,false) then 1 else 0 end;
  if current_section is distinct from i->>'section' then
   if (i->>'section')=any(prior_sections) then raise exception 'Keep each section together'; end if;
   current_section:=i->>'section'; prior_sections:=array_append(prior_sections,current_section); number_in_section:=0;
  end if;
  number_in_section:=number_in_section+1;
  if i ? 'condition' and not (i->'condition'->>'item_id')=any(ids[1:cardinality(ids)-1]) then raise exception 'Keep conditional follow-ups after their parent question'; end if;
  normalized:=normalized||jsonb_build_array(case when renumber then i||jsonb_build_object('number',number_in_section) else i end);
 end loop;
 if required_uploads>180 then raise exception 'Required evidence exceeds 180 uploads; the existing 200-upload limit reserves room for corrections/retries'; end if;
 return normalized;
end;
$$;

create function configuration_private.template_editor(p_action text,p_key text,p_revision integer,p_version integer,p_definition jsonb,p_note text,p_restore_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.checklist_templates; d configuration_private.template_drafts; new_definition jsonb; result jsonb; new_revision integer; past configuration_private.template_versions; restore_source integer;
begin
 if not configuration_private.is_super_admin(auth.uid()) then raise exception 'Super Admin required' using errcode='42501'; end if;
 if p_action not in ('read','save','preview','publish','restore','version','revisions') or p_action is null or length(coalesce(p_note,''))>2000 then raise exception 'Invalid editor action or note'; end if;
 perform set_config('lock_timeout','3s',true);
 -- Lock the active actor against concurrent deactivation/demotion throughout the operation.
 perform 1 from public.user_profiles where id=auth.uid() for share;
 if not configuration_private.is_super_admin(auth.uid()) then raise exception 'Super Admin access changed' using errcode='42501'; end if;
 select * into strict t from public.checklist_templates where key=p_key for update;
 select * into d from configuration_private.template_drafts where template_key=p_key for update;
 if p_action='version' then
  select * into strict past from configuration_private.template_versions where template_key=p_key and version=p_restore_version;
  return to_jsonb(past)-'published_by';
 elsif p_action='revisions' then
  return jsonb_build_object('revisions',coalesce((select jsonb_agg(to_jsonb(r)-'actor' order by r.revision desc) from configuration_private.template_revisions r where r.template_key=p_key),'[]'::jsonb));
 elsif p_action<>'read' then
  if p_revision is distinct from coalesce(d.revision,0) or p_version is distinct from t.version then raise exception 'Template changed elsewhere. Reload and review before saving' using errcode='PT409'; end if;
  if p_action='restore' then
   select * into strict past from configuration_private.template_versions where template_key=p_key and version=p_restore_version;
   new_definition:=configuration_private.validate_template(p_key,past.definition,true);
  elsif p_action='save' then
   new_definition:=configuration_private.validate_template(p_key,p_definition,false,case when d.editing then d.restored_from else null end);
  else
   if d.template_key is null or not d.editing or d.base_version<>t.version then raise exception 'Save a draft against the current published version first' using errcode='PT409'; end if;
   new_definition:=configuration_private.validate_template(p_key,d.definition,true);
  end if;
  if p_action='preview' then
   update configuration_private.template_drafts set preview_revision=revision where template_key=p_key;
   return jsonb_build_object('definition',new_definition,'revision',d.revision,'base_version',d.base_version,'name',t.name,'cadence',t.cadence);
  end if;
  if p_action='publish' and d.preview_revision is distinct from d.revision then raise exception 'Preview the complete saved draft before publishing'; end if;
  if p_action='publish' and btrim(coalesce(p_note,''))='' then raise exception 'Enter a publication note'; end if;
  new_revision:=coalesce(d.revision,0)+1;
  restore_source:=case when p_action='restore' then p_restore_version when d.editing then d.restored_from else null end;
  insert into configuration_private.template_drafts(template_key,base_version,revision,definition,editing,updated_by,restored_from)
   values(p_key,t.version,new_revision,new_definition,p_action<>'publish',auth.uid(),restore_source)
   on conflict(template_key) do update set base_version=excluded.base_version,revision=excluded.revision,definition=excluded.definition,
    editing=excluded.editing,preview_revision=null,updated_at=clock_timestamp(),updated_by=excluded.updated_by,restored_from=excluded.restored_from;
  insert into configuration_private.template_revisions(template_key,revision,base_version,definition,action,note,actor)
   values(p_key,new_revision,t.version,new_definition,case when p_action='restore' then 'restore' when p_action='publish' then 'publish' else 'save' end,coalesce(p_note,''),auth.uid());
  if p_action='publish' then
   update public.checklist_templates set definition=new_definition,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where key=p_key returning * into t;
   insert into configuration_private.template_versions(template_key,version,definition,name,cadence,published_at,published_by,note,restored_from)
    values(p_key,t.version,new_definition,t.name,t.cadence,t.updated_at,auth.uid(),p_note,restore_source);
  end if;
 end if;
 select * into d from configuration_private.template_drafts where template_key=p_key;
 return jsonb_build_object('published',to_jsonb(t)-'updated_by','draft',case when d.template_key is null then null else to_jsonb(d)-'updated_by' end,
  'versions',coalesce((select jsonb_agg(jsonb_build_object('version',v.version,'published_at',v.published_at,'note',v.note) order by v.version desc) from configuration_private.template_versions v where v.template_key=p_key),'[]'::jsonb));
end;
$$;

create function public.checklist_template_editor(p_action text,p_key text,p_revision integer default null,p_version integer default null,p_definition jsonb default null,p_note text default '',p_restore_version integer default null) returns jsonb
language sql security invoker set search_path='' as $$
 select configuration_private.template_editor(p_action,p_key,p_revision,p_version,p_definition,p_note,p_restore_version);
$$;
-- Retire the immediate-publish path entirely: even privileged callers must use drafts/history.
create or replace function public.configure_checklist_pilot(p_action text,p_value jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if (public.configuration_capabilities()->>'can_edit_templates')::boolean is distinct from true then raise exception 'Super Admin required' using errcode='42501'; end if;
 raise exception 'Use the checklist draft, preview and publish editor; immediate publishing is disabled';
end;
$$;

-- Preserve the existing evidence/signature/photo-integrity validator verbatim, then
-- layer count enforcement on the same immutable snapshot and effective evidence set.
alter function checklist_private.validate_answers(public.checklist_submissions,jsonb,text,boolean,uuid) rename to validate_answers_before_photo_counts;
create function checklist_private.validate_answers(s public.checklist_submissions,p_answers jsonb,p_name text,p_submit boolean,p_work uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare i jsonb; amount integer; valid integer; ids uuid[];
begin
 perform checklist_private.validate_answers_before_photo_counts(s,p_answers,p_name,p_submit,p_work);
 if not p_submit then return; end if;
 ids:=checklist_private.evidence_ids(s,p_work);
 for i in select value from jsonb_array_elements(s.template_snapshot->'definition') loop
  if not i ? 'photo_min_count' then continue; end if; -- legacy snapshots retain their exact boolean semantics
  if i ? 'condition' and (p_answers->(i->'condition'->>'item_id')->>'value') is distinct from (i->'condition'->>'value') then continue; end if;
  amount:=greatest((i->>'photo_min_count')::integer,case when coalesce((i->>'photo_on_failure')::boolean,false) and (i->'failure_values') ? (p_answers->(i->>'id')->>'value') then 1 else 0 end);
  select count(distinct e.id) into valid from public.checklist_attachments e join storage.objects o on o.bucket_id='manager-checklist-evidence' and o.name=e.object_path
   where e.id=any(ids) and e.submission_id=s.id and e.item_id=i->>'id' and e.kind='photo';
  if valid<amount then raise exception 'Required photos missing: % needs %, has %',i->>'text',amount,valid; end if;
 end loop;
end;
$$;
revoke all on all functions in schema configuration_private from public,anon,authenticated,service_role;
revoke all on function checklist_private.validate_answers_before_photo_counts(public.checklist_submissions,jsonb,text,boolean,uuid),checklist_private.validate_answers(public.checklist_submissions,jsonb,text,boolean,uuid) from public,anon,authenticated,service_role;
grant usage on schema configuration_private to authenticated;
grant execute on function configuration_private.template_editor(text,text,integer,integer,jsonb,text,integer) to authenticated;
grant execute on function configuration_private.capabilities(),configuration_private.authorize_admin_user_action(uuid) to authenticated;
revoke all on function public.configuration_capabilities(),public.authorize_admin_user_action(uuid),public.checklist_template_editor(text,text,integer,integer,jsonb,text,integer),public.configure_checklist_pilot(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.configuration_capabilities(),public.authorize_admin_user_action(uuid),public.checklist_template_editor(text,text,integer,integer,jsonb,text,integer),public.configure_checklist_pilot(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
