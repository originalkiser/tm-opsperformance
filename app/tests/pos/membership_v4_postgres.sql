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

do $$
declare
 loc uuid := '00000000-0104-0000-0000-000000000001';
 drb uuid := '00000000-0104-0000-0000-000000000006';
 reviewer uuid := '00000000-0104-0000-0000-000000000003';
 manager uuid := '00000000-0104-0000-0000-000000000004';
 employee uuid := '00000000-0104-0000-0000-000000000007';
 inactive uuid := '00000000-0104-0000-0000-000000000008';
 deleted uuid := '00000000-0104-0000-0000-000000000009';
 fixture jsonb; payload jsonb; row jsonb; bad jsonb; actor uuid; result jsonb; a_id bigint;
begin
 insert into public.locations(id,site_code,exclude_from_reporting) values(drb,'1508-Mesquite',false);
 insert into public.employees(id,location_id,name,is_active) values(employee,drb,'Verified Seller',true);
 insert into public.user_profiles(id,role,is_active,deleted_at,location_id)
 values(inactive,'admin',false,null,null),(deleted,'admin',true,now(),null);
 payload := jsonb_build_object('kind','adp','identifier','0123456789','employee',employee,
   'legalName','Legal Name','starts','2026-11-01','reason','Verified fixture');
 foreach actor in array array[inactive,deleted,manager] loop
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin
   perform public.pos_membership_aliases(drb,'add',payload);
   raise exception 'Disabled, deleted or other-site actor added an alias.';
  exception when insufficient_privilege then null;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 result:=public.pos_membership_aliases(drb,'add',payload);
 a_id:=(result->>'id')::bigint;
 begin
  perform public.pos_membership_aliases(drb,'add',payload||'{"identifier":"123456789","starts":"2026-11-07"}');
  raise exception 'Overlapping normalized identifier accepted.';
 exception when raise_exception then
  if sqlerrm<>'Alias overlaps an existing mapping for this location.' then raise; end if;
 end;
 update public.user_profiles set location_id=drb where id=manager;
 perform set_config('request.jwt.claim.sub',manager::text,true);
 if public.pos_membership_aliases(drb,'read','{}')<>'[]' then raise exception 'Store saw ADP alias.';end if;
 begin
  perform public.pos_membership_aliases(drb,'add',payload||'{"identifier":"0223456789"}');
  raise exception 'Assigned Store created an ADP alias.';
 exception when raise_exception then
  if sqlerrm<>'Invalid employee alias or location permissions.' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 row := '{"site":"1508","date":"2026-11-03","ticket":"1","product":"Unl. Best Sld","tier":"best","activity":"new","identifier":"0123456789","legalName":"LEGAL-NAME","commission":0,"eligible":false,"expectedRevision":0}';
 fixture:=jsonb_build_object('system','DRB','sha',repeat('d',64),'start','2026-11-01','end','2026-11-07',
   'externallyValidated',true,'events',jsonb_build_array(row),'snapshots','[]'::jsonb);
 foreach bad in array array[
  row||'{"activity":"regular"}',row||'{"identifier":"0123"}',row||'{"identifier":123456789}',
  row||'{"product":"Unrelated product","tier":null}',row||'{"tier":"basic"}',row||'{"commission":"100"}',
  row||'{"activity":"grace"}',row||'{"greeter":"Employee"}',row||'{"customerName":"Forbidden"}',
  row||'{"site":"1512"}',row||'{"date":"2026-11-08"}'
 ] loop
  begin
   perform public.pos_membership_import('preview',jsonb_set(fixture,'{events}',jsonb_build_array(bad)));
   raise exception 'Invalid source event escaped validation: %',bad;
  exception when raise_exception then
   if sqlerrm<>'Invalid sanitized membership event' then raise;end if;
  end;
 end loop;
 select jsonb_agg(row||jsonb_build_object('ticket',i::text,'identifier',case when i<=198 then '123456789' else '0123' end,
  'activity',case when i<=198 then 'new' else 'regular' end,'legalName',case when i=1 then 'LEGAL-NAME' when i<=198 then 'Different Person' end,
  'commission',case when i<=198 then 0 else 999 end,'eligible',i<>1)) into result from generate_series(1,339) i;
 perform public.pos_membership_import('commit',jsonb_set(fixture,'{events}',result));
 result:=public.pos_membership_report(array[drb],'2026-11-03','2026-11-03');
 if result#>>'{coverage,0,observed}' is distinct from '198' or result#>>'{people,0,credited}' is distinct from '1'
   or result#>>'{people,0,premium}' is distinct from '1' then raise exception 'DRB new, eligibility or P-Mix wrong: %',result;end if;
 -- Deliberately inject an impossible credited reactivation in the isolated DB.
 -- The report independently excludes it even if an attribution flag is wrong.
 update membership_private.revisions r set employee_id=employee,alias_id=a_id,employee_name='Verified Seller',attribution='matched'
  from membership_private.events e where e.id=r.event_id and e.location_id=drb and r.source->>'activity'='regular';
 result:=public.pos_membership_report(array[drb],'2026-11-03','2026-11-03');
 if result#>>'{coverage,0,observed}' is distinct from '198' or result#>>'{people,0,credited}' is distinct from '1'
 then raise exception 'Report trusted an invalid saved DRB attribution.';end if;

 row := '{"site":"1529","date":"2026-11-04","ticket":"Z1","product":"Best Wash Unlimited","tier":"best","activity":"new","greeter":"Casey","cashier":"Casey","eligible":true,"expectedRevision":0}';
 fixture:=jsonb_build_object('system','Micrologic','sha',repeat('e',64),'start','2026-11-01','end','2026-11-07','snapshots','[]'::jsonb);
 result:=public.pos_membership_import('commit',fixture||jsonb_build_object('events',jsonb_build_array(
  row||'{"ticket":"Z1","product":"Employee Best UWC"}',
  row||'{"ticket":"Z2","greeter":" Kiosk3 "}', row||'{"ticket":"Z3","greeter":""}',
  row||'{"ticket":"Z4","greeter":"Unknown"}', row||'{"ticket":"Z5","activity":"regular"}',
  row||'{"ticket":"Z6","activity":"grace"}')));
 if (select array_agg(x->>'attribution') from jsonb_array_elements(result->'rows') x)
   is distinct from array['employee-plan','kiosk','blank','unmatched','no-credit','no-credit']
   then raise exception 'Micrologic exclusions failed: %',result;end if;
 select alias_id,employee_id into a_id,employee from membership_private.revisions r
 join membership_private.events e on e.id=r.event_id where e.location_id=loc and e.ticket='A104';
 update membership_private.revisions r set employee_id=employee,alias_id=a_id,employee_name='Fixture Employee',attribution='matched'
 from membership_private.events e where e.id=r.event_id and e.location_id=loc and e.ticket like 'Z%';
 result:=public.pos_membership_report(array[loc],'2026-11-04','2026-11-04');
 if result#>>'{people,0,credited}' is distinct from '1'
  or result#>>'{coverage,0,observed}' is distinct from '5' then raise exception 'Report counted ineligible Micrologic rows: %',result;end if;

end;
$$;
select 'PASS: DRB 198 new of 339, independent credit eligibility, sanitized payloads and active alias permissions' as result;
