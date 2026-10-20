-- REVIEW ONLY — not installed. Install and verify in an isolated database before
-- approving production migration, then deploy the application. No backfill.
-- Additive Daily Log storage reuses all existing grants, RLS and audit triggers.
begin;
alter table public.daily_logs add column plans_lost_today integer;
-- Metadata-only default protects all existing manual records, including zero,
-- without an UPDATE/backfill that would alter audit history.
alter table public.daily_logs add column net_members_legacy boolean not null default true;
alter table public.daily_logs alter column net_members_legacy set default false;
alter table public.daily_logs add constraint daily_logs_plans_lost_once check (
  plans_lost_today is null or
  (plans_lost_today >= 0 and time_slot = time '08:00:00' and split_index = 0)
);
comment on column public.daily_logs.plans_lost_today is
  'Daily losses once per location/date on 08:00 split 0. NULL means unknown/legacy; 0 is explicit zero. Never sum cumulative sales.';

-- Serialize changes within each location/day, including old-client writes.
-- Invoker security: no grants, policies or role helpers changed.
create function public.guard_daily_plans_lost() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare r public.daily_logs; active_loss integer;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.location_id::text || ':' || r.log_date::text, 0));
  if tg_op = 'UPDATE' and (old.location_id, old.log_date, old.time_slot, old.split_index)
      is distinct from (new.location_id, new.log_date, new.time_slot, new.split_index) then
    raise exception 'Daily Log identity cannot change; use the selected location/date';
  end if;
  if tg_op = 'DELETE' then
    if old.plans_lost_today is not null then
      raise exception 'Daily plans lost must be retained; set losses to zero instead';
    end if;
    return old;
  end if;
  select d.plans_lost_today into active_loss from public.daily_logs d
    where d.location_id = new.location_id and d.log_date = new.log_date
      and d.time_slot = time '08:00:00' and d.split_index = 0;
  if tg_op = 'UPDATE' and old.net_members_legacy is distinct from new.net_members_legacy then
    raise exception 'Legacy Net Members transition requires separate approval';
  end if;
  if tg_op = 'UPDATE' and old.plans_lost_today is not null and new.plans_lost_today is null then
    raise exception 'Daily plans lost cannot be cleared; enter zero for no losses';
  end if;
  if new.plans_lost_today is not null and exists (
    select 1 from public.daily_logs d where d.location_id = new.location_id
      and d.log_date = new.log_date and (d.net_members_legacy or d.net_members <> 0)
  ) then
    raise exception 'Historical manual Net Members require an approved transition plan';
  end if;
  if (new.plans_lost_today is not null or active_loss is not null) and new.net_members <> 0 then
    raise exception 'Net Members are calculated daily; hourly manual values are not allowed';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_daily_plans_lost() from public, anon, authenticated;
create trigger guard_daily_plans_lost before insert or update or delete on public.daily_logs
  for each row execute function public.guard_daily_plans_lost();
commit;
