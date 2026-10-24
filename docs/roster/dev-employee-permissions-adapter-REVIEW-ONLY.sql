-- DEV ONLY: authorized 2026-10-24 for bmfvcnsuduttebxbjvwx. Never production.
-- Preserve all records and unrelated permissions. Exact PR #38 helper/grants.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
lock table public.employees in access exclusive mode;
do $$ begin
 if to_regprocedure('public.can_maintain_employee_roster(uuid)') is not null
   or (select count(*) from pg_policies where schemaname='public' and tablename='employees')<>2
   or not exists(select 1 from pg_policies where schemaname='public' and tablename='employees'
      and policyname='tmdev_employees_write' and cmd='ALL' and qual='user_can_manage_location(location_id)' and with_check='user_can_manage_location(location_id)')
   or not exists(select 1 from pg_policies where schemaname='public' and tablename='employees' and policyname='tmdev_employees_read' and cmd='SELECT' and qual='true')
 then raise exception 'Known development employee baseline required; stop on drift'; end if;
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

drop policy tmdev_employees_write on public.employees;
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
