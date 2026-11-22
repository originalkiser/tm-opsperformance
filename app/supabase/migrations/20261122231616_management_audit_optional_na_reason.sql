-- Keep audit N/A explanations optional without changing answer, photo or signature requirements.
-- No stored templates or submissions are changed. Existing function identity and ACL are retained.
begin;
set local lock_timeout = '3s';

do $$ begin
 if (select md5(prosrc) from pg_proc where oid = to_regprocedure(
   'checklist_private.validate_answers_before_photo_counts(public.checklist_submissions,jsonb,text,boolean,uuid)'
 )) is distinct from '87227fea1ab4bac7832c753b8f4838c4' then
  raise exception 'Checklist answer validator differs from the reviewed baseline; stop for drift review';
 end if;
end $$;

create or replace function checklist_private.validate_answers_before_photo_counts(s public.checklist_submissions,p_answers jsonb,p_name text,p_submit boolean,p_work uuid default null) returns void
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
   if ((i->'failure_values') ? (a->>'value') or
    case when a->>'value'='N/A' then s.template_key not in ('monthly_site_assessment','quarterly_safety_audit')
         else coalesce((i->>'explanation_required')::boolean,false) end) and btrim(coalesce(a->>'explanation',''))='' then raise exception 'Explanation required: %',i->>'text'; end if;
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

commit;
