-- Draft-only question removal. No templates, grants, submissions or evidence are rewritten.
-- Required signatures, conditional chains and the weekly section-photo dependency stay protected.
begin;
set local lock_timeout='3s';
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='configuration_private.validate_template(text,jsonb,boolean,integer)'::regprocedure) is distinct from '431555f23b1069890b8c92cbb48ed9fb' then
  raise exception 'Checklist configuration validator differs from the reviewed baseline; stop for drift review';
 end if;
end $$;
create or replace function configuration_private.validate_template(p_key text,p_definition jsonb,p_restore boolean default false,p_base_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.checklist_templates; i jsonb; old jsonb; normalized jsonb:='[]';
 ids text[]:='{}'; prior_sections text[]:='{}'; current_section text; item_id text; amount integer;
 n integer; number_in_section integer:=0; required_uploads integer:=1; j integer; baseline jsonb; renumber boolean;
 editable text[]:=array['text','instruction','critical','section','number','photo_required','photo_min_count','na_allowed'];
begin
 select * into strict t from public.checklist_templates where key=p_key;
 baseline:=t.definition;
 if p_base_version is not null then select definition into strict baseline from configuration_private.template_versions where template_key=p_key and version=p_base_version; end if;
 if jsonb_typeof(p_definition) is distinct from 'array' then raise exception 'Question list required'; end if;
 if jsonb_array_length(p_definition) not between 1 and 150 or octet_length(p_definition::text)>200000 then raise exception 'Checklist exceeds question or size limits'; end if;
 -- Check omitted baseline questions on save, preview, publish AND restore. A caller
 -- cannot remove a whole conditional chain or strip a signature to evade protection.
 for old in select e from jsonb_array_elements(baseline) e where not exists(
  select 1 from jsonb_array_elements(p_definition) candidate where candidate->>'id'=e->>'id') loop
  if coalesce((old->>'signature_required')::boolean,false) then
   raise exception 'Cannot remove question with a required signature: %',old->>'id';
  end if;
  if old ? 'condition' or exists(select 1 from jsonb_array_elements(baseline) child where child->'condition'->>'item_id'=old->>'id') then
   raise exception 'Cannot remove conditional follow-up or its parent question: %',old->>'id';
  end if;
  if p_key='weekly' and old->>'id'='weekly-9' then
   raise exception 'Cannot remove system-dependent communications-board photo question: %',old->>'id';
  end if;
 end loop;
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
    or i->'required'<>'true'::jsonb then raise exception 'Invalid new question fields'; end if;
   if jsonb_typeof(i->'type') is distinct from 'string' then raise exception 'Choose an approved question type'; end if;
   if not ((i->>'type'='completion' and i->'options'='["Completed","Not Completed"]'::jsonb and i->'failure_values'='["Not Completed"]'::jsonb)
    or (i->>'type'='yesno' and i->'options'='["Yes","No"]'::jsonb and i->'failure_values'='["No"]'::jsonb)
    or (i->>'type'='passfail' and i->'options'='["Passed","Failed"]'::jsonb and i->'failure_values'='["Failed"]'::jsonb)
    or (i->>'type'='text' and i->'options'='[]'::jsonb and i->'failure_values'='[]'::jsonb)) then raise exception 'Choose an approved question type'; end if;
  end if;
  if jsonb_typeof(i->'text') is distinct from 'string' or length(btrim(i->>'text')) not between 1 and 2000
   or jsonb_typeof(i->'section') is distinct from 'string' or length(btrim(i->>'section')) not between 1 and 200
   or jsonb_typeof(i->'instruction') is distinct from 'string' or length(i->>'instruction')>2000
   or jsonb_typeof(i->'na_allowed') is distinct from 'boolean'
   or (i->>'type'='text' and i->'na_allowed'<>'false'::jsonb)
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
-- CREATE OR REPLACE retains the existing private ACL. No new API or grant.
commit;
