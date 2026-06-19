-- Run this in Supabase SQL Editor to apply schema updates
-- Safe to run multiple times (all use IF NOT EXISTS / ON CONFLICT DO NOTHING)

-- Add email to user_profiles so area managers can trigger password resets
alter table user_profiles add column if not exists email text;

-- Update the auto-create trigger to capture email
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (id, name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'store',
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- Allow area managers to read user_profiles for their locations
drop policy if exists "area_mgr_profiles_select" on user_profiles;
create policy "area_mgr_profiles_select" on user_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or get_user_role() in ('admin', 'area_manager')
  );

-- Allow area managers to update profiles for their location's users
drop policy if exists "area_mgr_profiles_update" on user_profiles;
create policy "area_mgr_profiles_update" on user_profiles
  for update to authenticated
  using (
    id = auth.uid()
    or get_user_role() = 'admin'
    or (
      get_user_role() = 'area_manager'
      and exists (
        select 1 from manager_locations ml
        where ml.manager_id = auth.uid()
        and ml.location_id = user_profiles.location_id
      )
    )
  );
