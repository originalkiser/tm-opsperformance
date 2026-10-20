-- Pre-release inverse only. Never discard saved loss data (including zero).
-- Stop/revert the new frontend before using. No CASCADE; unexpected dependencies fail closed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.daily_logs in access exclusive mode;
do $rollback_guard$
begin
  if current_user <> 'postgres' then raise exception 'postgres installer required'; end if;
  if exists(select 1 from public.daily_logs where plans_lost_today is not null) then
    raise exception 'ROLLBACK BLOCKED: saved Plans Lost values exist; retain schema and use an approved data-preserving recovery plan';
  end if;
end;
$rollback_guard$;
drop trigger guard_daily_plans_lost on public.daily_logs;
drop function public.guard_daily_plans_lost();
alter table public.daily_logs drop constraint daily_logs_plans_lost_once;
alter table public.daily_logs drop column plans_lost_today;
alter table public.daily_logs drop column net_members_legacy;
commit;
