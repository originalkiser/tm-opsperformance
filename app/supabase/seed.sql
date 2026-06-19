-- ============================================================
-- TM Operations Performance Tracker — Full Schema + Seed
-- Paste this into Supabase SQL Editor and run
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  site_code text unique not null,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  role text not null default 'store' check (role in ('store', 'area_manager', 'admin')),
  location_id uuid references locations(id),
  created_at timestamptz default now()
);

-- Auto-create a profile row whenever a new user signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (id, name, role)
  values (new.id, new.raw_user_meta_data->>'name', 'store')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Area managers can be mapped to multiple locations
create table if not exists manager_locations (
  manager_id uuid references auth.users(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  primary key (manager_id, location_id)
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade not null,
  name text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- One row per time slot per day per location
create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade not null,
  log_date date not null,
  time_slot time not null,
  employee_name text,
  google_reviews integer not null default 0,
  total_washes integer not null default 0,
  member_washes integer not null default 0,
  opportunities integer not null default 0,
  basic integer not null default 0,
  good integer not null default 0,
  better integer not null default 0,
  best integer not null default 0,
  memberships_sold integer not null default 0,
  net_members integer not null default 0,
  updated_at timestamptz default now(),
  created_by uuid references auth.users(id),
  unique (location_id, log_date, time_slot)
);

-- Separate kiosk-level daily summary (bottom table)
create table if not exists kiosk_summaries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade not null,
  log_date date not null,
  kiosk_name text,
  total_washes integer default 0,
  member_washes integer default 0,
  opportunities integer default 0,
  sold integer default 0,
  premium_sold integer default 0,
  updated_at timestamptz default now(),
  unique (location_id, log_date)
);

-- ── Row Level Security ───────────────────────────────────────

alter table locations enable row level security;
alter table user_profiles enable row level security;
alter table manager_locations enable row level security;
alter table employees enable row level security;
alter table daily_logs enable row level security;
alter table kiosk_summaries enable row level security;

-- Helper: current user's role
create or replace function get_user_role()
returns text language sql security definer stable as $$
  select role from user_profiles where id = auth.uid();
$$;

-- Helper: can this user write to a given location?
create or replace function user_can_edit_location(loc_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from user_profiles
    where id = auth.uid() and (role in ('admin', 'area_manager') or location_id = loc_id)
    union all
    select 1 from manager_locations
    where manager_id = auth.uid() and location_id = loc_id
  );
$$;

-- Locations: all authenticated users can read
drop policy if exists "locations_select" on locations;
create policy "locations_select" on locations
  for select to authenticated using (true);

-- User profiles
drop policy if exists "profiles_select" on user_profiles;
create policy "profiles_select" on user_profiles
  for select to authenticated using (id = auth.uid() or get_user_role() = 'admin');

drop policy if exists "profiles_update" on user_profiles;
create policy "profiles_update" on user_profiles
  for update to authenticated using (id = auth.uid() or get_user_role() = 'admin');

-- Employees
drop policy if exists "employees_select" on employees;
create policy "employees_select" on employees
  for select to authenticated using (true);

drop policy if exists "employees_write" on employees;
create policy "employees_write" on employees
  for all to authenticated using (get_user_role() in ('admin', 'area_manager'));

-- Daily logs
drop policy if exists "daily_logs_select" on daily_logs;
create policy "daily_logs_select" on daily_logs
  for select to authenticated using (true);

drop policy if exists "daily_logs_insert" on daily_logs;
create policy "daily_logs_insert" on daily_logs
  for insert to authenticated with check (user_can_edit_location(location_id));

drop policy if exists "daily_logs_update" on daily_logs;
create policy "daily_logs_update" on daily_logs
  for update to authenticated using (user_can_edit_location(location_id));

drop policy if exists "daily_logs_delete" on daily_logs;
create policy "daily_logs_delete" on daily_logs
  for delete to authenticated using (user_can_edit_location(location_id));

-- Kiosk summaries
drop policy if exists "kiosk_select" on kiosk_summaries;
create policy "kiosk_select" on kiosk_summaries
  for select to authenticated using (true);

drop policy if exists "kiosk_insert" on kiosk_summaries;
create policy "kiosk_insert" on kiosk_summaries
  for insert to authenticated with check (user_can_edit_location(location_id));

drop policy if exists "kiosk_update" on kiosk_summaries;
create policy "kiosk_update" on kiosk_summaries
  for update to authenticated using (user_can_edit_location(location_id));

drop policy if exists "kiosk_delete" on kiosk_summaries;
create policy "kiosk_delete" on kiosk_summaries
  for delete to authenticated using (user_can_edit_location(location_id));

-- Manager locations
drop policy if exists "mgr_locations_select" on manager_locations;
create policy "mgr_locations_select" on manager_locations
  for select to authenticated using (manager_id = auth.uid() or get_user_role() = 'admin');

drop policy if exists "mgr_locations_write" on manager_locations;
create policy "mgr_locations_write" on manager_locations
  for all to authenticated using (get_user_role() = 'admin');

-- ── Seed: Locations ──────────────────────────────────────────
-- Site codes truncated to text before the second hyphen

insert into locations (site_code, name) values
  ('1508-Mesquite',       '1508-Mesquite'),
  ('1509-Mesquite',       '1509-Mesquite'),
  ('1511-Allen',          '1511-Allen'),
  ('1512-Fort Mohave',    '1512-Fort Mohave'),
  ('1515-Albuquerque',    '1515-Albuquerque'),
  ('1516-Plano',          '1516-Plano'),
  ('1517-Forney',         '1517-Forney'),
  ('1518-Greenwood',      '1518-Greenwood'),
  ('1519-Greenville',     '1519-Greenville'),
  ('1520-Cleveland',      '1520-Cleveland'),
  ('1521-Port Arthur',    '1521-Port Arthur'),
  ('1522-Groves',         '1522-Groves'),
  ('1524-Beaumont',       '1524-Beaumont'),
  ('1525-Breaux Bridge',  '1525-Breaux Bridge'),
  ('1526-Mansura',        '1526-Mansura'),
  ('1527-Carencro',       '1527-Carencro'),
  ('1528-Dunedin',        '1528-Dunedin'),
  ('1529-Largo',          '1529-Largo'),
  ('1530-Batesville',     '1530-Batesville'),
  ('1531-Cape Girardeau', '1531-Cape Girardeau'),
  ('1532-Jackson',        '1532-Jackson')
on conflict (site_code) do nothing;
