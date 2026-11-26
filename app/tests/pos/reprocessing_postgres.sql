-- Run after the baseline POS migration and V3.1 migration in an isolated database
-- with the same locations, user_profiles, auth.uid() and Supabase roles.
insert into public.locations values ('00000000-0000-0000-0000-000000000001','1508-Mesquite',false);
insert into public.user_profiles values
  ('00000000-0000-0000-0000-000000000002','admin',true,null),
  ('00000000-0000-0000-0000-000000000003','store',true,null),
  ('00000000-0000-0000-0000-000000000004','admin',false,null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);

do $$
declare
  loc text := '00000000-0000-0000-0000-000000000001';
  hash text := repeat('a',64);
  doc jsonb := '{
    "metrics":{"total":10000,"member":null,"retail":null,"payments":10000,"cards":9000,"house":0,
    "other":0,"cash":1000,"reportedCash":1000,"balance":0,"washes":40,"governmentWashes":1,"policeWashes":2,
    "opportunities":37,"redemptions":20,"overrides":null,"memberships":4,"basicSold":1,"goodSold":0,
    "betterSold":0,"bestSold":2,"recharges":10,"terminations":0,"premiumSold":2,"unclassifiedSold":1,
    "premiumRetail":10,"eligibleRetail":13,"premiumRedeemed":10,"unclassifiedRedeemed":1},
    "sources":{"signedAmounts":{"basic washes":10000}},"warnings":[],"financialWarnings":[],"provisionalFinancial":false}';
  updated jsonb;
  old_row jsonb;
  invalid jsonb;
  new_row jsonb;
  book jsonb;
  manifest jsonb;
  stale jsonb;
  result jsonb;
  id uuid;
  day date := '2026-11-03';
begin
  if has_schema_privilege('authenticated','pos_import_private','USAGE') or
    has_function_privilege('anon','public.pos_reprocess_prepare(jsonb,text)','EXECUTE') then
    raise exception 'Private data or RPC is accessible.';
  end if;
  old_row := jsonb_build_object('sourceId','1508-Mesquite','locationId',loc,'expectedRevision',0,'document',doc);
  result := public.pos_daily_commit('original.xlsx',hash,'daily-pos-v2.0.0','DRB',day,jsonb_build_array(old_row));
  if result->>'imported' <> '1' then raise exception 'Baseline import failed.'; end if;
  -- Both migrations are installed before this fixture runs. A fresh hash exercises
  -- validation rather than the duplicate fast path.
  result := public.pos_daily_commit('legacy-after-migration.xlsx',repeat('b',64),'daily-pos-v2.0.0','DRB',
    day+1,jsonb_build_array(old_row));
  if result->>'imported' is distinct from '1' then raise exception 'Valid legacy DRB import failed.'; end if;
  updated := jsonb_set(doc,'{metrics}',doc->'metrics' ||
    '{"member":2500,"retail":7500,"opportunities":36,"unclassifiedSold":0,"unclassifiedRedeemed":0}'::jsonb)
    || '{"quality":{"revenueStatus":"supported","tenderStatus":"reconciled","employeeWashes":1,"nonTierSold":1,"nonTierRedeemed":1}}'::jsonb;
  foreach invalid in array array[
    updated #- '{quality,employeeWashes}',
    jsonb_set(updated,'{quality,employeeWashes}','null'),
    jsonb_set(updated,'{quality,employeeWashes}','-1'),
    jsonb_set(updated,'{quality,employeeWashes}','1.5'),
    jsonb_set(updated,'{quality,employeeWashes}','"1"'),
    jsonb_set(updated,'{metrics,opportunities}','37')
  ] loop
    begin
      perform public.pos_daily_commit('invalid.xlsx',repeat('c',64),'daily-pos-v3.1.0','DRB',
        day+2,jsonb_build_array(old_row || jsonb_build_object('document',invalid)));
      raise exception 'Invalid V3.1 employee exclusion accepted.';
    exception when raise_exception then
      if sqlerrm not in ('Invalid independent revenue verification.', 'Employee wash exclusions apply only to DRB.',
        'Invalid POS exclusion quantity.', 'DRB wash opportunities do not reconcile.') then raise; end if;
    end;
  end loop;
  result := public.pos_daily_commit('v31.xlsx',repeat('d',64),'daily-pos-v3.1.0','DRB',
    day+2,jsonb_build_array(old_row || jsonb_build_object('document',updated)));
  if result->>'imported' is distinct from '1' then raise exception 'Valid V3.1 DRB import failed.'; end if;
  new_row := old_row || jsonb_build_object('expectedRevision',1,'document',updated);
  if (public.pos_daily_commit('original.xlsx',hash,'daily-pos-v3.1.0','DRB',day,jsonb_build_array(new_row)))->>'fileDuplicate'
    is distinct from 'true' then raise exception 'Normal cross-version duplicate protection failed.'; end if;
  book := jsonb_build_object('name','original.xlsx','sha',hash,'parser','daily-pos-v3.1.0','system','DRB','day',day,
    'rows',jsonb_build_array(new_row));
  foreach loc in array array['00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'] loop
    perform set_config('request.jwt.claim.sub',loc,false);
    begin
      perform public.pos_reprocess_prepare(jsonb_build_array(book),'Unauthorized');
      raise exception 'Non-admin manifest accepted.';
    exception when insufficient_privilege then null;
    end;
  end loop;
  loc := '00000000-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
  manifest := public.pos_reprocess_prepare(jsonb_build_array(book),'Approved classify');
  id := (manifest->>'id')::uuid;
  begin
    perform public.pos_reprocess_workbook(id,hash);
    raise exception 'Unapproved manifest executed.';
  exception when no_data_found then null;
  end;
  begin
    perform public.pos_reprocess_approve(id,repeat('0',64));
    raise exception 'Incorrect manifest digest approved.';
  exception when raise_exception then
    if sqlerrm <> 'Reviewed manifest could not be approved.' then raise; end if;
  end;
  stale := public.pos_reprocess_prepare(jsonb_build_array(jsonb_set(book,'{rows,0,expectedRevision}','2')),'Stale fixture');
  perform public.pos_reprocess_approve((stale->>'id')::uuid,stale->>'digest');
  result := public.pos_reprocess_workbook((stale->>'id')::uuid,hash);
  if result->>'status' <> 'failed' or result->>'error' not like 'Historical revision changed%' then
    raise exception 'Stale revision was not rejected: %',result;
  end if;
  stale := public.pos_reprocess_prepare(jsonb_build_array(jsonb_set(book,'{rows,0,document,quality,nonTierSold}','9')),'Invalid tier fixture');
  perform public.pos_reprocess_approve((stale->>'id')::uuid,stale->>'digest');
  result := public.pos_reprocess_workbook((stale->>'id')::uuid,hash);
  if result->>'status' <> 'failed' or result->>'error' <> 'Invalid non-tier membership sales.' then
    raise exception 'Invalid non-tier count accepted: %',result;
  end if;
  perform public.pos_reprocess_approve(id,manifest->>'digest');
  result := public.pos_reprocess_workbook(id,hash);
  if result->>'status' <> 'completed' or result->>'replaced' <> '1' then raise exception 'Reprocessing failed: %',result; end if;
  if public.pos_reprocess_workbook(id,hash) is distinct from result then raise exception 'Retry was not idempotent.'; end if;
  if (public.pos_reprocess_status(id)#>>'{workbooks,0,outcome,status}') <> 'completed' then raise exception 'Resume status missing.'; end if;
  if (select count(*) from pos_import_private.revisions where business_date=day) <> 2 or
    (select document from pos_import_private.revisions where revision=1 and business_date=day) <> doc then raise exception 'Revision history changed.'; end if;
  result := public.pos_reprocess_rollback(id,hash,'Restore prior fixture');
  if result->>'rollbackCount' <> '1' or (select count(*) from pos_import_private.revisions where business_date=day) <> 3 or
    (select revision from pos_import_private.current_records where business_date=day) <> 3 or
    (select document from pos_import_private.revisions where revision=3 and business_date=day) <> doc then raise exception 'Rollback failed: %', result; end if;
  if public.pos_reprocess_rollback(id,hash,'Retry') is distinct from result then raise exception 'Rollback retry changed history.'; end if;
end;
$$;
select 'PASS: POS reprocessing authorization, versioning, manifest binding, stale protection, retry and audited rollback' as result;
