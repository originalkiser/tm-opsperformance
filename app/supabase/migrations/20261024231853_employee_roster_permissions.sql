-- REVIEW ONLY. Employee roster authorization only; not the paused identity migration.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
lock table public.employees in access exclusive mode;
do $$ begin
  if not exists(select 1 from pg_class where oid='public.employees'::regclass and relrowsecurity and relkind='r')
     or (select count(*) from pg_policies where schemaname='public' and tablename='employees')<>2
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='employees'
       and policyname='employees_select' and cmd='SELECT' and roles=array['authenticated']::name[] and qual='true')
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='employees'
       and policyname='employees_write' and cmd='ALL' and roles=array['authenticated']::name[]
       and qual='(get_user_role() = ANY (ARRAY[''admin''::text, ''area_manager''::text]))' and with_check is null) then
    raise exception 'Expected reviewed production employee policies; stop on drift or reapplication';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.employees'::regclass and attacl is not null)
     or to_regprocedure('public.can_maintain_employee_roster(uuid)') is not null then
    raise exception 'Unexpected employee column grants/helper; review before changing permissions';
  end if;
end $$;

-- Read only the caller's protected profile/assignments; never client role claims.
-- This helper returns a boolean, never mutates or grants access to another table.
create function public.can_maintain_employee_roster(loc_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id=auth.uid() and p.is_active is true and p.deleted_at is null
      and (
        p.role='admin'
        or (p.role='store' and p.location_id=loc_id)
        or (p.role='area_manager' and exists (
          select 1 from public.manager_locations ml
          where ml.manager_id=p.id and ml.location_id=loc_id
        ))
      )
  );
$$;
revoke all on function public.can_maintain_employee_roster(uuid) from public,anon,authenticated;
grant execute on function public.can_maintain_employee_roster(uuid) to authenticated;

drop policy employees_write on public.employees;
create policy employee_roster_insert on public.employees for insert to authenticated
  with check (public.can_maintain_employee_roster(location_id));
create policy employee_roster_update on public.employees for update to authenticated
  using (public.can_maintain_employee_roster(location_id))
  with check (public.can_maintain_employee_roster(location_id));

-- Preserve historical reporting SELECT. Allow only roster content/status edits,
-- never changing employee UUID/location, deletion, truncation or trigger creation.
revoke insert,update,delete,truncate,references,trigger on public.employees from public,anon,authenticated;
grant insert(location_id,name,is_active),update(name,is_active) on public.employees to authenticated;
-- No Daily Log, helper replacement, assignment, FK, schema, scoring or data changes.
commit;
