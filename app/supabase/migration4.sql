-- migration4.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds a settings JSONB column to user_profiles for cross-device preference sync
-- (currently used for per-role column order; extensible for future prefs).

alter table user_profiles
  add column if not exists settings jsonb not null default '{}'::jsonb;
