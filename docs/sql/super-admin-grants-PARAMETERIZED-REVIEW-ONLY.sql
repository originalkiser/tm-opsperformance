-- SEPARATE RELEASE AUTHORIZATION REQUIRED. Never run as part of migration installation.
-- Trusted operator supplies tmops.super_admin_manifest on the same connection:
-- JSON array of exactly 3 objects: {email_sha256,uuid_sha256}, privately derived
-- from freshly verified Auth/profile UUID pairs and confirmed login identities.
-- No actual account identifiers or fingerprints are stored in this file.
-- No application RPC can execute this grant. Pause/drain account administration
-- before the initial grant so an earlier authorized Auth API call cannot remain in flight.
begin;
set local lock_timeout='3s';
do $$
declare manifest jsonb; item jsonb; matched uuid; ids uuid[]:='{}'; n integer;
begin
 manifest:=nullif(current_setting('tmops.super_admin_manifest',true),'')::jsonb;
 if jsonb_typeof(manifest) is distinct from 'array' then raise exception 'Verified private account manifest required'; end if;
 if jsonb_array_length(manifest)<>3 then raise exception 'Exactly three verified accounts required'; end if;
 lock table configuration_private.super_admins in exclusive mode;
 if exists(select 1 from configuration_private.super_admins) then raise exception 'Capability grants already exist; stop and review'; end if;
 for item in select value from jsonb_array_elements(manifest) loop
  if coalesce(item->>'email_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'uuid_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid private verification manifest'; end if;
  select count(*) into n from auth.users u join public.user_profiles p on p.id=u.id
   where encode(sha256(convert_to(lower(u.email),'UTF8')),'hex')=item->>'email_sha256'
   and encode(sha256(convert_to(u.id::text,'UTF8')),'hex')=item->>'uuid_sha256'
   and p.role='admin' and p.is_active=true and p.deleted_at is null and (p.email is null or lower(p.email)=lower(u.email));
  if n<>1 then raise exception 'Account identity is missing, ambiguous or no longer eligible; no grants applied'; end if;
  select p.id into matched from auth.users u join public.user_profiles p on p.id=u.id
   where encode(sha256(convert_to(lower(u.email),'UTF8')),'hex')=item->>'email_sha256'
   and encode(sha256(convert_to(u.id::text,'UTF8')),'hex')=item->>'uuid_sha256'
   and p.role='admin' and p.is_active=true and p.deleted_at is null and (p.email is null or lower(p.email)=lower(u.email)) for share of p,u;
  if matched is null or matched=any(ids) then raise exception 'Invalid or duplicate verified identity; no grants applied'; end if;
  ids:=array_append(ids,matched);
 end loop;
 insert into configuration_private.super_admins(user_id) select unnest(ids);
end;
$$;
select count(*) as granted_accounts from configuration_private.super_admins;
commit;
