-- migration3.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Recalculates stored opportunities values to match updated formulas:
--   simple:   TW − MW
--   detailed: TW − MW + MS  (was incorrectly TW − MW − MS)

update daily_logs dl
set opportunities = greatest(0, dl.total_washes - dl.member_washes + dl.memberships_sold)
from locations l
where dl.location_id = l.id
  and l.opportunities_formula = 'detailed';

update daily_logs dl
set opportunities = greatest(0, dl.total_washes - dl.member_washes)
from locations l
where dl.location_id = l.id
  and l.opportunities_formula = 'simple';
