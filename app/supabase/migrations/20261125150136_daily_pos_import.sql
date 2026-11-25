begin;

create schema pos_import_private;
revoke all on schema pos_import_private from public, anon, authenticated;

create table pos_import_private.batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (parser_version = 'daily-pos-v2.0.0'),
  imported_at timestamptz not null default now(),
  imported_by uuid not null,
  business_date date not null check (business_date >= date '2026-11-01'),
  system text not null check (system in ('Micrologic', 'DRB'))
);

create table pos_import_private.revisions (
  location_id uuid not null references public.locations(id),
  business_date date not null,
  revision integer not null check (revision > 0),
  batch_id uuid not null references pos_import_private.batches(id),
  source_id text not null check (char_length(source_id) between 1 and 200),
  validation text not null check (validation in ('validated', 'incomplete')),
  financial_status text not null check (financial_status in ('reconciled', 'warning', 'provisional')),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  replacement_reason text check (replacement_reason is null or char_length(replacement_reason) between 1 and 500),
  primary key (location_id, business_date, revision)
);

create table pos_import_private.current_records (
  location_id uuid not null,
  business_date date not null,
  revision integer not null,
  primary key (location_id, business_date),
  foreign key (location_id, business_date, revision)
    references pos_import_private.revisions(location_id, business_date, revision)
);
create index pos_current_by_date on pos_import_private.current_records(business_date, location_id);
alter table pos_import_private.batches enable row level security;
alter table pos_import_private.revisions enable row level security;
alter table pos_import_private.current_records enable row level security;
revoke all on all tables in schema pos_import_private from public, anon, authenticated;

create function pos_import_private.require_admin() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not exists(select 1 from public.user_profiles p where p.id = auth.uid()
    and p.role = 'admin' and p.is_active is true and p.deleted_at is null) then
    raise exception 'Active Admin access required.' using errcode = '42501';
  end if;
end;
$$;

create function pos_import_private.site_code(p_system text, p_source text) returns text
language sql immutable set search_path = '' as $$
  select case p_system when 'Micrologic' then
    case p_source when 'TCWWR' then '1529' when 'TCWBR' then '1528' when 'PECWF' then '1517'
      when 'TCWBLO' then '1531' when 'TCWEJB' then '1532' when 'TCWCB' then '1515' when 'TCWFM' then '1512' end
    when 'DRB' then
    case when lower(p_source) in ('1508-mesquite','1511-allen','1516-plano','1518-greenwood','1519-greenville',
      '1520-cleveland','1521-port arthur','1522-groves','1524-beaumont','1525-breaux bridge','1526-mansura',
      '1527-carencro','1530-batesville') then left(p_source,4) end end;
$$;

-- Accept a bounded, fixed projection of the parsed source. Derived financial
-- splits and comparison status must satisfy the same rules on direct RPC calls.
create function pos_import_private.validate_document(p_document jsonb, p_system text) returns void
language plpgsql immutable set search_path = '' as $$
declare key text; item jsonb; amount numeric; member numeric; retail numeric; total numeric; m jsonb;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>100000
    or not p_document ?& array['metrics','sources','warnings','financialWarnings','provisionalFinancial']
    or p_document - array['metrics','sources','warnings','financialWarnings','provisionalFinancial'] <> '{}'::jsonb
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
  if p_system='DRB' then
    if m->'total' is distinct from m->'payments' then raise exception 'DRB totals do not match its reporting rules.'; end if;
    if m->>'washes' is null or m->>'governmentWashes' is null or m->>'policeWashes' is null
      or (m->>'governmentWashes')::numeric+(m->>'policeWashes')::numeric > (m->>'washes')::numeric
      or (m->>'opportunities')::numeric is distinct from
        (m->>'washes')::numeric-(m->>'governmentWashes')::numeric-(m->>'policeWashes')::numeric then
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

create function pos_import_private.financial_status(p_document jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when (p_document->>'provisionalFinancial')::boolean or p_document#>>'{metrics,total}' is null
    or p_document#>>'{metrics,payments}' is null then 'provisional'
    when jsonb_array_length(p_document->'financialWarnings')>0
      or (p_document#>>'{metrics,balance}')::numeric is distinct from 0
      or p_document#>>'{metrics,cash}' is null
      or p_document#>>'{metrics,cash}' is distinct from p_document#>>'{metrics,reportedCash}' then 'warning'
    else 'reconciled' end;
$$;

create function pos_import_private.validation(p_document jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when jsonb_array_length(p_document->'warnings')>0 or exists(
    select 1 from unnest(array['total','member','retail','washes','opportunities','redemptions','memberships',
      'eligibleRetail','premiumRetail','premiumSold','premiumRedeemed','unclassifiedSold','unclassifiedRedeemed']) k
    where p_document->'metrics'->>k is null)
    or (p_document#>>'{metrics,unclassifiedSold}')::numeric>0
    or (p_document#>>'{metrics,unclassifiedRedeemed}')::numeric>0
    then 'incomplete' else 'validated' end;
$$;

create function public.pos_daily_commit(p_file_name text, p_sha text, p_parser text, p_system text, p_day date, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare entry jsonb; record_id uuid; previous pos_import_private.revisions; prior_system text;
  batch uuid; revision_number integer; validation text; financial text; doc jsonb; reason text;
  imported integer := 0; duplicates integer := 0; replaced integer := 0;
begin
  perform pos_import_private.require_admin();
  if p_day is null or p_day < date '2026-11-01' or p_day > (now() at time zone 'UTC')::date + 1
    or p_parser is distinct from 'daily-pos-v2.0.0' or coalesce(p_system,'') not in ('Micrologic','DRB')
    or coalesce(p_sha,'') !~ '^[0-9a-f]{64}$' or coalesce(char_length(p_file_name),0) not between 1 and 255
    or jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>2000000 then raise exception 'Invalid POS upload.'; end if;
  if jsonb_array_length(p_rows) not between 1 and 30 or exists(
    select 1 from jsonb_array_elements(p_rows) r(value) group by r.value->>'locationId' having count(*)>1
  ) then raise exception 'Invalid or duplicate workbook locations.'; end if;
  -- Serialize low-volume admin imports so overlapping files cannot race.
  perform pg_advisory_xact_lock(1481659401);
  if exists(select 1 from pos_import_private.batches where file_sha256=p_sha) then
    return jsonb_build_object('imported',0,'replaced',0,'duplicates',jsonb_array_length(p_rows),'fileDuplicate',true);
  end if;
  for entry in select value from jsonb_array_elements(p_rows) loop
    record_id := (entry->>'locationId')::uuid;
    doc := entry->'document';
    reason := nullif(btrim(entry->>'reason'),'');
    if not exists(select 1 from public.locations l where l.id=record_id and l.exclude_from_reporting is not true
      and split_part(l.site_code,'-',1)=pos_import_private.site_code(p_system,entry->>'sourceId')
      and split_part(l.site_code,'-',1)<>'1509') then raise exception 'POS source does not match an eligible location.'; end if;
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

create function public.pos_daily_report(p_start date, p_end date, p_offset integer default 0)
returns table(location_id uuid,business_date date,revision integer,system text,validation text,financial_status text,document jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pos_import_private.require_admin();
  if p_start is null or p_end is null or p_start < date '2026-11-01' or p_end < p_start
    or p_end-p_start>366 or p_offset is null or p_offset<0 then raise exception 'Select a date range of up to 367 days.'; end if;
  return query select r.location_id,r.business_date,r.revision,b.system,r.validation,r.financial_status,r.document
    from pos_import_private.current_records c
    join pos_import_private.revisions r using(location_id,business_date,revision)
    join pos_import_private.batches b on b.id=r.batch_id join public.locations l on l.id=r.location_id
    where r.business_date between p_start and p_end and l.exclude_from_reporting is not true and split_part(l.site_code,'-',1)<>'1509'
    order by r.business_date,r.location_id limit 100 offset p_offset;
end;
$$;

create function public.pos_daily_history(p_location uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform pos_import_private.require_admin();
  return (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('batch',to_jsonb(b)) order by r.revision desc),'[]'::jsonb)
    from pos_import_private.revisions r join pos_import_private.batches b on b.id=r.batch_id
    where r.location_id=p_location and r.business_date=p_day);
end;
$$;

revoke all on all functions in schema pos_import_private from public, anon, authenticated;
revoke all on function public.pos_daily_commit(text,text,text,text,date,jsonb), public.pos_daily_report(date,date,integer),
  public.pos_daily_history(uuid,date) from public, anon, authenticated;
grant execute on function public.pos_daily_commit(text,text,text,text,date,jsonb), public.pos_daily_report(date,date,integer),
  public.pos_daily_history(uuid,date) to authenticated;
commit;
