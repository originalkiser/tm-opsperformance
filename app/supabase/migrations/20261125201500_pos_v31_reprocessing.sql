begin;

alter table pos_import_private.batches drop constraint batches_file_sha256_key, drop constraint batches_parser_version_check,
  add unique (file_sha256, parser_version),
  add check (parser_version in ('daily-pos-v2.0.0','daily-pos-v3.1.0'));

create table pos_import_private.reprocess_manifests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  reason text not null check (char_length(reason) between 1 and 500),
  workbooks jsonb not null,
  digest text not null,
  outcomes jsonb not null default '{}'::jsonb
);
alter table pos_import_private.reprocess_manifests enable row level security;
revoke all on pos_import_private.reprocess_manifests from public, anon, authenticated;

create or replace function pos_import_private.validate_document(p_document jsonb, p_system text) returns void
language plpgsql immutable set search_path = '' as $$
declare key text; item jsonb; amount numeric; quality jsonb; employee numeric := 0; non_tier numeric; member numeric; retail numeric; total numeric; m jsonb;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>100000
    or not p_document ?& array['metrics','sources','warnings','financialWarnings','provisionalFinancial']
    or p_document - array['metrics','sources','warnings','financialWarnings','provisionalFinancial','quality'] <> '{}'::jsonb
    or jsonb_typeof(p_document->'metrics') is distinct from 'object'
    or jsonb_typeof(p_document->'sources') is distinct from 'object'
    or jsonb_typeof(p_document->'warnings') is distinct from 'array'
    or jsonb_typeof(p_document->'financialWarnings') is distinct from 'array'
    or jsonb_typeof(p_document->'provisionalFinancial') is distinct from 'boolean' then
    raise exception 'Invalid POS document.';
  end if;
  if jsonb_array_length(p_document->'warnings') > 100 or jsonb_array_length(p_document->'financialWarnings') > 100 then raise exception 'Too many POS warnings.'; end if;
  if exists(select 1 from jsonb_array_elements((p_document->'warnings') || (p_document->'financialWarnings')) w(value)
    where jsonb_typeof(w.value) <> 'string' or char_length(w.value #>> '{}') > 2000) then raise exception 'Invalid POS warning.'; end if;
  if (p_document->'sources') - array['signedAmounts','washCount','memberships','redemptionTiers','quantityDifferences','report'] <> '{}'::jsonb
    or (p_document#>'{sources,report}' is not null and (
      jsonb_typeof(p_document#>'{sources,report}') <> 'object'
      or (p_document#>'{sources,report}') - array['member','unclassifiedRetail','unclassifiedRedemptions','packageBase'] <> '{}'::jsonb
    )) then raise exception 'Unsupported POS source detail.'; end if;
  if not (p_document->'metrics') ?& array['total','member','retail','payments','cards','house','other','cash','reportedCash','balance',
      'washes','governmentWashes','policeWashes','opportunities','redemptions','overrides','memberships','basicSold','goodSold','betterSold','bestSold','recharges','terminations','premiumSold','unclassifiedSold',
      'premiumRetail','eligibleRetail','premiumRedeemed','unclassifiedRedeemed'] then raise exception 'Missing POS metric keys.'; end if;
  for key, item in select * from jsonb_each(p_document->'metrics') loop
    if key not in ('total','member','retail','payments','cards','house','other','cash','reportedCash','balance',
      'washes','governmentWashes','policeWashes','opportunities','redemptions','overrides','memberships','basicSold','goodSold','betterSold','bestSold','recharges','terminations','premiumSold','unclassifiedSold',
      'premiumRetail','eligibleRetail','premiumRedeemed','unclassifiedRedeemed') then raise exception 'Unknown POS metric.'; end if;
    if item = 'null'::jsonb then continue; end if;
    if jsonb_typeof(item) <> 'number' then raise exception 'Financial amounts and quantities must be integers.'; end if;
    amount := (item #>> '{}')::numeric;
    if trunc(amount) <> amount or abs(amount)>999999999999
      or (key in ('washes','governmentWashes','policeWashes','opportunities','redemptions','overrides','memberships','basicSold','goodSold','betterSold','bestSold','recharges','terminations','premiumSold','unclassifiedSold',
      'premiumRetail','eligibleRetail','premiumRedeemed','unclassifiedRedeemed') and (amount<0 or amount>2147483647)) then
      raise exception 'Invalid POS metric range.';
    end if;
  end loop;
  total := (p_document#>>'{metrics,total}')::numeric;
  member := (p_document#>>'{metrics,member}')::numeric;
  retail := (p_document#>>'{metrics,retail}')::numeric;
  if (member is null) <> (retail is null) or (member is not null and (total is null or member+retail<>total)) then
    raise exception 'Member and retail revenue must reconcile to total revenue.';
  end if;
  m := p_document->'metrics';
  quality := p_document->'quality';
  if quality is not null then
    if jsonb_typeof(quality) is distinct from 'object'
      or not quality ?& array['revenueStatus','tenderStatus','employeeWashes','nonTierSold','nonTierRedeemed']
      or quality - array['revenueStatus','tenderStatus','employeeWashes','nonTierSold','nonTierRedeemed'] <> '{}'::jsonb
      or quality->>'tenderStatus' is distinct from (case when (p_document->>'provisionalFinancial')::boolean then 'provisional'
        when jsonb_array_length(p_document->'financialWarnings')>0 or (m->>'balance')::numeric is distinct from 0
          or m->>'cash' is null or m->>'cash' is distinct from m->>'reportedCash' then 'warning' else 'reconciled' end)
      or coalesce(quality->>'revenueStatus','') not in ('supported','provisional')
      or (quality->>'revenueStatus' = 'supported' and (total is null or
        (p_system = 'DRB' and exists(select 1 from jsonb_array_elements_text(p_document->'financialWarnings') w where w like 'Unmapped DRB categories:%')) or
        (p_system = 'Micrologic' and (p_document#>>'{sources,signedAmounts,totalRevenue}')::numeric is distinct from total) or
        (p_system = 'Micrologic' and (p_document#>>'{sources,signedAmounts,revenueSummary}')::numeric is distinct from total))) then
      raise exception 'Invalid independent revenue verification.';
    end if;
    for key, item in select * from jsonb_each(quality - array['revenueStatus','tenderStatus']) loop
      if item <> 'null'::jsonb and (jsonb_typeof(item) <> 'number' or (item #>> '{}') !~ '^[0-9]{1,10}$'
        or (item #>> '{}')::numeric > 2147483647) then raise exception 'Invalid POS exclusion quantity.'; end if;
    end loop;
    employee := (quality->>'employeeWashes')::numeric;
    if (p_system = 'DRB' and employee is null) or (p_system <> 'DRB' and employee is not null) then
      raise exception 'Employee wash exclusions apply only to DRB.';
    end if;
    for key, item in select * from jsonb_each(quality - array['revenueStatus','tenderStatus','employeeWashes']) loop
      non_tier := (item #>> '{}')::numeric;
      if key = 'nonTierSold' then
        if (m->>'premiumSold' is null) <> (non_tier is null) or
           non_tier + coalesce((m->>'unclassifiedSold')::numeric,0) + coalesce((m->>'premiumSold')::numeric,0) > (m->>'memberships')::numeric
          then raise exception 'Invalid non-tier membership sales.'; end if;
      elsif (m->>'premiumRedeemed' is null) <> (non_tier is null) or
          non_tier + coalesce((m->>'unclassifiedRedeemed')::numeric,0) + coalesce((m->>'premiumRedeemed')::numeric,0) > (m->>'redemptions')::numeric
        then raise exception 'Invalid non-tier membership redemptions.';
      end if;
    end loop;
  end if;
  if p_system='DRB' then
    if m->'total' is distinct from m->'payments' then raise exception 'DRB totals do not match its reporting rules.'; end if;
    if m->>'washes' is null or m->>'governmentWashes' is null or m->>'policeWashes' is null
      or (m->>'governmentWashes')::numeric+(m->>'policeWashes')::numeric + employee > (m->>'washes')::numeric
      or (m->>'opportunities')::numeric is distinct from
        (m->>'washes')::numeric-(m->>'governmentWashes')::numeric-(m->>'policeWashes')::numeric-employee then
      raise exception 'DRB wash opportunities do not reconcile.';
    end if;
  elsif m->>'governmentWashes' is not null or m->>'policeWashes' is not null then
    raise exception 'Government and police exclusions apply only to DRB.';
  end if;
  if p_system='Micrologic' and m->>'washes' is not null and m->>'redemptions' is not null and m->>'overrides' is not null
    and (m->>'opportunities')::numeric is distinct from greatest(0,
      (m->>'washes')::numeric-(m->>'redemptions')::numeric-(m->>'overrides')::numeric) then
    raise exception 'Micrologic wash opportunities do not reconcile.';
  end if;
  if m->>'cash' is not null and (m->>'cash')::numeric is distinct from
    (m->>'payments')::numeric-(m->>'cards')::numeric-(m->>'other')::numeric-
      (case when p_system='DRB' then (m->>'house')::numeric else 0 end) then
    raise exception 'Cash does not reconcile to the imported tenders.';
  end if;
  if exists(select 1 from (values ('premiumSold','memberships'),('premiumRedeemed','redemptions'),('premiumRetail','eligibleRetail'),
    ('unclassifiedSold','memberships'),('unclassifiedRedeemed','redemptions')) k(n,d)
    where (p_document->'metrics'->>k.n)::numeric > (p_document->'metrics'->>k.d)::numeric) then
    raise exception 'POS mix numerator exceeds its denominator.';
  end if;
end;
$$;

create function pos_import_private.commit_workbook(p_file_name text, p_sha text, p_parser text, p_system text, p_day date, p_rows jsonb, p_reprocess boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare entry jsonb; record_id uuid; previous pos_import_private.revisions; prior_system text;
  batch uuid; revision_number integer; validation text; financial text; doc jsonb; reason text;
  imported integer := 0; duplicates integer := 0; replaced integer := 0;
begin
  perform pos_import_private.require_admin();
  if p_day is null or p_day < date '2026-11-01' or p_day > (now() at time zone 'UTC')::date + 1
    or coalesce(p_parser,'') not in ('daily-pos-v2.0.0','daily-pos-v3.1.0') or coalesce(p_system,'') not in ('Micrologic','DRB')
    or coalesce(p_sha,'') !~ '^[0-9a-f]{64}$' or coalesce(char_length(p_file_name),0) not between 1 and 255
    or jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>2000000 then raise exception 'Invalid POS upload.'; end if;
  if jsonb_array_length(p_rows) not between 1 and 30 or exists(
    select 1 from jsonb_array_elements(p_rows) r(value) group by r.value->>'locationId' having count(*)>1
  ) then raise exception 'Invalid or duplicate workbook locations.'; end if;
  -- Serialize low-volume admin imports so overlapping files cannot race.
  perform pg_advisory_xact_lock(1481659401);
  if exists(select 1 from pos_import_private.batches where file_sha256=p_sha and (not p_reprocess or parser_version=p_parser)) then
    if p_reprocess and exists (
      select 1 from jsonb_array_elements(p_rows) j where not exists (
        select 1 from pos_import_private.current_records c
        join pos_import_private.revisions r using(location_id,business_date,revision)
        where c.location_id=(j->>'locationId')::uuid and c.business_date=p_day and r.document=j->'document'
      )
    ) then raise exception 'This workbook and parser version were already used for a different result.'; end if;
    return jsonb_build_object('imported',0,'replaced',0,'duplicates',jsonb_array_length(p_rows),'fileDuplicate',true);
  end if;
  for entry in select value from jsonb_array_elements(p_rows) loop
    record_id := (entry->>'locationId')::uuid;
    doc := entry->'document';
    reason := nullif(btrim(entry->>'reason'),'');
    if not exists(select 1 from public.locations l where l.id=record_id and l.exclude_from_reporting is not true
      and split_part(l.site_code,'-',1)=pos_import_private.site_code(p_system,entry->>'sourceId')
      and split_part(l.site_code,'-',1)<>'1509') then raise exception 'POS source does not match an eligible location.'; end if;
    if (doc ? 'quality') <> (p_parser = 'daily-pos-v3.1.0') then raise exception 'POS document version does not match the parser.'; end if;
    if p_reprocess and not exists (
      select 1 from pos_import_private.revisions r join pos_import_private.batches b on b.id=r.batch_id
      where r.location_id=record_id and r.business_date=p_day and b.file_sha256=p_sha
        and b.parser_version='daily-pos-v2.0.0' and b.system=p_system and r.source_id=entry->>'sourceId'
    ) then raise exception 'Workbook does not match the saved source identity.'; end if;
    perform pos_import_private.validate_document(doc,p_system);
    validation := pos_import_private.validation(doc);
    financial := pos_import_private.financial_status(doc);
    if doc#>>'{metrics,total}' is null and doc#>>'{metrics,washes}' is null and doc#>>'{metrics,memberships}' is null then
      raise exception 'No usable POS results.';
    end if;
    select r.* into previous from pos_import_private.current_records c join pos_import_private.revisions r
       using (location_id,business_date,revision) where c.location_id=record_id and c.business_date=p_day;
    if found then
      select system into prior_system from pos_import_private.batches where id=previous.batch_id;
      if prior_system<>p_system then raise exception 'Conflicting POS system for this location and date.'; end if;
      if p_reprocess and ((entry->>'expectedRevision')::integer is distinct from previous.revision or
        exists (select 1 from unnest(array['total','washes','memberships','redemptions','payments',
          'cash','reportedCash','cards','house','other','balance','governmentWashes','policeWashes']) k
          where previous.document->'metrics'->k is distinct from doc->'metrics'->k) or
        previous.document->'financialWarnings' is distinct from doc->'financialWarnings' or
        previous.document->'provisionalFinancial' is distinct from doc->'provisionalFinancial' or
        (previous.document#>'{sources,signedAmounts}') - 'revenueSummary' is distinct from
          (doc#>'{sources,signedAmounts}') - 'revenueSummary')
        then raise exception 'Historical revision changed or source invariants failed.'; end if;
      if previous.document=doc then duplicates := duplicates+1; continue; end if;
      if reason is null or (entry->>'expectedRevision')::integer is distinct from previous.revision then
        raise exception 'Correction approval or current revision required.';
      end if;
      if (previous.validation='validated' and validation<>'validated')
        or (previous.financial_status='reconciled' and financial<>'reconciled')
        or exists(select 1 from jsonb_each(previous.document->'metrics') m(k,v)
          where v<>'null'::jsonb and doc->'metrics'->k='null'::jsonb) then
        raise exception 'Incomplete correction cannot replace more complete POS results.';
      end if;
      revision_number := previous.revision+1;
      replaced := replaced+1;
    else
      if p_reprocess then raise exception 'Historical reprocessing requires existing records.'; end if;
      if coalesce((entry->>'expectedRevision')::integer,0)<>0 then raise exception 'Current POS revision changed.'; end if;
      revision_number := 1;
      reason := null;
      imported := imported+1;
    end if;
    if batch is null then
      insert into pos_import_private.batches(file_name,file_sha256,parser_version,imported_by,business_date,system)
        values(p_file_name,p_sha,p_parser,auth.uid(),p_day,p_system) returning id into batch;
    end if;
    insert into pos_import_private.revisions values(record_id,p_day,revision_number,batch,entry->>'sourceId',validation,financial,doc,reason);
    insert into pos_import_private.current_records values(record_id,p_day,revision_number)
      on conflict(location_id,business_date) do update set revision=excluded.revision;
  end loop;
  return jsonb_build_object('batchId',batch,'imported',imported,'replaced',replaced,'duplicates',duplicates);
end;
$$;

create or replace function public.pos_daily_commit(p_file_name text, p_sha text, p_parser text, p_system text, p_day date, p_rows jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select pos_import_private.commit_workbook(p_file_name,p_sha,p_parser,p_system,p_day,p_rows,false);
$$;

create function public.pos_reprocess_prepare(p_workbooks jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare manifest pos_import_private.reprocess_manifests;
begin
  perform pos_import_private.require_admin();
  if jsonb_typeof(p_workbooks) is distinct from 'array' or octet_length(p_workbooks::text)>8000000
    or char_length(coalesce(btrim(p_reason),'')) not between 1 and 500 then raise exception 'Invalid historical manifest.'; end if;
  if jsonb_array_length(p_workbooks) not between 1 and 70 or exists (
    select 1 from jsonb_array_elements(p_workbooks) w
    where coalesce(w->>'sha','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(w->'rows') is distinct from 'array'
      or w->>'parser' is distinct from 'daily-pos-v3.1.0'
      or not exists(select 1 from pos_import_private.batches b where b.file_sha256=w->>'sha'
        and b.parser_version='daily-pos-v2.0.0' and b.business_date=(w->>'day')::date and b.system=w->>'system')
  ) or exists (select 1 from jsonb_array_elements(p_workbooks) w group by w->>'sha' having count(*)>1)
    then raise exception 'Invalid or duplicate historical workbook identity.'; end if;
  if exists (select 1 from jsonb_array_elements(p_workbooks) w
      where jsonb_array_length(w->'rows') not between 1 and 30) or exists (
    select 1 from jsonb_array_elements(p_workbooks) w cross join lateral jsonb_array_elements(w->'rows') r
    group by (w->>'day')::date, (r->>'locationId')::uuid having count(*)>1
  ) then raise exception 'Invalid or overlapping historical workbook locations.'; end if;
  insert into pos_import_private.reprocess_manifests(created_by,reason,workbooks,digest)
    values(auth.uid(),btrim(p_reason),p_workbooks,encode(sha256(convert_to(jsonb_build_array(btrim(p_reason),p_workbooks)::text,'UTF8')),'hex'))
    returning * into manifest;
  return jsonb_build_object('id',manifest.id,'digest',manifest.digest);
end;
$$;

create function public.pos_reprocess_approve(p_id uuid, p_digest text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pos_import_private.require_admin();
  update pos_import_private.reprocess_manifests
    set approved_at=coalesce(approved_at,now()),approved_by=auth.uid()
    where id=p_id and digest=p_digest and created_by=auth.uid();
  if not found then raise exception 'Reviewed manifest could not be approved.'; end if;
end;
$$;

create function public.pos_reprocess_status(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare manifest pos_import_private.reprocess_manifests;
begin
  perform pos_import_private.require_admin();
  select * into strict manifest from pos_import_private.reprocess_manifests where id=p_id and created_by=auth.uid();
  return jsonb_build_object('id',manifest.id,'approved',manifest.approved_at is not null,'digest',manifest.digest,
    'workbooks',(select jsonb_agg(jsonb_build_object('name',w->>'name','sha',w->>'sha','day',w->>'day',
      'outcome',manifest.outcomes->(w->>'sha'))) from jsonb_array_elements(manifest.workbooks) w));
end;
$$;

create function public.pos_reprocess_workbook(p_id uuid, p_sha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare manifest pos_import_private.reprocess_manifests; workbook jsonb; result jsonb;
begin
  perform pos_import_private.require_admin();
  select * into strict manifest from pos_import_private.reprocess_manifests
    where id=p_id and created_by=auth.uid() and approved_at is not null for update;
  select w into strict workbook from jsonb_array_elements(manifest.workbooks) w where w->>'sha'=p_sha;
  result := manifest.outcomes->p_sha;
  if result is not null and result->>'status'<>'failed' then return result; end if;
  begin
    result := pos_import_private.commit_workbook(workbook->>'name',p_sha,workbook->>'parser',workbook->>'system',
      (workbook->>'day')::date,(select jsonb_agg(r || jsonb_build_object('reason',manifest.reason))
        from jsonb_array_elements(workbook->'rows') r),true);
    result := result || jsonb_build_object('status',case when (result->>'replaced')::int > 0 then 'completed' else 'unchanged' end);
  exception when others then
    result := jsonb_build_object('status','failed','error',SQLERRM);
  end;
  update pos_import_private.reprocess_manifests set outcomes=jsonb_set(outcomes,array[p_sha],result) where id=p_id;
  return result;
end;
$$;

create function public.pos_reprocess_rollback(p_id uuid, p_sha text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare manifest pos_import_private.reprocess_manifests; result jsonb; changed pos_import_private.revisions;
  previous pos_import_private.revisions; batch uuid; rollback_count int := 0;
begin
  perform pos_import_private.require_admin();
  if char_length(coalesce(btrim(p_reason),'')) not between 1 and 470 then raise exception 'Enter a rollback reason.'; end if;
  select * into strict manifest from pos_import_private.reprocess_manifests
    where id=p_id and created_by=auth.uid() and approved_at is not null for update;
  result := manifest.outcomes->p_sha;
  if result->>'status'='rolled back' then return result; end if;
  if result->>'status' is distinct from 'completed' then raise exception 'Only completed workbooks can be rolled back.'; end if;
  perform pg_advisory_xact_lock(1481659401);
  batch := (result->>'batchId')::uuid;
  for changed in select r.* from jsonb_array_elements(manifest.workbooks) w
    cross join lateral jsonb_array_elements(w->'rows') j
    join pos_import_private.revisions r on r.location_id=(j->>'locationId')::uuid
      and r.revision=(j->>'expectedRevision')::int+1
    where w->>'sha'=p_sha and r.batch_id=batch and r.business_date=(w->>'day')::date loop
    if not exists(select 1 from pos_import_private.current_records where
      (location_id,business_date,revision)=(changed.location_id,changed.business_date,changed.revision))
      then raise exception 'A newer revision exists. Rollback would overwrite newer work.'; end if;
    select * into strict previous from pos_import_private.revisions where
      (location_id,business_date,revision)=(changed.location_id,changed.business_date,changed.revision-1);
    insert into pos_import_private.revisions values(previous.location_id,previous.business_date,changed.revision+1,
      previous.batch_id,previous.source_id,previous.validation,previous.financial_status,previous.document,
      'Historical rollback: ' || btrim(p_reason));
    update pos_import_private.current_records set revision=changed.revision+1
      where (location_id,business_date)=(changed.location_id,changed.business_date);
    rollback_count := rollback_count + 1;
  end loop;
  result := result || jsonb_build_object('status','rolled back','rollbackCount',rollback_count,'rollbackBy',auth.uid(),
    'rollbackAt',now(),'rollbackReason',btrim(p_reason));
  update pos_import_private.reprocess_manifests set outcomes=jsonb_set(outcomes,array[p_sha],result) where id=p_id;
  return result;
end;
$$;

revoke all on function pos_import_private.commit_workbook(text,text,text,text,date,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.pos_reprocess_prepare(jsonb,text), public.pos_reprocess_approve(uuid,text),
  public.pos_reprocess_status(uuid), public.pos_reprocess_workbook(uuid,text), public.pos_reprocess_rollback(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.pos_reprocess_prepare(jsonb,text), public.pos_reprocess_approve(uuid,text),
  public.pos_reprocess_status(uuid), public.pos_reprocess_workbook(uuid,text), public.pos_reprocess_rollback(uuid,text,text)
  to authenticated;

commit;
