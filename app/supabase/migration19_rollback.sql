-- Non-destructive application rollback: retain all counts, snapshots, settings
-- and audit history. Revert the client commit only after separate approval.
-- Existing clients omit the new count field; unrelated budget saves preserve it.
-- Keep migration19's triggers/RLS so old clients cannot clear or spoof history.
-- No DROP TABLE/COLUMN or production record edits are needed for UI rollback.
-- If schema retirement becomes necessary, export and retain all cash history,
-- then prepare a separately reviewed forward migration. Never restore the
-- entire database merely to hide this feature.
select 'No destructive schema rollback required; preserve cash data and protections.' as rollback_plan;
