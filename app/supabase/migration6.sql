-- migration6.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds Budget Tracking, Ownership Log, and Ownership Scorecard — all hidden
-- per-location until enabled via Admin → Locations.

-- ── 0. Per-location feature toggles ────────────────────────────────────────────
alter table locations
  add column if not exists show_budget_tracking boolean not null default false;

alter table locations
  add column if not exists show_ownership_tools boolean not null default false;

-- 24h "HH:MM" string; null falls back to the app's default (18:00) in code.
alter table locations
  add column if not exists ownership_log_cutoff_time text;

-- ── 1. Monthly targets (revenue/membership/rating/labor goals) ────────────────
create table if not exists budget_targets (
  id                      uuid primary key default gen_random_uuid(),
  location_id             uuid not null references locations(id) on delete cascade,
  target_month            date not null, -- always the 1st of the month
  revenue_goal            numeric not null default 0,
  membership_goal         integer not null default 0,
  desired_rating          numeric not null default 4.85,
  labor_hours_non_salary  numeric not null default 0,
  labor_hours_with_salary numeric not null default 0,
  created_by              uuid references user_profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (location_id, target_month)
);

alter table budget_targets enable row level security;

drop policy if exists "budget_targets_select" on budget_targets;
create policy "budget_targets_select" on budget_targets
  for select to authenticated
  using (user_can_edit_location(location_id));

drop policy if exists "budget_targets_write" on budget_targets;
create policy "budget_targets_write" on budget_targets
  for all to authenticated
  using (user_can_manage_location(location_id))
  with check (user_can_manage_location(location_id));

-- ── 2. Daily Yesterday + MTD entry ──────────────────────────────────────────────
create table if not exists budget_daily_entries (
  id                  uuid primary key default gen_random_uuid(),
  location_id         uuid not null references locations(id) on delete cascade,
  entry_date          date not null, -- the day being entered ("today")
  yesterday_washes    integer,
  yesterday_redemptions integer,
  yesterday_basic     integer,
  yesterday_good      integer,
  yesterday_better    integer,
  yesterday_best      integer,
  mtd_washes          integer,
  mtd_redemptions     integer,
  mtd_basic           integer,
  mtd_good            integer,
  mtd_better          integer,
  mtd_best            integer,
  mtd_revenue_actual  numeric,
  current_rating      numeric,
  current_reviews     integer,
  entered_by          uuid references user_profiles(id),
  updated_at          timestamptz not null default now(),
  unique (location_id, entry_date)
);

alter table budget_daily_entries enable row level security;

drop policy if exists "budget_daily_entries_all" on budget_daily_entries;
create policy "budget_daily_entries_all" on budget_daily_entries
  for all to authenticated
  using (user_can_edit_location(location_id))
  with check (user_can_edit_location(location_id));

-- ── 3. Ownership Log (daily post) ───────────────────────────────────────────────
create table if not exists ownership_log_entries (
  id                     uuid primary key default gen_random_uuid(),
  location_id            uuid not null references locations(id) on delete cascade,
  log_date               date not null,
  yesterday_conversion_pct numeric,
  biggest_challenge      text,
  what_you_did           text,
  plan_for_today         text,
  comments               text,
  submitted_at           timestamptz,
  submitted_by           uuid references user_profiles(id),
  updated_at             timestamptz not null default now(),
  unique (location_id, log_date)
);

alter table ownership_log_entries enable row level security;

drop policy if exists "ownership_log_entries_all" on ownership_log_entries;
create policy "ownership_log_entries_all" on ownership_log_entries
  for all to authenticated
  using (user_can_edit_location(location_id))
  with check (user_can_edit_location(location_id));

-- ── 4. Ownership Scorecard (monthly manager rating) ─────────────────────────────
create table if not exists ownership_scorecard_entries (
  id                    uuid primary key default gen_random_uuid(),
  location_id           uuid not null references locations(id) on delete cascade,
  score_month           date not null, -- 1st of the month
  manager_name          text,
  problem_solving       integer,
  consistency           integer,
  stay_open_mentality   integer,
  team_leadership       integer,
  compliance            integer,
  communication         integer,
  car_wash_knowledge    integer,
  kpi_targeting         integer,
  team_player           integer,
  site_management       integer,
  submitted_by          uuid references user_profiles(id),
  updated_at            timestamptz not null default now(),
  unique (location_id, score_month)
);

alter table ownership_scorecard_entries enable row level security;

drop policy if exists "ownership_scorecard_select" on ownership_scorecard_entries;
create policy "ownership_scorecard_select" on ownership_scorecard_entries
  for select to authenticated
  using (user_can_edit_location(location_id));

drop policy if exists "ownership_scorecard_write" on ownership_scorecard_entries;
create policy "ownership_scorecard_write" on ownership_scorecard_entries
  for all to authenticated
  using (user_can_manage_location(location_id))
  with check (user_can_manage_location(location_id));

-- ── 5. Manager-only location check (admin, or the assigned area manager —
--    NOT plain store users). Used to gate Targets and the Scorecard, which
--    only admins/area managers should be able to set.
create or replace function user_can_manage_location(loc_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from user_profiles
    where id = auth.uid() and role = 'admin'
    union all
    select 1 from manager_locations
    where manager_id = auth.uid() and location_id = loc_id
  );
$$;
