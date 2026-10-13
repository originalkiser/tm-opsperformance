-- Historical Cash on Hand: append verified versions; never rewrite saved cash.
begin;
alter table public.cash_on_hand_versions
  add column if not exists correction_confirmed boolean not null default false,
  add column if not exists correction_review_token text,
  add column if not exists correction_review jsonb;

create or replace function public.preview_cash_on_hand_change(loc_id uuid, business_date date)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare active public.cash_on_hand_versions; next_date date; versions jsonb; saved jsonb; site_today date;
begin
  if not exists(select 1 from public.user_profiles where id=auth.uid() and role='admin') then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if business_date is null then raise exception 'Effective business date required'; end if;
  select (clock_timestamp() at time zone coalesce(timezone,'America/Chicago'))::date into site_today from public.locations where id=loc_id;
  if site_today is null then raise exception 'Location required'; end if;
  select * into active from public.cash_on_hand_versions where location_id=loc_id and effective_date<=business_date order by effective_date desc,id desc limit 1;
  select min(effective_date) into next_date from public.cash_on_hand_versions where location_id=loc_id and effective_date>business_date;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',effective_date,'cents',amount_cents) order by effective_date,id),'[]') into versions from public.cash_on_hand_versions where location_id=loc_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'business_date',entry_date-1,'snapshot',cash_on_hand_version_id,'cents',cash_on_hand_cents,'updated',updated_at) order by id),'[]') into saved
    from public.budget_daily_entries where location_id=loc_id and cash_first_submitted_at is not null
      and entry_date-1>=business_date and (next_date is null or entry_date-1<next_date);
  return jsonb_build_object('token',md5(jsonb_build_array(loc_id,business_date,versions,saved)::text),
    'active_id',active.id,'active_cents',active.amount_cents,'next_date',next_date,
    'saved_count',jsonb_array_length(saved),'saved_business_dates',(select coalesce(jsonb_agg(distinct value->>'business_date'),'[]') from jsonb_array_elements(saved)),
    'requires_correction',(jsonb_array_length(versions)>0 and (business_date<site_today or active.id is not null or next_date is not null)) or jsonb_array_length(saved)>0);
end $$;
revoke all on function public.preview_cash_on_hand_change(uuid,date) from public,anon;
grant execute on function public.preview_cash_on_hand_change(uuid,date) to authenticated;

create or replace function public.stamp_cash_on_hand() returns trigger language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare prior public.cash_on_hand_versions; review jsonb;
begin
  if not exists(select 1 from public.user_profiles where id=auth.uid() and role='admin') then raise exception 'Admin required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.location_id::text,0));
  review:=public.preview_cash_on_hand_change(new.location_id,new.effective_date);
  if (review->>'requires_correction')::boolean then
    if not new.correction_confirmed or new.correction_review_token is distinct from review->>'token' then
      raise exception 'Review the overlap and explicitly confirm this correction. Settings or saved cash may have changed.' using errcode='23514';
    end if;
    if length(btrim(new.verification_note))<10 then raise exception 'Explain the verified historical correction (at least 10 characters)' using errcode='23514'; end if;
  end if;
  new.id:=pg_catalog.nextval('public.cash_on_hand_versions_id_seq'::regclass);
  -- Link to the version superseded for this business date, not a later setting.
  select * into prior from public.cash_on_hand_versions where location_id=new.location_id and effective_date<=new.effective_date order by effective_date desc,id desc limit 1;
  new.previous_version_id:=prior.id;
  new.correction_confirmed:=(review->>'requires_correction')::boolean;
  new.correction_review_token:=review->>'token'; new.correction_review:=review;
  new.created_by:=auth.uid(); new.created_at:=clock_timestamp(); return new;
end $$;
revoke all on function public.stamp_cash_on_hand() from public,anon,authenticated;
-- Existing audit_cash_on_hand trigger records the complete new version, including
-- its server-generated overlap review, confirmation, explanation and actor.
-- No existing RLS policy, permission helper or reconciliation trigger is changed.
commit;
