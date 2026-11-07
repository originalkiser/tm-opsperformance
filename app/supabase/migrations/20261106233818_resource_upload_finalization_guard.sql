-- REVIEW ONLY. Follow-up to the already installed Resource Center migration.
-- Storage probes RLS as the caller, then writes final metadata as service_role.
-- Keep caller authorization unchanged; validate the retained owner for that write.
begin;
create or replace function resource_private.guard_upload() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.bucket_id is distinct from 'resource-pdfs' then return new; end if;
 if auth.uid() is null and current_setting('role',true)='service_role' then
  -- Only the trusted Storage finalizer may use owner identity instead of a JWT sub.
  -- Lock the reservation so cancellation cannot race a completed upload.
  perform d.id from public.resource_documents d join public.user_profiles p
   on p.id::text=coalesce(nullif(to_jsonb(new)->>'owner_id',''),to_jsonb(new)->>'owner')
   where d.pending_upload->>'path'=new.name and not d.removed
    and p.role='admin' and p.is_active=true and p.deleted_at is null
   for share of d,p;
  if found then return new; end if;
 elsif resource_private.can_upload(new.name) then
  return new;
 end if;
 raise exception using errcode='42501',message='Resource upload is no longer authorized';
end;
$$;
commit;
