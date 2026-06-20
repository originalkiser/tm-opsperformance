-- migration2.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.

-- ── 0. Add employee_name column and unique constraint if missing ──
alter table daily_logs
  add column if not exists employee_name text;

-- Required for upsert ON CONFLICT (location_id, log_date, time_slot)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'daily_logs'::regclass
      and contype = 'u'
      and conname = 'daily_logs_location_id_log_date_time_slot_key'
  ) then
    alter table daily_logs
      add constraint daily_logs_location_id_log_date_time_slot_key
      unique (location_id, log_date, time_slot);
  end if;
end;
$$;

-- ── 1. Opportunities formula per location ─────────────────────
alter table locations
  add column if not exists opportunities_formula text
  not null default 'detailed'
  check (opportunities_formula in ('simple', 'detailed'));

-- ── 2. Allow admin to update locations ────────────────────────
drop policy if exists "locations_update" on locations;
create policy "locations_update" on locations
  for update to authenticated
  using (get_user_role() = 'admin');

-- ── 3. Expand manager_locations visibility ────────────────────
-- Admins + area managers need to see all rows for the Locations UI
drop policy if exists "mgr_locations_select" on manager_locations;
create policy "mgr_locations_select" on manager_locations
  for select to authenticated
  using (get_user_role() in ('admin', 'area_manager') or manager_id = auth.uid());

-- ── 4. Fix user_can_edit_location so area_managers only edit  ──
--    their assigned locations (not all locations)               ──
--    NOTE: skip this if you want area_managers to edit everywhere
create or replace function user_can_edit_location(loc_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from user_profiles
    where id = auth.uid()
      and (
        role = 'admin'
        or location_id = loc_id
      )
    union all
    select 1 from manager_locations
    where manager_id = auth.uid() and location_id = loc_id
  );
$$;
