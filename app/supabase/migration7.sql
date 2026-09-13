-- migration7.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Adds an append-only audit log for Budget Target and Ownership Scorecard
-- edits, so a mid-month change (who, when, what) is always visible.

create table if not exists edit_audit_log (
  id               uuid primary key default gen_random_uuid(),
  table_name       text not null,          -- 'budget_targets' | 'ownership_scorecard_entries'
  location_id      uuid not null references locations(id) on delete cascade,
  period           date not null,          -- the target_month / score_month this edit affected
  changed_by       uuid references user_profiles(id),
  changed_by_name  text,                   -- snapshot at edit time, in case the profile name changes later
  summary          text,                   -- human-readable "Field: old → new; ..." diff
  old_values       jsonb,
  new_values       jsonb,
  changed_at       timestamptz not null default now()
);

alter table edit_audit_log enable row level security;

-- Same viewers as the underlying tables (store users see their own site's history)
drop policy if exists "edit_audit_log_select" on edit_audit_log;
create policy "edit_audit_log_select" on edit_audit_log
  for select to authenticated
  using (user_can_edit_location(location_id));

-- Only admins/area managers write these tables, so only they can log entries.
-- Append-only: no update/delete policy, so history can't be edited after the fact.
drop policy if exists "edit_audit_log_insert" on edit_audit_log;
create policy "edit_audit_log_insert" on edit_audit_log
  for insert to authenticated
  with check (user_can_manage_location(location_id));

create index if not exists edit_audit_log_location_period_idx
  on edit_audit_log (location_id, period desc);
