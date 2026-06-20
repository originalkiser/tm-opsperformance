-- Add market grouping to locations
alter table locations add column if not exists market text;
