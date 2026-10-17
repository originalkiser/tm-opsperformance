-- Development-only regression. Requires the corrected RPC inside a rollback-only harness.
-- Run only through verified supabase_tm_ops_dev; never against production.
-- Uses existing fictional PR16 fixtures. No Auth/profile/permission changes.
do $timezone_regression$
declare
 test_case record; normalization text; normalized text; rejected boolean;
 site_id uuid; store_id uuid; before_site jsonb; after_site jsonb;
 count_rows integer; cases jsonb := '{}'; month_start date; through_date date;
begin
 if current_user <> 'postgres' or not exists(
  select 1 from tm_ops_dev_setup.baseline where project_ref='bmfvcnsuduttebxbjvwx'
 ) then raise exception 'Verified development baseline/postgres required'; end if;
 select id,to_jsonb(l) into site_id,before_site from public.locations l
 where site_code='PR16-DEV-A' and name='Fictional PR16 A';
 select id into store_id from public.user_profiles
 where email='pr16-gm@example.test' and role='store' and is_active=true and deleted_at is null;
 if site_id is null or store_id is null then raise exception 'Verified fictional fixtures required'; end if;
 normalization:=substring(pg_get_functiondef('public.dashboard_mtd_performance(uuid[],date,date)'::regprocedure)
  from $regex$at time zone (.*)\)::date$regex$);
 if normalization is null then raise exception 'RPC normalization expression missing'; end if;
 through_date := (statement_timestamp() at time zone 'America/Chicago')::date-1;
 month_start := date_trunc('month',through_date)::date;
 begin
  -- Dev declares timezone NOT NULL; permit only this transactional NULL test.
  -- The forced subtransaction rollback restores the constraint and every fixture value.
  alter table public.locations alter column timezone drop not null;
  for test_case in select * from (values
   ('null',null::text,'America/Chicago'),
   ('empty','','America/Chicago'),
   ('spaces','   ','America/Chicago'),
   ('control_whitespace',E' \t\n\r\f\013 ','America/Chicago'),
   ('new_york','America/New_York','America/New_York'),
   ('los_angeles','America/Los_Angeles','America/Los_Angeles'),
   ('utc','UTC','UTC')
  ) c(label,input_timezone,expected_timezone) loop
   execute 'select '||normalization||' from (values ($1::text)) l(timezone)'
    into normalized using test_case.input_timezone;
   if normalized is distinct from test_case.expected_timezone then
    raise exception 'Timezone normalization failed: %',test_case.label; end if;
   update public.locations set timezone=test_case.input_timezone where id=site_id;
   perform set_config('request.jwt.claim.sub',store_id::text,true);
   perform set_config('request.jwt.claims',jsonb_build_object('sub',store_id,'role','authenticated')::text,true);
   set local role authenticated;
   select count(*) into count_rows from public.dashboard_mtd_performance(array[site_id],month_start,through_date);
   if count_rows<>1 then raise exception 'Timezone RPC positive control failed: %',test_case.label; end if;
   reset role;
   cases:=cases||jsonb_build_object(test_case.label,true);
  end loop;
  update public.locations set timezone='Invalid/PR18-Timezone' where id=site_id;
  set local role authenticated;
  rejected:=false;
  begin
   perform * from public.dashboard_mtd_performance(array[site_id],month_start,through_date);
  exception when invalid_parameter_value then rejected:=true;
  end;
  if not rejected then raise exception 'Invalid nonblank timezone was silently accepted'; end if;
  reset role;
  cases:=cases||jsonb_build_object('invalid_nonblank_rejected_22023',true);
  raise exception using errcode='P1821',message='TIMEZONE_FIXTURE_ROLLBACK';
 exception when sqlstate 'P1821' then
  if SQLERRM<>'TIMEZONE_FIXTURE_ROLLBACK' then raise; end if;
 end;
 select to_jsonb(l) into after_site from public.locations l where id=site_id;
 if before_site is distinct from after_site then raise exception 'Timezone fixture was not restored'; end if;
 perform set_config('tm_ops.timezone_cases',cases::text,true);
end $timezone_regression$;
