-- Synthetic reproduction of administrator-supplied production policy expressions.
-- Only loaded by the guarded local validation harness after the fixture.
do $$ begin
  if current_database()<>'tm_identity_foundation_test' or current_user<>'identity_test_admin' or inet_server_addr() is not null then
    raise exception 'Guarded disposable local fixture required';
  end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.user_profiles(id uuid primary key,role text not null,location_id uuid,is_active boolean default true,deleted_at timestamptz);
create table public.manager_locations(manager_id uuid,location_id uuid,primary key(manager_id,location_id));
insert into public.user_profiles values
 ('40000000-0000-0000-0000-000000000001','admin',null,true,null),
 ('40000000-0000-0000-0000-000000000002','area_manager',null,true,null),
 ('40000000-0000-0000-0000-000000000003','area_manager',null,true,null),
 ('40000000-0000-0000-0000-000000000004','store','10000000-0000-0000-0000-000000000001',true,null),
 ('40000000-0000-0000-0000-000000000005','store','10000000-0000-0000-0000-000000000001',false,null),
 ('40000000-0000-0000-0000-000000000006','store','10000000-0000-0000-0000-000000000001',true,'2026-10-01');
insert into public.manager_locations values('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
create function public.current_user_role() returns text language sql security definer as $$ select role from user_profiles where id=auth.uid() $$;
create function public.get_user_role() returns text language sql stable security definer as $$ select role from user_profiles where id=auth.uid() $$;
create function public.user_can_edit_location(loc_id uuid) returns boolean language sql stable security definer as $$
 select exists(select 1 from user_profiles where id=auth.uid() and (role='admin' or location_id=loc_id)
 union all select 1 from manager_locations where manager_id=auth.uid() and location_id=loc_id) $$;
create function public.user_manages_location(loc_id uuid) returns boolean language sql security definer as $$
 select exists(select 1 from user_profiles where id=auth.uid() and location_id=loc_id
 union select 1 from manager_locations where manager_id=auth.uid() and location_id=loc_id) $$;
drop policy fixture_read_employees on public.employees;
drop policy fixture_read_logs on public.daily_logs;
drop policy fixture_write_logs on public.daily_logs;
create policy employees_select on public.employees for select to authenticated using(true);
create policy employees_write on public.employees for all to authenticated using(get_user_role()=any(array['admin','area_manager']));
create policy "area managers can read all" on public.daily_logs for select to public using(current_user_role()=any(array['area_manager','admin']));
create policy daily_logs_delete on public.daily_logs for delete to authenticated using(user_can_edit_location(location_id));
create policy daily_logs_insert on public.daily_logs for insert to authenticated with check(user_can_edit_location(location_id));
create policy daily_logs_select on public.daily_logs for select to authenticated using(true);
create policy daily_logs_update on public.daily_logs for update to authenticated using(user_can_edit_location(location_id));
create policy "store can write own location" on public.daily_logs for all to public using(user_manages_location(location_id));
alter table public.user_profiles enable row level security;
alter table public.manager_locations enable row level security;
create policy profiles_select on public.user_profiles for select to authenticated using(id=auth.uid() or get_user_role()='admin');
create policy mgr_locations_select on public.manager_locations for select to authenticated using(get_user_role()=any(array['admin','area_manager']) or manager_id=auth.uid());
grant usage on schema public,auth to anon,authenticated,service_role;
grant all on public.employees,public.daily_logs,public.user_profiles,public.manager_locations to anon,authenticated,service_role;
-- Identity migration does not alter these supplied legacy authorization rules.
