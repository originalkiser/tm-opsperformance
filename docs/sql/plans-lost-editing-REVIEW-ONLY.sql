-- REVIEW ONLY: apply only after approval, before frontend release.
-- Replaces only the guard body; owner, ACL, RLS, audit and stored data are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.daily_logs in access exclusive mode;
create or replace function public.guard_daily_plans_lost() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare r public.daily_logs; active_loss integer; lock_key text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- Lock both scopes in deterministic order for permitted legacy record moves.
  for lock_key in select distinct v from (values
    (r.location_id::text || ':' || r.log_date::text),
    (case when tg_op='UPDATE' then old.location_id::text || ':' || old.log_date::text
      else r.location_id::text || ':' || r.log_date::text end)) scopes(v) order by v loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key,0));
  end loop;
  if tg_op = 'UPDATE' and (old.location_id, old.log_date, old.time_slot, old.split_index)
      is distinct from (new.location_id, new.log_date, new.time_slot, new.split_index)
      and (old.plans_lost_today is not null or new.plans_lost_today is not null or exists (
        select 1 from public.daily_logs d where d.plans_lost_today is not null
          and ((d.location_id=old.location_id and d.log_date=old.log_date)
            or (d.location_id=new.location_id and d.log_date=new.log_date)))) then
    raise exception 'Calculated-day Daily Log identity cannot change';
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
  -- Explicit daily-loss entry adopts the daily calculation without rewriting
  -- any historical manual Net Members or the immutable legacy marker.
  if new.plans_lost_today is not null or active_loss is not null then
    if tg_op = 'INSERT' then
      if coalesce(new.net_members,0) <> 0 then
        raise exception 'Net Members are calculated daily; hourly manual values are not allowed';
      end if;
    elsif new.net_members is distinct from old.net_members then
      raise exception 'Historical manual Net Members must remain unchanged';
    end if;
  end if;
  return new;
end;
$$;
commit;
