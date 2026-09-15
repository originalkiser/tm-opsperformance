-- migration8.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds a starting-headcount + daily-growth-rate way to set the membership
-- target, so membership_goal (end-of-month) is derived instead of hand-
-- computed, and a day-by-day "on pace" comparison becomes possible
-- (mirroring how Revenue Pace already compares MTD Revenue % to month
-- progress). Existing membership_goal values are untouched — they keep
-- working as-is until a site's target is edited with the new fields.

alter table budget_targets
  add column if not exists starting_members integer;

alter table budget_targets
  add column if not exists membership_daily_growth numeric not null default 2;
