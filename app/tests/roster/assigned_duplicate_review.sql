-- Development-only isolated PostgreSQL probe.
-- Run only in tm-ops-dev (bmfvcnsuduttebxbjvwx). All test objects/data roll back.
begin;
set local statement_timeout='15s';
create schema store_review_test;
grant usage on schema store_review_test to authenticated;
create table store_review_test.user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz);
create table store_review_test.employees(id uuid primary key,location_id uuid,name text,is_active boolean);
create table store_review_test.daily_logs(id integer primary key,employee_name text,basic integer);
insert into store_review_test.user_profiles values
('a4200000-0000-4000-8000-000000000001','admin',null,true,null),
('a4200000-0000-4000-8000-000000000002','store','a4210000-0000-4000-8000-000000000001',true,null),
('a4200000-0000-4000-8000-000000000003','store','a4210000-0000-4000-8000-000000000002',true,null),
('a4200000-0000-4000-8000-000000000004','store','a4210000-0000-4000-8000-000000000001',false,null);
insert into store_review_test.employees values
('a4220000-0000-4000-8000-000000000001','a4210000-0000-4000-8000-000000000001','Duplicate',true),
('a4220000-0000-4000-8000-000000000002','a4210000-0000-4000-8000-000000000001','Duplicate',true),
('a4220000-0000-4000-8000-000000000003','a4210000-0000-4000-8000-000000000002','Other',true);
insert into store_review_test.daily_logs values(1,'Original Duplicate',7);
create function store_review_test.can_maintain_employee_roster(loc_id uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from store_review_test.user_profiles p where p.id=auth.uid() and p.is_active is true and p.deleted_at is null and (p.role='admin' or (p.role='store' and p.location_id=loc_id)));$$;
create function store_review_test.get_user_role() returns text language sql stable security definer set search_path='' as $$select role from store_review_test.user_profiles where id=auth.uid();$$;
alter table store_review_test.employees enable row level security;
alter table store_review_test.user_profiles enable row level security;
create policy profiles_read on store_review_test.user_profiles for select to authenticated using(id=auth.uid() or store_review_test.get_user_role()='admin');
create policy roster_read on store_review_test.employees for select to authenticated using(true);
create policy roster_update on store_review_test.employees for update to authenticated using(store_review_test.can_maintain_employee_roster(location_id)) with check(store_review_test.can_maintain_employee_roster(location_id));
grant select on store_review_test.employees,store_review_test.user_profiles to authenticated;
grant update(is_active) on store_review_test.employees to authenticated;
create or replace function store_review_test.review_employee_duplicates(loc_id uuid,selected_ids uuid[],primary_id uuid,confirmed boolean,reviewed_rows jsonb)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare expected integer; changed integer;
begin
  if confirmed is distinct from true or not store_review_test.can_maintain_employee_roster(loc_id) then
    raise exception 'Assigned roster access and explicit identity confirmation required' using errcode='42501';
  end if;
  expected := pg_catalog.cardinality(selected_ids);
  if expected is null or expected<2 or expected>100 or primary_id is null
      or not (primary_id=any(selected_ids))
      or (select count(distinct v) from pg_catalog.unnest(selected_ids) v)<>expected then
    raise exception 'Choose 2–100 distinct records and one retained record' using errcode='22023';
  end if;
  -- Lock in UUID order and require every selected row to still exist at this site.
  perform id from store_review_test.employees where location_id=loc_id and id=any(selected_ids) order by id for update;
  if (select count(*) from store_review_test.employees where location_id=loc_id and id=any(selected_ids))<>expected then
    raise exception 'Roster changed or selection spans locations; reload' using errcode='22023';
  end if;
  if reviewed_rows is null or pg_catalog.jsonb_typeof(reviewed_rows)<>'array' then
    raise exception 'Reviewed roster snapshot required' using errcode='22023';
  end if;
  if (select count(distinct r.id) from pg_catalog.jsonb_to_recordset(reviewed_rows) as r(id uuid,name text,is_active boolean))<>expected
     or (select count(*) from pg_catalog.jsonb_to_recordset(reviewed_rows) as r(id uuid,name text,is_active boolean)
       join store_review_test.employees e on e.id=r.id and e.location_id=loc_id
       where e.id=any(selected_ids) and e.name is not distinct from r.name and e.is_active is not distinct from r.is_active)<>expected then
    raise exception 'Selected employees changed since review; reload and confirm again' using errcode='PT409';
  end if;
  update store_review_test.employees set is_active=(id=primary_id) where location_id=loc_id and id=any(selected_ids);
  get diagnostics changed=row_count;
  if changed<>expected then raise exception 'Roster update incomplete' using errcode='PT409'; end if;
  return changed;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','a4200000-0000-4000-8000-000000000002',true);
do $$
declare a uuid:='a4210000-0000-4000-8000-000000000001';b uuid:='a4210000-0000-4000-8000-000000000002';ids uuid[]:=array['a4220000-0000-4000-8000-000000000001','a4220000-0000-4000-8000-000000000002']::uuid[];snap jsonb;actual integer;
begin
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active)) into snap from store_review_test.employees where id=any(ids);
 begin perform store_review_test.review_employee_duplicates(b,ids,ids[1],true,snap);raise exception 'Cross-location review allowed';exception when insufficient_privilege then null;end;
 begin perform store_review_test.review_employee_duplicates(a,ids,ids[1],false,snap);raise exception 'Unconfirmed review allowed';exception when insufficient_privilege then null;end;
 begin perform store_review_test.review_employee_duplicates(a,ids,ids[1],true,replace(snap::text,'Duplicate','Changed')::jsonb);raise exception 'Stale review allowed';exception when sqlstate 'PT409' then null;end;
 begin perform store_review_test.review_employee_duplicates(a,array[ids[1],'a4220000-0000-4000-8000-000000000003']::uuid[],ids[1],true,snap);raise exception 'Mixed-location records allowed';exception when invalid_parameter_value then null;end;
 actual:=store_review_test.review_employee_duplicates(a,ids,ids[1],true,snap);
 if actual<>2 or (select count(*) from store_review_test.employees where location_id=a and is_active)<>1 then raise exception 'Own roster review failed';end if;
 perform set_config('request.jwt.claim.sub','a4200000-0000-4000-8000-000000000004',true);
 begin perform store_review_test.review_employee_duplicates(a,ids,ids[1],true,snap);raise exception 'Inactive user allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','a4200000-0000-4000-8000-000000000001',true);
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active)) into snap from store_review_test.employees where id=any(ids);
 actual:=store_review_test.review_employee_duplicates(a,ids,ids[2],true,snap);
 if actual<>2 then raise exception 'Admin review regressed';end if;
 if (select count(*) from store_review_test.employees)<>3 or exists(select 1 from store_review_test.employees where location_id=a and name<>'Duplicate') then raise exception 'Employee identity changed';end if;
end $$;
reset role;
do $$ begin if not exists(select 1 from store_review_test.daily_logs where id=1 and employee_name='Original Duplicate' and basic=7) then raise exception 'History changed';end if;end $$;
select 'PASS: assigned Store and Admin review; cross-location, mixed-location, stale, unconfirmed and inactive denied; identities/history preserved' as result;
rollback;
