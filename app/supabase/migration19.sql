-- Additive Daily Cash Reconciliation. Existing data/policies remain intact.
begin;
create table if not exists public.cash_on_hand_versions (
  id bigint generated always as identity primary key,
  location_id uuid not null references public.locations(id),
  effective_date date not null,
  amount_cents bigint not null check(amount_cents between 0 and 999999999999),
  verification_note text not null check(length(btrim(verification_note)) between 1 and 1000),
  previous_version_id bigint references public.cash_on_hand_versions(id),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id)
);
create index if not exists cash_on_hand_effective on public.cash_on_hand_versions(location_id,effective_date desc,id desc);
create table if not exists public.cash_reconciliation_audit (
  id bigint generated always as identity primary key,
  location_id uuid not null references public.locations(id),
  business_date date not null,
  event_type text not null,
  old_value jsonb,
  new_value jsonb not null,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid not null references auth.users(id)
);
create index if not exists cash_reconciliation_audit_scope on public.cash_reconciliation_audit(location_id,business_date,id);
alter table public.cash_on_hand_versions enable row level security;
alter table public.cash_reconciliation_audit enable row level security;
revoke all on public.cash_on_hand_versions,public.cash_reconciliation_audit from anon,authenticated;
revoke all on sequence public.cash_on_hand_versions_id_seq,public.cash_reconciliation_audit_id_seq from anon,authenticated;
grant select,insert on public.cash_on_hand_versions to authenticated;
grant usage on sequence public.cash_on_hand_versions_id_seq to authenticated;
grant select on public.cash_reconciliation_audit to authenticated;
drop policy if exists cash_setting_read on public.cash_on_hand_versions;
create policy cash_setting_read on public.cash_on_hand_versions for select to authenticated using(public.user_can_edit_location(location_id));
drop policy if exists cash_setting_admin_insert on public.cash_on_hand_versions;
create policy cash_setting_admin_insert on public.cash_on_hand_versions for insert to authenticated with check(exists(select 1 from public.user_profiles where id=auth.uid() and role='admin'));
drop policy if exists cash_audit_read on public.cash_reconciliation_audit;
create policy cash_audit_read on public.cash_reconciliation_audit for select to authenticated using(public.user_can_edit_location(location_id));

alter table public.budget_daily_entries
  add column if not exists yesterday_cash_counted numeric check(yesterday_cash_counted >= 0 and yesterday_cash_counted <= 9999999999.99 and scale(yesterday_cash_counted)<=2),
  add column if not exists cash_original_count numeric,
  add column if not exists cash_first_submitted_at timestamptz,
  add column if not exists cash_first_submitted_by uuid references auth.users(id),
  add column if not exists cash_edited_after_submission boolean not null default false,
  add column if not exists cash_on_hand_version_id bigint references public.cash_on_hand_versions(id),
  add column if not exists cash_on_hand_cents bigint,
  add column if not exists cash_revenue_cents bigint,
  add column if not exists cash_expected_cents bigint,
  add column if not exists cash_deposit_cents bigint,
  add column if not exists cash_variance_cents bigint;

-- These two functions run as the caller, not the owner. Existing RLS calls
-- user_can_edit_location(), whose production body uses unqualified public tables.
-- Keep pg_catalog first and pg_temp last so that helper resolves correctly.
-- The audit SECURITY DEFINER functions below retain their empty search_path.
create or replace function public.stamp_cash_on_hand() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare prior public.cash_on_hand_versions; site_today date;
begin
  if not exists(select 1 from public.user_profiles where id=auth.uid() and role='admin') then raise exception 'Admin required' using errcode='42501'; end if;
  -- Serialize versions so simultaneous Admin changes have a definite predecessor.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.location_id::text,0));
  -- Identity defaults are allocated before BEFORE triggers. Allocate the final
  -- version ID under the lock so same-date ordering follows the saved changes.
  new.id:=pg_catalog.nextval('public.cash_on_hand_versions_id_seq'::regclass);
  select * into prior from public.cash_on_hand_versions where location_id=new.location_id order by effective_date desc,id desc limit 1;
  select (clock_timestamp() at time zone coalesce(timezone,'America/Chicago'))::date into site_today from public.locations where id=new.location_id;
  if prior.id is not null and (new.effective_date<site_today or new.effective_date<prior.effective_date) then raise exception 'Changes must apply to future business dates, after the latest setting' using errcode='23514'; end if;
  new.previous_version_id:=prior.id; new.created_by:=auth.uid(); new.created_at:=clock_timestamp(); return new;
end $$;
drop trigger if exists stamp_cash_on_hand on public.cash_on_hand_versions;
create trigger stamp_cash_on_hand before insert on public.cash_on_hand_versions for each row execute function public.stamp_cash_on_hand();

create or replace function public.audit_cash_on_hand() returns trigger language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
  select to_jsonb(v) into prior from public.cash_on_hand_versions v where id=new.previous_version_id;
  insert into public.cash_reconciliation_audit(location_id,business_date,event_type,old_value,new_value,changed_by)
    values(new.location_id,new.effective_date,'cash_on_hand_change',prior,to_jsonb(new),auth.uid()); return new;
end $$;
drop trigger if exists audit_cash_on_hand on public.cash_on_hand_versions;
create trigger audit_cash_on_hand after insert on public.cash_on_hand_versions for each row execute function public.audit_cash_on_hand();

create or replace function public.reconcile_daily_cash() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare version public.cash_on_hand_versions; recalc boolean; submitted jsonb;
begin
  if auth.uid() is null then
    if new.yesterday_cash_counted is not null then raise exception 'Signed-in user required' using errcode='42501'; end if;
    return new;
  end if;
  if (tg_op='INSERT' and new.yesterday_cash_counted is not null) or (tg_op='UPDATE' and new.yesterday_cash_counted is distinct from old.yesterday_cash_counted) then
    if not public.user_can_edit_location(new.location_id) then raise exception 'Location not authorized' using errcode='42501'; end if;
  end if;
  if tg_op='UPDATE' and (old.cash_first_submitted_at is not null or new.yesterday_cash_counted is not null)
    and (new.location_id is distinct from old.location_id or new.entry_date is distinct from old.entry_date) then raise exception 'Cash entry identity cannot change'; end if;
  if tg_op='INSERT' then
    new.cash_original_count:=new.yesterday_cash_counted; new.cash_first_submitted_at:=null; new.cash_first_submitted_by:=null;
    new.cash_edited_after_submission:=false; new.cash_on_hand_version_id:=null; new.cash_on_hand_cents:=null;
    new.cash_revenue_cents:=null; new.cash_expected_cents:=null; new.cash_deposit_cents:=null; new.cash_variance_cents:=null;
    -- Deleting/recreating a daily row cannot erase its first cash submission.
    select new_value into submitted from public.cash_reconciliation_audit
      where location_id=new.location_id and business_date=new.entry_date-1 and event_type='cash_count_submission' order by id limit 1;
    if submitted is not null then
      new.cash_original_count:=(submitted->>'cash_original_count')::numeric;
      new.cash_first_submitted_at:=(submitted->>'cash_first_submitted_at')::timestamptz;
      new.cash_first_submitted_by:=(submitted->>'cash_first_submitted_by')::uuid;
      new.cash_on_hand_version_id:=(submitted->>'cash_on_hand_version_id')::bigint;
      new.cash_on_hand_cents:=(submitted->>'cash_on_hand_cents')::bigint;
      new.cash_edited_after_submission:=true;
    end if;
    recalc:=true;
  else
    new.cash_original_count:=old.cash_original_count; new.cash_first_submitted_at:=old.cash_first_submitted_at; new.cash_first_submitted_by:=old.cash_first_submitted_by;
    new.cash_edited_after_submission:=old.cash_edited_after_submission; new.cash_on_hand_version_id:=old.cash_on_hand_version_id; new.cash_on_hand_cents:=old.cash_on_hand_cents;
    new.cash_revenue_cents:=old.cash_revenue_cents; new.cash_expected_cents:=old.cash_expected_cents; new.cash_deposit_cents:=old.cash_deposit_cents; new.cash_variance_cents:=old.cash_variance_cents;
    recalc:=new.yesterday_cash_counted is distinct from old.yesterday_cash_counted or new.yesterday_total_revenue is distinct from old.yesterday_total_revenue or new.yesterday_cc_revenue is distinct from old.yesterday_cc_revenue or new.yesterday_house_revenue is distinct from old.yesterday_house_revenue;
    if old.cash_first_submitted_at is not null and new.yesterday_cash_counted is distinct from old.yesterday_cash_counted then new.cash_edited_after_submission:=true; end if;
  end if;
  if new.yesterday_cash_counted is not null and new.cash_first_submitted_at is null then
    new.cash_original_count:=new.yesterday_cash_counted; new.cash_first_submitted_at:=clock_timestamp(); new.cash_first_submitted_by:=auth.uid();
  end if;
  if new.cash_first_submitted_at is null then
    new.cash_on_hand_version_id:=null; new.cash_on_hand_cents:=null;
    new.cash_revenue_cents:=null; new.cash_expected_cents:=null; new.cash_deposit_cents:=null; new.cash_variance_cents:=null;
    return new;
  end if;
  if recalc then
    if new.cash_on_hand_version_id is null and submitted is null and (tg_op='INSERT' or old.cash_first_submitted_at is null) then
      select * into version from public.cash_on_hand_versions where location_id=new.location_id and effective_date <= new.entry_date-1 order by effective_date desc,id desc limit 1;
      new.cash_on_hand_version_id:=version.id; new.cash_on_hand_cents:=version.amount_cents;
    end if;
    new.cash_revenue_cents:=null;
    if new.yesterday_total_revenue is not null and new.yesterday_cc_revenue is not null and new.yesterday_house_revenue is not null
      and new.yesterday_total_revenue>=0 and new.yesterday_cc_revenue>=0 and new.yesterday_house_revenue>=0
      and new.yesterday_total_revenue-new.yesterday_cc_revenue-new.yesterday_house_revenue>=0 then
      new.cash_revenue_cents:=((new.yesterday_total_revenue-new.yesterday_cc_revenue-new.yesterday_house_revenue)*100)::bigint;
    end if;
    new.cash_expected_cents:=new.cash_on_hand_cents+new.cash_revenue_cents;
    new.cash_deposit_cents:=(new.yesterday_cash_counted*100)::bigint-new.cash_on_hand_cents;
    new.cash_variance_cents:=new.cash_deposit_cents-new.cash_revenue_cents;
    if tg_op='UPDATE' and old.cash_first_submitted_at is not null
      and (new.cash_revenue_cents is distinct from old.cash_revenue_cents or new.cash_on_hand_version_id is distinct from old.cash_on_hand_version_id) then
      new.cash_edited_after_submission:=true;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists reconcile_daily_cash on public.budget_daily_entries;
create trigger reconcile_daily_cash before insert or update on public.budget_daily_entries for each row execute function public.reconcile_daily_cash();

create or replace function public.audit_daily_cash() returns trigger language plpgsql security definer set search_path='' as $$
declare prior jsonb; event text;
begin
  if tg_op='DELETE' then
    if old.cash_first_submitted_at is not null then
      insert into public.cash_reconciliation_audit(location_id,business_date,event_type,old_value,new_value,changed_by)
        values(old.location_id,old.entry_date-1,'cash_count_deleted',to_jsonb(old),jsonb_build_object('deleted',true),auth.uid());
    end if;
    return old;
  end if;
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  if tg_op='INSERT' and new.cash_edited_after_submission then
    event:='cash_count_recreated';
    select old_value into prior from public.cash_reconciliation_audit
      where location_id=new.location_id and business_date=new.entry_date-1 and event_type='cash_count_deleted' order by id desc limit 1;
  elsif new.cash_first_submitted_at is not null and (tg_op='INSERT' or old.cash_first_submitted_at is null) then event:='cash_count_submission';
  elsif tg_op='UPDATE' and new.cash_first_submitted_at is not null and new.yesterday_cash_counted is distinct from old.yesterday_cash_counted then event:='cash_count_correction';
  elsif tg_op='UPDATE' and new.cash_first_submitted_at is not null and (new.cash_revenue_cents is distinct from old.cash_revenue_cents or new.cash_on_hand_version_id is distinct from old.cash_on_hand_version_id) then event:='cash_revenue_correction';
  else return new; end if;
  insert into public.cash_reconciliation_audit(location_id,business_date,event_type,old_value,new_value,changed_by)
    values(new.location_id,new.entry_date-1,event,prior,to_jsonb(new),auth.uid()); return new;
end $$;
drop trigger if exists audit_daily_cash on public.budget_daily_entries;
create trigger audit_daily_cash after insert or update or delete on public.budget_daily_entries for each row execute function public.audit_daily_cash();
revoke all on function public.stamp_cash_on_hand(),public.audit_cash_on_hand(),public.reconcile_daily_cash(),public.audit_daily_cash() from public,anon,authenticated;
commit;
