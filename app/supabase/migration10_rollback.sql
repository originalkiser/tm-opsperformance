-- migration10_rollback.sql
-- Reverts migration10.sql (split-hour entry) if the feature needs to come
-- back out. Written 2026-09-19, before migration10.sql/the split-hour code
-- was pushed, as a "just in case" plan.
--
-- ── Code rollback ────────────────────────────────────────────────────────
-- The last commit live on GitHub Pages before split-hour entry was:
--
--   e993a95  Add Reactivations column to the daily entry grid for Detailed-formula shops
--
-- The split-hour work is three commits on top of that on `main`:
--   210bf70  Add split-hour entry to the daily log table (Table View)
--   e1cfc23  Polish split-hour UI: no-wrap time cells, group outline, custom tooltip
--   4cd1fc9  Split-hour group outline: dashed sky-blue instead of solid orange
--
-- To roll the CODE back after it's been pushed (do this before touching the
-- database — see below):
--   git revert --no-commit 4cd1fc9 e1cfc23 210bf70
--   git commit
--   git push origin main
-- (revert, not reset --hard, since main is shared/already pushed by then)
--
-- ── Database rollback ────────────────────────────────────────────────────
-- Only run this against the database AFTER the reverted code above is live
-- — the reverted code doesn't know about split_index and expects the old
-- 3-column constraint back.
--
-- IMPORTANT: if anyone actually used the split-hour feature (any row has
-- split_index > 0), the old 1-row-per-hour constraint CANNOT be restored
-- without first deciding what happens to that data — restoring it while
-- two rows still share an hour will fail outright. The check below stops
-- and tells you if that's the case rather than silently deleting anything.
-- If it does stop you, decide (with Michael) whether to:
--   (a) delete the split rows outright (data for that hour reverts to
--       whatever's in split_index=0 only — the OTHER employee's entered
--       numbers for that hour are lost), or
--   (b) merge each hour's split rows into its split_index=0 row by hand
--       first (e.g. keep the LATEST cumulative totals from the last split,
--       re-save it as split_index=0, matching what shopTotals() already
--       treats as the hour's real total today).
-- Once you've resolved that (or confirmed there's nothing to resolve), the
-- rest of this script is safe to run.

do $$
begin
  if exists (select 1 from daily_logs where split_index > 0) then
    raise exception 'daily_logs has % row(s) with split_index > 0 — resolve them first (see comments above) before rolling back the schema.',
      (select count(*) from daily_logs where split_index > 0);
  end if;
end;
$$;

-- Restore the original one-row-per-hour constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'daily_logs'::regclass
      and contype = 'u'
      and conname = 'daily_logs_location_id_log_date_time_slot_key'
  ) then
    alter table daily_logs
      add constraint daily_logs_location_id_log_date_time_slot_key
      unique (location_id, log_date, time_slot);
  end if;
end;
$$;

-- Drop the split-hour constraint now that the old one is back.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'daily_logs'::regclass
      and contype = 'u'
      and conname = 'daily_logs_location_id_log_date_time_slot_split_index_key'
  ) then
    alter table daily_logs
      drop constraint daily_logs_location_id_log_date_time_slot_split_index_key;
  end if;
end;
$$;

-- Optional — the split_index column itself is harmless to leave in place
-- (every remaining row is split_index=0, and the reverted code never reads
-- it), so dropping it isn't required to fully undo the feature. Uncomment
-- if you'd rather have the schema match pre-migration10 exactly:
-- alter table daily_logs drop column if exists split_index;
