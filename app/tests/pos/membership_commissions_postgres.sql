-- Isolated fixture only. Run after the V4, V4.1 and commission migrations.
do $test$
declare
 admin_id uuid := gen_random_uuid(); employee uuid := gen_random_uuid(); loc uuid := gen_random_uuid(); drb uuid := gen_random_uuid();
 report jsonb; reviewed jsonb; sales jsonb; event jsonb;
begin
 insert into auth.users(id) values(admin_id);
 insert into public.locations(id,site_code,exclude_from_reporting) values(loc,'1512',false),(drb,'1508',false);
 insert into public.user_profiles(id,role,is_active) values(admin_id,'admin',true);
 insert into reconciliation_private.reviewers(user_id) values(admin_id);
 insert into public.employees(id,location_id,name,is_active) values(employee,loc,'Fixture Kelly',true);
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.pos_membership_aliases(loc,'add',jsonb_build_object('employee',employee,'kind','username',
  'identifier','fixturekelly','starts','2026-11-09','ends','2026-11-23','reason','fixture legacy alias'));
 perform public.pos_membership_aliases(loc,'add',jsonb_build_object('employee',employee,'kind','username',
  'identifier','fixturekelly','starts','2026-11-24','reason','fixture continuation'));
 report:=jsonb_build_object('site','1512','start','2026-11-09','end','2026-11-26','sha',repeat('a',64),'activeOnly',true,
 'details','[{"username":"fixturekelly","product":"Best Wash Unlimited Sign Up -PROMO","quantity":54},
 {"username":"fixturekelly","product":"Basic Wash Unlimited Sign Up","quantity":6},
 {"username":"fixturekelly","product":"","quantity":1},
 {"username":"fixturekelly","product":"Employee Best UWC","quantity":2},
 {"username":"kiosk2","product":"Best Wash Unlimited Sign Up","quantity":3}]'::jsonb);
 reviewed:=public.pos_membership_commissions('preview',report||'{"start":"2026-11-01"}');
 if reviewed#>>'{users,0,credited}'<>'0' then raise exception 'Alias dates were backdated';end if;
 reviewed:=public.pos_membership_commissions('preview',report);
 if reviewed#>>'{users,0,credited}'<>'60' or reviewed#>>'{users,0,unknown_product}'<>'1'
   or reviewed#>>'{users,0,excluded}'<>'2' or reviewed#>>'{users,1,excluded}'<>'3'
 then raise exception 'Commission eligibility results differ';end if;
 event:='{"site":"1512","date":"2026-11-10","ticket":"ML123","product":"Basic Wash Unlimited Sign Up",
   "tier":"basic","activity":"new","greeter":"fixturekelly","expectedRevision":0}'::jsonb;
 perform public.pos_membership_import('commit',jsonb_build_object('system','Micrologic','sha',repeat('b',64),
   'start','2026-11-10','end','2026-11-10','events',jsonb_build_array(event),'snapshots','[]'::jsonb));
 perform public.pos_membership_commissions('commit',report);
 if public.pos_membership_commissions('commit',report)->>'repeat'<>'true'
 then raise exception 'Report retry was not idempotent';end if;
 begin
  perform public.pos_membership_commissions('commit',report||'{"start":"2026-11-10"}');
  raise exception 'Overlapping scope accepted';
 exception when raise_exception then
  if sqlerrm not like 'Commission scope overlaps%' then raise;end if;
 end;
 sales:=public.pos_membership_report(array[loc],'2026-11-09','2026-11-26');
 if sales#>>'{people,0,credited}'<>'60' or sales#>>'{people,0,premium}'<>'54'
   or sales#>>'{people,0,tiered}'<>'60' then raise exception 'Detail and aggregate overlap double counted';end if;
 sales:=public.pos_membership_report(array[loc],'2026-11-10','2026-11-10');
 if sales#>>'{people,0,credited}'<>'1' or sales#>>'{commissionScopes,0,included}'<>'false'
 then raise exception 'Partial scope fabricated daily commission sales';end if;
 reviewed:=public.pos_membership_commissions('commit',report||jsonb_build_object('start','2026-11-27','end','2026-11-27','sha',repeat('c',64)));
 if reviewed->>'repeat'<>'false' then raise exception 'Nonoverlapping daily scope failed';end if;
 sales:=public.pos_membership_report(array[loc],'2026-11-27','2026-11-27');
 if sales#>>'{coverage,0,imported}'<>'true' or sales#>>'{coverage,0,commission_daily_observed}'<>'66'
 then raise exception 'Daily aggregate coverage mismatch';end if;
 sales:=public.pos_membership_report(array[drb],'2026-11-09','2026-11-26');
 if sales->'commissionScopes'<>'[]'::jsonb or sales->'people'<>'[]'::jsonb
 then raise exception 'Micrologic data leaked into DRB reporting';end if;
 insert into public.user_profiles(id,role,is_active) values(gen_random_uuid(),'store',true);
 perform set_config('request.jwt.claim.sub',(select id::text from public.user_profiles where role='store' limit 1),true);
 begin
  perform public.pos_membership_commissions('preview',report);
  raise exception 'Unauthorized account previewed commissions';
 exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.pos_membership_commissions(text,jsonb)','EXECUTE') then raise exception 'Anonymous RPC grant';end if;
end $test$;
