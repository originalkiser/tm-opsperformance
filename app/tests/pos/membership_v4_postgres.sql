-- Run in an isolated database with roster fixtures and the baseline POS,
-- reconciliation and V4 migrations already loaded.
do $$
declare
 loc uuid := '00000000-0104-0000-0000-000000000001';
 other_loc uuid := '00000000-0104-0000-0000-000000000002';
 reviewer uuid := '00000000-0104-0000-0000-000000000003';
 manager uuid := '00000000-0104-0000-0000-000000000004';
 employee uuid := '00000000-0104-0000-0000-000000000005';
 row jsonb := '{"site":"1529","date":"2026-11-04","ticket":"A104","product":"Best Wash Unlimited","tier":"best","activity":"new","greeter":"  Casey  ","cashier":"Other","identifier":null,"legalName":null,"commission":null}';
 p jsonb;
 result jsonb;
begin
 insert into public.locations(id,site_code,exclude_from_reporting) values(loc,'1529-Largo',false),(other_loc,'1532-Jackson',false);
 insert into public.user_profiles(id,role,is_active,location_id) values(reviewer,'admin',true,null),(manager,'store',true,loc);
 insert into public.employees(id,location_id,name,is_active) values(employee,loc,'Fixture Employee',true);
 insert into reconciliation_private.reviewers(user_id) values(reviewer);
 perform set_config('request.jwt.claim.sub',manager::text,true);
 begin
  perform public.pos_membership_import('status','{}');
  raise exception 'Store import was allowed.';
 exception when insufficient_privilege then null;
 end;
 perform public.pos_membership_aliases(loc,'add',jsonb_build_object('kind','username','identifier','CASEY','employee',employee,
   'starts','2026-11-01','reason','Fixture identity'));
 begin
  perform public.pos_membership_report(array[other_loc],'2026-11-04','2026-11-04');
  raise exception 'Other-site report was accessible.';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 p := jsonb_build_object('system','Micrologic','sha',repeat('a',64),'start','2026-11-01','end','2026-11-07',
   'events',jsonb_build_array(row||'{"expectedRevision":0}'),'snapshots','[]'::jsonb);
 result := public.pos_membership_import('commit',p);
 if result#>>'{rows,0,attribution}' is distinct from 'matched' then raise exception 'Expected verified username mapping: %',result; end if;
 if (public.pos_membership_import('commit',p)->>'repeat') is distinct from 'true' then raise exception 'Repeat was not idempotent.'; end if;
 p := p||jsonb_build_object('sha',repeat('b',64),'events',jsonb_build_array(row||'{"expectedRevision":1}'));
 result := public.pos_membership_import('commit',p);
 if result#>>'{rows,0,action}' is distinct from 'duplicate' then raise exception 'Overlapping event was duplicated: %',result; end if;
 update public.employees set location_id=other_loc,name='Transferred Fixture',is_active=false where id=employee;
 result := public.pos_membership_report(array[loc],'2026-11-04','2026-11-04');
 if result#>>'{people,0,name}' is distinct from 'Fixture Employee' or result#>>'{people,0,credited}' is distinct from '1'
   then raise exception 'Historical attribution changed after a transfer: %',result; end if;
 if has_schema_privilege('authenticated','membership_private','USAGE') or
  has_function_privilege('anon','public.pos_membership_import(text,jsonb)','EXECUTE') then
  raise exception 'Unexpected private-schema or anonymous access.';
 end if;
end;
$$;
select 'PASS: reviewer and location scopes, duplicate identity and historical employee transfer' as result;
