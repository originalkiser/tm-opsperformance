-- migration10.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds "split hour" support: a single hourly time slot can now hold more
-- than one row (e.g. one employee 8:00-8:15, another 8:15-9:00), each with
-- its own cumulative running totals. split_index=0 is always the base row
-- for that hour; additional splits count up from 1.
--
-- Split into two steps with different timing requirements — see each one.

-- ── STEP 1 — safe to run right now, well ahead of deploying the new code ──
-- Just adds a column with a default; the currently-live app code doesn't
-- know about split_index and will simply ignore it. Existing rows all get
-- split_index=0, which is exactly what they already are conceptually.
alter table daily_logs
  add column if not exists split_index integer not null default 0;

-- ── STEP 2 — do NOT run until you're ready to push the new code live ──
-- This swaps the unique constraint the currently-live app's upsert relies on
-- (location_id, log_date, time_slot) for one that includes split_index. The
-- OLD constraint and the split-hour feature are mutually exclusive — the old
-- one caps each hour at exactly one row, which is the whole thing splitting
-- needs to violate — so they can't both be active, and the swap can't happen
-- gradually. The moment this runs, the OLD code's upsert (which still asks
-- for onConflict on the 3-column constraint) starts failing for every save,
-- old code or new, until the new code is live and asking for the 4-column
-- one instead.
--
-- Run this immediately before or right as you push, to keep that window as
-- short as possible — pushing first (so GitHub Actions' build/deploy is
-- already running in the background) and running this right after tends to
-- minimize the gap versus running this first and then pushing, since either
-- way the gap is bounded by how long the deploy takes to go live, not by
-- which order you do the two steps in.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'daily_logs'::regclass
      and contype = 'u'
      and conname = 'daily_logs_location_id_log_date_time_slot_key'
  ) then
    alter table daily_logs
      drop constraint daily_logs_location_id_log_date_time_slot_key;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'daily_logs'::regclass
      and contype = 'u'
      and conname = 'daily_logs_location_id_log_date_time_slot_split_index_key'
  ) then
    alter table daily_logs
      add constraint daily_logs_location_id_log_date_time_slot_split_index_key
      unique (location_id, log_date, time_slot, split_index);
  end if;
end;
$$;
