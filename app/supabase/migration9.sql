-- migration9.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds a "Reactivations" column to daily_logs, entered on the shop's daily
-- entry grid right after Best — shown (and saved) only for locations using
-- the "Detailed" opportunities formula. Purely a tracked count; it does not
-- feed into memberships_sold/opportunities/conversion math.

alter table daily_logs
  add column if not exists reactivations integer not null default 0;
