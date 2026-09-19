-- migration10.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds "split hour" support: a single hourly time slot can now hold more
-- than one row (e.g. one employee 8:00-8:15, another 8:15-9:00), each with
-- its own cumulative running totals. split_index=0 is always the base row
-- for that hour; additional splits count up from 1.
--
-- IMPORTANT: this must be applied before/with the app code that starts
-- upserting on (location_id, log_date, time_slot, split_index) — until this
-- runs, saving ANY row on the daily log (not just split rows) will fail,
-- because the upsert's conflict target changes for every row.

alter table daily_logs
  add column if not exists split_index integer not null default 0;

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
