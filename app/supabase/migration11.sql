-- migration11.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Tracks the outcome of the hand-off from a resolved downtime to Jotform, now
-- done server-side by the submit-downtime-jotform edge function. Purely
-- additive — the previous client-side hand-off just ignores these columns.
--
--   jotform_status        null (never attempted) | 'sending' | 'sent' | 'failed'
--   jotform_error         the reason, when status is 'failed'
--   jotform_attempted_at  when the last attempt started (also guards against two
--                         overlapping attempts double-submitting the same downtime)

alter table downtime_logs
  add column if not exists jotform_status text;

alter table downtime_logs
  add column if not exists jotform_error text;

alter table downtime_logs
  add column if not exists jotform_attempted_at timestamptz;

-- Rows that already have a Jotform submission ID were, by definition, sent.
update downtime_logs
set jotform_status = 'sent'
where jotform_submission_id is not null
  and jotform_status is null;
