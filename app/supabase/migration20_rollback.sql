-- Revert the UI release only, retaining immutable cash versions, snapshot data,
-- correction reviews and audit history. Do not delete backdated versions or
-- restore the database. Any rollback of historical setting behavior requires a
-- separately reviewed function migration; the old UI cannot request corrections.
select 'Preserve all cash history; revert UI only after approval.' as rollback_plan;
