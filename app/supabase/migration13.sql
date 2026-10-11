-- migration13.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Stops the reporting views from bypassing row-level security.
--
-- daily_logs_computed and monthly_rollup (created at project setup, not used by the
-- app) were plain views owned by postgres, so they ran with the owner's privileges
-- and ignored RLS on daily_logs. Supabase also grants every new object in `public`
-- to anon and authenticated by default, so anyone holding the public key - no login
-- needed - could read every daily row for every location, and because
-- daily_logs_computed is a simple single-table view (auto-updatable) could also
-- update or delete daily logs through it, which RLS blocks on daily_logs itself.
--
-- Fix:
--   * security_invoker = true  -> the view runs as the CALLER, so daily_logs' RLS applies:
--     anon sees nothing; a signed-in user sees exactly what they can already read in
--     daily_logs itself. (Note: daily_logs' SELECT policy currently lets ANY signed-in user
--     read every site's rows; only writes are scoped per site.) Needs Postgres 15+.
--   * revoke write privileges  -> reporting views are read-only.
-- The service role / secret key and direct Postgres connections are unaffected.
--
-- To undo (not recommended):
--   alter view public.daily_logs_computed set (security_invoker = false);
--   alter view public.monthly_rollup      set (security_invoker = false);

alter view public.daily_logs_computed set (security_invoker = true);
alter view public.monthly_rollup      set (security_invoker = true);

revoke insert, update, delete, truncate, references, trigger
  on public.daily_logs_computed from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.monthly_rollup from anon, authenticated;
