-- migration12.sql
-- Add daily revenue fields for Budget Tracking.
-- Existing data is preserved.

ALTER TABLE public.budget_daily_entries
ADD COLUMN IF NOT EXISTS yesterday_total_revenue numeric(12,2);

ALTER TABLE public.budget_daily_entries
ADD COLUMN IF NOT EXISTS yesterday_cc_revenue numeric(12,2);

ALTER TABLE public.budget_daily_entries
ADD COLUMN IF NOT EXISTS yesterday_house_revenue numeric(12,2);
