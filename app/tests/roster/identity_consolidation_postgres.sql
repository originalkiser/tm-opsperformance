-- Disposable PostgreSQL fixture. Load the roster and historical mapping
-- migrations and the local schema from historical_mapping_postgres.sql first.
do $$
declare
 site uuid:='10000000-0000-0000-0000-000000000001';
 other uuid:='10000000-0000-0000-0000-000000000002';
 gm uuid:='20000000-0000-0000-0000-000000000002';
 outside_gm uuid:='20000000-0000-0000-0000-000000000003';
 inactive_gm uuid:='20000000-0000-0000-0000-000000000004';
 admin uuid:='20000000-0000-0000-0000-000000000001';
 retained uuid:='30000000-0000-0000-0000-000000000001';
 duplicate uuid:='30000000-0000-0000-0000-000000000003';
 inactive_duplicate uuid:='30000000-0000-0000-0000-000000000004';
 payload jsonb; result jsonb; audited jsonb; saved_logs jsonb; saved_roster jsonb; action_id uuid; denied_user uuid;
begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.employees values(duplicate,site,'Active duplicate',true),(inactive_duplicate,site,'Inactive duplicate',false);
 insert into public.daily_logs values
  ('40000000-0000-0000-0000-000000000003',site,'2026-01-03','Variant',inactive_duplicate,0);
 select jsonb_agg(to_jsonb(d) order by d.id) into saved_logs from public.daily_logs d;
 select jsonb_agg(to_jsonb(e) order by e.id) into saved_roster from public.employees e;
 payload:=jsonb_build_object('retained',retained,'confirmed',true,'reason','Identity confirmed in fixture',
  'aliases','[{"name":"Alias","appearances":2,"start":"2026-01-01","end":"2026-01-02"},{"name":"Variant","appearances":1,"start":"2026-01-03","end":"2026-01-03"}]'::jsonb,
  'roster',(select jsonb_agg(to_jsonb(e)-'location_id') from public.employees e where e.location_id=site));
 foreach denied_user in array array[outside_gm,inactive_gm] loop
  perform set_config('request.jwt.claim.sub',denied_user::text,true);
  begin
   perform public.employee_identity_consolidation(site,'apply',payload);
   raise exception 'An unauthorized actor consolidated another roster.';
  exception when insufficient_privilege then null;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',gm::text,true);
 begin
  perform public.employee_identity_consolidation(site,'apply',jsonb_set(payload,'{aliases,1,appearances}','2'));
  raise exception 'Stale history was accepted.';
 exception when sqlstate 'PT409' then null;
 end;
 if exists(select 1 from public.employee_name_mappings) then raise exception 'Stale action partially saved.';end if;
 result:=public.employee_identity_consolidation(site,'apply',payload);
 action_id:=(result->>'id')::uuid;
 if (select count(*) from public.employee_name_mappings where employee_id=retained and status='approved')<>2
  or (select count(*) from public.employees where location_id=site and is_active)<>1
 then raise exception 'Assigned Store atomic consolidation failed.';end if;
 audited:=public.employee_identity_consolidation(site,'list','{}')->0;
 if (audited->>'actor')::uuid<>gm or (audited->>'retained_id')::uuid<>retained
  or (audited->>'location_id')::uuid<>site or jsonb_array_length(audited->'selected_aliases')<>2
 then raise exception 'Audit did not preserve the complete review.';end if;
 -- Another target cannot capture any of the approved dates.
 begin
  perform public.employee_identity_consolidation(site,'apply',(payload-'roster')||jsonb_build_object(
   'retained',inactive_duplicate,'roster','[]'::jsonb,'aliases',jsonb_build_array(payload#>'{aliases,0}')));
  raise exception 'Existing mapping was overwritten.';
 exception when exclusion_violation then null;
 end;
 perform set_config('request.jwt.claim.sub',outside_gm::text,true);
 begin
  perform public.employee_identity_consolidation(site,'reverse',jsonb_build_object('id',action_id,'reason','Outside location'));
  raise exception 'Other-site Store reversed an action.';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub',gm::text,true);
 perform public.employee_identity_consolidation(site,'reverse',jsonb_build_object('id',action_id,'reason','Undo fixture'));
 if (select jsonb_agg(to_jsonb(d) order by d.id) from public.daily_logs d) is distinct from saved_logs
   or (select jsonb_agg(to_jsonb(e) order by e.id) from public.employees e) is distinct from saved_roster
   or (select count(*) from public.employee_name_mapping_audit where actor_id=gm)<>4
   or exists(select 1 from public.employee_name_mappings where status<>'rejected') then
   raise exception 'Reversal changed identity history or failed to restore roster statuses.';
 end if;
 if (public.employee_identity_consolidation(site,'list','{}')#>>'{0,reversed_by}')::uuid<>gm then
  raise exception 'Reversal was not audited.';
 end if;
end
$$;
select 'PASS: Store bulk mapping, inactive roster, site limits, stale/overlap atomicity and audited reversal' as result;
