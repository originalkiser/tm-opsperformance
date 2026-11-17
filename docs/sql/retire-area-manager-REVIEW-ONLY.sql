-- LOCAL RELEASE ARTIFACT ONLY. Not applied to production or development.
-- Preserve Admin/Store roles, RLS, manager_locations and all historical attribution.
begin;
lock table public.user_profiles in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.user_profiles where role='area_manager') then
  raise exception 'Area Manager accounts still exist (including inactive/deleted). Stop; do not automatically reassign or delete them.';
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.user_profiles'::regclass and conname='user_profiles_role_check' and pg_get_constraintdef(oid)=$baseline$CHECK ((role = ANY (ARRAY['store'::text, 'area_manager'::text, 'admin'::text])))$baseline$) then
  raise exception 'Role constraint baseline differs. Inspect before release.';
 end if;
end;$$;
alter table public.user_profiles drop constraint user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check check(role in ('store','admin'));
-- Intentionally retain manager_locations: existing rows belong to Admin/Store accounts.
-- Existing RLS and historical migration definitions remain byte-identical.
commit;
