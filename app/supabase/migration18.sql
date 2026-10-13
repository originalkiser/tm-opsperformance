-- Ownership wash goals persist independently of daily posts. Existing comments remain intact.
begin;
alter table public.ownership_log_entries add column goal_action_today text;
create table public.ownership_wash_goals (
  location_id uuid primary key references public.locations(id),
  goal_1 text not null default '' check (length(goal_1) <= 2000),
  goal_2 text not null default '' check (length(goal_2) <= 2000),
  goal_3 text not null default '' check (length(goal_3) <= 2000),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id)
);
alter table public.ownership_wash_goals enable row level security;
revoke all on public.ownership_wash_goals from anon, authenticated;
grant select, insert, update on public.ownership_wash_goals to authenticated;
-- Match existing Ownership Log site access; no existing policies changed.
create policy wash_goals_read on public.ownership_wash_goals for select to authenticated
  using (public.user_can_edit_location(location_id));
create policy wash_goals_insert on public.ownership_wash_goals for insert to authenticated
  with check (public.user_can_edit_location(location_id));
create policy wash_goals_update on public.ownership_wash_goals for update to authenticated
  using (public.user_can_edit_location(location_id)) with check (public.user_can_edit_location(location_id));
create function public.stamp_ownership_wash_goals() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Signed-in user required' using errcode='42501'; end if;
  if tg_op='UPDATE' and new.location_id is distinct from old.location_id then raise exception 'Goal location cannot change'; end if;
  new.updated_at := clock_timestamp(); new.updated_by := auth.uid(); return new;
end;
$$;
revoke all on function public.stamp_ownership_wash_goals() from public, anon, authenticated;
create trigger stamp_ownership_wash_goals before insert or update on public.ownership_wash_goals
  for each row execute function public.stamp_ownership_wash_goals();
commit;
