-- PROPOSED ONLY. Requires separate production authorization. No operational documents.
begin;
create schema resource_private;
revoke all on schema resource_private from public,anon,authenticated;
grant usage on schema resource_private to authenticated;

create table public.resource_documents (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(btrim(title)) between 1 and 200),
 category text not null check(category in ('General Manager Workbook','Equipment Manuals','Standard Operating Procedures (SOPs)','Employee Handbook','Other Reference Materials')),
 brand text not null default '' check(length(brand)<=100),
 object_path text unique, original_name text, file_size bigint check(file_size between 1 and 52428800),
 -- One in-flight upload and one retired object; not a version history.
 pending_upload jsonb, cleanup_path text unique, removed boolean not null default false,
 revision integer not null default 1,
 created_by uuid references public.user_profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(category<>'Equipment Manuals' or length(btrim(brand))>0)
);
alter table public.resource_documents enable row level security;
revoke all on public.resource_documents from public,anon,authenticated;
grant select on public.resource_documents to authenticated;

create function resource_private.allowed(p_admin boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=(select auth.uid())
 and p.is_active=true and p.deleted_at is null
 and (p.role='admin' or (not p_admin and p.role='store')));
$$;
create policy resources_read on public.resource_documents for select to authenticated using
 (resource_private.allowed() and (resource_private.allowed(true) or (object_path is not null and not removed)));

create function resource_private.can_upload(p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare d public.resource_documents;
begin
 if not resource_private.allowed(true) then return false; end if;
 select * into d from public.resource_documents where pending_upload->>'path'=p_path and not removed for share;
 return found;
end;
$$;
create function resource_private.can_read(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select resource_private.allowed() and exists(select 1 from public.resource_documents d where
 (not d.removed and d.object_path=p_path) or
 (resource_private.allowed(true) and (d.pending_upload->>'path'=p_path or d.cleanup_path=p_path)));
$$;
create function resource_private.guard_upload() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.bucket_id='resource-pdfs' and not resource_private.can_upload(new.name) then
  raise exception using errcode='42501',message='Resource upload is no longer authorized';
 end if;
 return new;
end;
$$;
create trigger resource_upload_guard before insert or update on storage.objects
 for each row execute function resource_private.guard_upload();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('resource-pdfs','resource-pdfs',false,52428800,array['application/pdf']);
create policy resource_pdf_read on storage.objects for select to authenticated using
 (bucket_id='resource-pdfs' and resource_private.can_read(name));
create policy resource_pdf_upload on storage.objects for insert to authenticated with check
 (bucket_id='resource-pdfs' and resource_private.can_upload(name));
-- Guard only this bucket, including against unrelated broad permissive policies.
create policy resource_pdf_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id is distinct from 'resource-pdfs') with check(bucket_id is distinct from 'resource-pdfs');
create policy resource_pdf_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id is distinct from 'resource-pdfs' or resource_private.can_read(name));
create policy resource_pdf_upload_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id is distinct from 'resource-pdfs' or resource_private.can_upload(name));
create policy resource_pdf_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id is distinct from 'resource-pdfs') with check(bucket_id is distinct from 'resource-pdfs');
create policy resource_pdf_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id is distinct from 'resource-pdfs');

create function public.manage_resource(p_action text,p_id uuid default null,p_revision integer default null,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.resource_documents; size_bytes bigint; filename text;
begin
 if not resource_private.allowed(true) then raise exception 'Active Admin required'; end if;
 if p_action='prepare' and p_id is null then
  insert into public.resource_documents(title,category,brand,created_by)
  values(btrim(p_data->>'title'),p_data->>'category',btrim(coalesce(p_data->>'brand','')),auth.uid()) returning * into d;
 else
  select * into d from public.resource_documents where id=p_id for update;
  if not found then raise exception 'Resource no longer exists'; end if;
  if p_revision is distinct from d.revision then raise exception 'Resource changed; refresh before continuing'; end if;
 end if;
 if p_action in ('prepare','edit','remove') and (d.removed or d.pending_upload is not null or d.cleanup_path is not null) then
  raise exception 'Finish or cancel the pending upload/cleanup first';
 end if;
 if p_action='prepare' then
  size_bytes:=(p_data->>'size')::bigint; filename:=p_data->>'filename';
  if size_bytes is null or size_bytes<1 or size_bytes>52428800 or filename is null or
   length(filename)>255 or filename !~* '\.pdf$' or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'PDF required; maximum 50 MB and file fingerprint required'; end if;
  update public.resource_documents set pending_upload=jsonb_build_object('path',d.id::text||'/'||gen_random_uuid()::text||'.pdf','filename',filename,'size',size_bytes,'sha256',p_data->>'sha256')
   where id=d.id;
 elsif p_action='publish' then
  if d.removed or d.pending_upload is null or d.cleanup_path is not null then raise exception 'No upload available to publish'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='resource-pdfs' and o.name=d.pending_upload->>'path'
   and o.metadata->>'mimetype'='application/pdf' and (o.metadata->>'size')::bigint=(d.pending_upload->>'size')::bigint) then
   raise exception 'Complete PDF upload required before publishing';
  end if;
  update public.resource_documents set cleanup_path=d.object_path,object_path=d.pending_upload->>'path',
   original_name=d.pending_upload->>'filename',file_size=(d.pending_upload->>'size')::bigint,pending_upload=null where id=d.id;
 elsif p_action='edit' then
  update public.resource_documents set title=btrim(p_data->>'title'),category=p_data->>'category',brand=btrim(coalesce(p_data->>'brand','')) where id=d.id;
 elsif p_action='cancel' then
  if d.pending_upload is null or d.cleanup_path is not null then raise exception 'No pending upload to cancel'; end if;
  update public.resource_documents set cleanup_path=d.pending_upload->>'path',pending_upload=null where id=d.id;
 elsif p_action='remove' then
  update public.resource_documents set removed=true,cleanup_path=d.object_path,object_path=null where id=d.id;
 elsif p_action='cleanup' then
  if d.cleanup_path is null then raise exception 'No cleanup pending'; end if;
  return jsonb_build_object('id',d.id,'path',d.cleanup_path,'revision',d.revision);
 elsif p_action='finish_cleanup' then
  if d.cleanup_path is null or exists(select 1 from storage.objects where bucket_id='resource-pdfs' and name=d.cleanup_path) then
   raise exception 'Storage deletion must complete first';
  end if;
  if d.object_path is null and d.pending_upload is null then
   delete from public.resource_documents where id=d.id;
   return jsonb_build_object('id',d.id,'deleted',true);
  end if;
  update public.resource_documents set cleanup_path=null where id=d.id;
 else raise exception 'Unknown resource action';
 end if;
 update public.resource_documents set revision=revision+1,updated_at=now() where id=d.id returning * into d;
 return to_jsonb(d);
end;
$$;
revoke all on all functions in schema resource_private from public,anon,authenticated;
grant execute on function resource_private.allowed(boolean),resource_private.can_read(text),resource_private.can_upload(text) to authenticated;
revoke all on function public.manage_resource(text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.manage_resource(text,uuid,integer,jsonb) to authenticated;
commit;
