-- DEV ONLY: authorized tm-ops-dev bmfvcnsuduttebxbjvwx.
-- Existing approved synthetic PR16 Auth profiles only; this is database-role
-- testing, NOT real Auth/HTTP. All test inserts/status/rename/review roll back.
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub',(select id::text from public.user_profiles where email='pr16-admin@example.test' and role='admin' and is_active),true);
set local role authenticated;
do $test$ declare a uuid; b uuid; first_id uuid; second_id uuid; snap jsonb; changed integer;
begin
 select location_id into a from public.user_profiles where email='pr16-gm@example.test';
 if a is null then raise exception 'Known synthetic location required'; end if;
 -- Existing creation payload and full returned row (including dev created_at).
 insert into public.employees(location_id,name,is_active) values(a,' PR39 Synthetic One ',true) returning id into first_id;
 if (select name from public.employees where id=first_id)<>'PR39 Synthetic One' then raise exception 'Trim failed'; end if;
 update public.employees set is_active=false where id=first_id;
 if (select is_active from public.employees where id=first_id) is distinct from false then raise exception 'Status failed'; end if;
 begin
  insert into public.employees(location_id,name,is_active) values(a,'pr39 SYNTHETIC one',true);
  raise exception 'Duplicate accepted';
 exception when unique_violation then null; end;
 update public.employees set name='PR39 Synthetic Renamed' where id=first_id;
 insert into public.employees(location_id,name,is_active) values(a,'PR39 Synthetic Two',true) returning id into second_id;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active)) into snap from public.employees where id in(first_id,second_id);
 select public.review_employee_duplicates(a,array[first_id,second_id],first_id,true,snap) into changed;
 if changed<>2 or (select count(*) from public.employees where id in(first_id,second_id))<>2
  or (select count(*) from public.employees where id in(first_id,second_id) and is_active)<>1 then raise exception 'Atomic review failed'; end if;
 begin delete from public.employees where id=first_id; raise exception 'Delete accepted'; exception when insufficient_privilege then null; end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.user_profiles where email='pr16-gm@example.test' and is_active),true);
set local role authenticated;
do $test$ declare a uuid; x uuid; denied boolean:=false;
begin
 select location_id into a from public.user_profiles where id=auth.uid();
 insert into public.employees(location_id,name,is_active) values(a,'PR39 Synthetic Store',true) returning id into x;
 update public.employees set is_active=false where id=x;
 if (select is_active from public.employees where id=x) is distinct from false then raise exception 'Store status failed'; end if;
 begin
  insert into public.employees(location_id,name,is_active) values(gen_random_uuid(),'PR39 Outside',true);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Cross-location write accepted'; end if;
 begin
  perform public.review_employee_duplicates(a,array[x,gen_random_uuid()],x,true,'[]'::jsonb);
  raise exception 'Store review accepted';
 exception when insufficient_privilege then null; end;
end $test$;
rollback;
