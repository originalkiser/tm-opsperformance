-- Prepared only. No production records, existing permissions or reviewer grants changed.
-- Release gate: confirm DRB Site+SaleID identity contract, reviewer scope and PII retention.
begin;
set local lock_timeout='3s';
create schema reconciliation_private;
revoke all on schema reconciliation_private from public,anon,authenticated,service_role;
create table reconciliation_private.reviewers (
 user_id uuid primary key references public.user_profiles(id),
 granted_at timestamptz not null default now()
);
-- Deliberately EMPTY. Existing Admin/Super Admin status grants no customer access.
create table reconciliation_private.batches (
 id bigint generated always as identity primary key,
 file_hash text not null check(file_hash ~ '^[0-9a-f]{64}$'),
 kind text not null check(kind in ('original','reviewed')),
 content_digest text not null,
 start_date date not null, end_date date not null check(end_date>=start_date),
 actor uuid not null, created_at timestamptz not null default now(),
 unique(file_hash,kind)
);
create table reconciliation_private.sales (
 id bigint generated always as identity primary key,
 location_id uuid not null references public.locations(id),
 sale_id text not null check(sale_id ~ '^\d{1,30}$'),
 log_date date not null, item text not null,
 revision integer not null default 0,
 decision text not null default 'pending' check(decision in ('pending','eligible','excluded')),
 activity text not null default 'unknown' check(activity in ('unknown','new','renewal','reactivation','replacement','refund','void')),
 identity_confirmed boolean not null default false,
 reason text not null default '' check(length(reason)<=1000),
 unique(location_id,sale_id)
);
create table reconciliation_private.observations (
 id bigint generated always as identity primary key,
 sale_id bigint not null references reconciliation_private.sales(id),
 batch_id bigint not null references reconciliation_private.batches(id),
 employee_identifier text not null,
 commission numeric not null,
 customer_name text not null check(length(customer_name)<=200),
 customer_phone text not null check(length(customer_phone)<=100),
 source_note text not null check(length(source_note)<=2000),
 unique(sale_id,batch_id)
);
create table reconciliation_private.employee_mappings (
 id bigint generated always as identity primary key,
 location_id uuid not null references public.locations(id),
 identifier text not null check(identifier ~ '^\d{10}$'),
 employee_id uuid not null references public.employees(id),
 start_date date not null, end_date date not null check(end_date>=start_date),
 status text not null default 'proposed' check(status in ('proposed','approved','rejected')),
 revision integer not null default 0, reason text not null check(length(btrim(reason)) between 1 and 1000),
 actor uuid not null, created_at timestamptz not null default now()
);
create table reconciliation_private.audit (
 id bigint generated always as identity primary key,
 actor uuid not null, happened_at timestamptz not null default clock_timestamp(),
 action text not null, subject_id bigint not null, previous jsonb, next jsonb
);
create index drb_customer_name_lookup on reconciliation_private.observations(lower(btrim(customer_name))) where btrim(customer_name)<>'';
create index drb_customer_phone_lookup on reconciliation_private.observations(regexp_replace(customer_phone,'[^0-9]','','g'));
create index drb_sales_log_date on reconciliation_private.sales(log_date,id);
create index drb_mapping_lookup on reconciliation_private.employee_mappings(location_id,identifier,start_date,end_date) where status='approved';
-- No direct API path, including service role; only the guarded, fixed-action RPC.
do $$ declare t text; begin
 foreach t in array array['reviewers','batches','sales','observations','employee_mappings','audit'] loop
  execute format('alter table reconciliation_private.%I enable row level security',t);
 end loop;
end $$;
revoke all on all tables in schema reconciliation_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema reconciliation_private from public,anon,authenticated,service_role;

create function reconciliation_private.allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from reconciliation_private.reviewers r join public.user_profiles p on p.id=r.user_id
 where r.user_id=auth.uid() and p.role='admin' and p.is_active and p.deleted_at is null);
$$;
revoke all on function reconciliation_private.allowed() from public,anon,authenticated,service_role;

create function reconciliation_private.api(action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 b reconciliation_private.batches; s reconciliation_private.sales; m reconciliation_private.employee_mappings;
 r jsonb; v_location uuid; v_sale bigint; old jsonb; result jsonb; v_kind text; v_start date; v_end date;
 v_employee uuid; v_identifier text; v_count integer; v_decision text; v_activity text;
begin
 if not reconciliation_private.allowed() then raise exception 'Authorized sales reviewer required' using errcode='42501'; end if;
 -- Serialize mutations, including mapping overlap approval and imports. Also
 -- prevent a grant/account change racing a write while its authorization is used.
 perform 1 from public.user_profiles where id=auth.uid() for share;
 perform 1 from reconciliation_private.reviewers where user_id=auth.uid() for share;
 if not reconciliation_private.allowed() then raise exception 'Reviewer access changed' using errcode='42501'; end if;
 if action='status' then return jsonb_build_object('reviewer',true); end if;
 if action='import' then
  perform pg_advisory_xact_lock(724174,1);
  if payload - array['kind','start_date','end_date','rows','file_hash'] <> '{}'::jsonb then raise exception 'Unexpected import fields'; end if;
  v_kind:=payload->>'kind'; v_start:=(payload->>'start_date')::date; v_end:=(payload->>'end_date')::date;
  if v_kind is null or v_kind not in ('original','reviewed') or v_start is null or v_end is null or v_start>v_end
    or v_start<'2000-01-01' or v_end>'2100-12-31' or coalesce(payload->>'file_hash','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(payload->'rows') is distinct from 'array' then raise exception 'Invalid import'; end if;
  if jsonb_array_length(payload->'rows') not between 1 and 20000 or pg_column_size(payload)>12000000 then raise exception 'Import size limit'; end if;
  select * into b from reconciliation_private.batches where file_hash=payload->>'file_hash' and kind=v_kind;
  if found then
   if b.start_date<>v_start or b.end_date<>v_end or b.content_digest<>md5((payload->'rows')::text) then raise exception 'Previously imported file has different content or coverage'; end if;
   return jsonb_build_object('batch_id',b.id,'repeat',true);
  end if;
  insert into reconciliation_private.batches(file_hash,kind,content_digest,start_date,end_date,actor)
   values(payload->>'file_hash',v_kind,md5((payload->'rows')::text),v_start,v_end,auth.uid()) returning * into b;
  -- Check duplicates before any inserts; do not choose an arbitrary line.
  if exists(select 1 from jsonb_array_elements(payload->'rows') x group by x->>'site_code',x->>'sale_id' having count(*)>1) then
   raise exception 'Repeated Site + Sale ID requires a verified line identifier'; end if;
  for r in select * from jsonb_array_elements(payload->'rows') loop
   if jsonb_typeof(r) is distinct from 'object' or r - array['site_code','sale_id','log_date','item','employee_identifier','commission','customer_name','customer_phone','source_note'] <> '{}'::jsonb
    or coalesce(r->>'site_code','') !~ '^\d{4}$' or coalesce(r->>'sale_id','') !~ '^\d{1,30}$'
    or length(btrim(coalesce(r->>'item',''))) not between 1 and 200
    or coalesce(r->>'employee_identifier','') !~ '^\d{0,20}$' or coalesce(r->>'commission','') !~ '^-?\d{1,10}(\.\d{1,6})?$'
    or coalesce(r->>'log_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or (r->>'log_date')::date not between v_start and v_end
    or r->>'customer_name' is null or r->>'customer_phone' is null
    or r->>'source_note' is null or length(r->>'source_note')>2000
    or length(r->>'customer_name')>200 or length(r->>'customer_phone')>100 then raise exception 'Invalid transaction row'; end if;
   select count(*),min(id::text)::uuid into v_count,v_location from public.locations where split_part(site_code,'-',1)=r->>'site_code';
   if v_count<>1 then raise exception 'Site must match exactly one location'; end if;
   insert into reconciliation_private.sales(location_id,sale_id,log_date,item)
    values(v_location,r->>'sale_id',(r->>'log_date')::date,r->>'item') on conflict(location_id,sale_id) do nothing;
   select * into strict s from reconciliation_private.sales where location_id=v_location and sale_id=r->>'sale_id' for update;
   if s.log_date<>(r->>'log_date')::date or s.item<>r->>'item' then raise exception 'Transaction identity conflict; no import saved'; end if;
   -- Overlapping exports must agree within their source kind. Reviewed revisions
   -- with changed identifiers/amounts require explicit resolution, never overwrite.
   if exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id
      where o.sale_id=s.id and ib.kind=v_kind and
      (o.employee_identifier<>coalesce(r->>'employee_identifier','') or o.commission<>(r->>'commission')::numeric
       or o.customer_name<>r->>'customer_name' or o.customer_phone<>r->>'customer_phone' or o.source_note<>r->>'source_note')) then
    raise exception 'Conflicting source observation; no import saved'; end if;
   insert into reconciliation_private.observations(sale_id,batch_id,employee_identifier,commission,customer_name,customer_phone,source_note)
    values(s.id,b.id,coalesce(r->>'employee_identifier',''),(r->>'commission')::numeric,r->>'customer_name',r->>'customer_phone',r->>'source_note');
   -- Adding new evidence after a decision invalidates the decision until reviewed.
   -- An overlapping exact observation does not invalidate an existing review.
   if s.decision<>'pending' and not exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id
     where o.sale_id=s.id and ib.kind=v_kind and ib.id<>b.id) then
    old:=to_jsonb(s);
    update reconciliation_private.sales set decision='pending',revision=revision+1,reason='New source evidence requires review' where id=s.id returning * into s;
    insert into reconciliation_private.audit(actor,action,subject_id,previous,next) values(auth.uid(),'new_evidence',s.id,old,to_jsonb(s));
   end if;
  end loop;
  insert into reconciliation_private.audit(actor,action,subject_id,next) values(auth.uid(),'import',b.id,jsonb_build_object('kind',v_kind,'rows',jsonb_array_length(payload->'rows')));
  return jsonb_build_object('batch_id',b.id,'repeat',false);
 elsif action='propose_mapping' then
  perform pg_advisory_xact_lock(724174,1);
  if payload - array['location_id','identifier','employee_id','start_date','end_date','reason'] <> '{}'::jsonb then raise exception 'Unexpected mapping fields'; end if;
  v_employee:=(payload->>'employee_id')::uuid; v_location:=(payload->>'location_id')::uuid;
  if not exists(select 1 from public.employees where id=v_employee and location_id=v_location) then raise exception 'Roster employee must belong to the selected site'; end if;
  insert into reconciliation_private.employee_mappings(location_id,identifier,employee_id,start_date,end_date,reason,actor)
   values(v_location,payload->>'identifier',v_employee,(payload->>'start_date')::date,(payload->>'end_date')::date,btrim(payload->>'reason'),auth.uid()) returning * into m;
  insert into reconciliation_private.audit(actor,action,subject_id,next) values(auth.uid(),'propose_mapping',m.id,to_jsonb(m));
  return to_jsonb(m);
 elsif action='decide_mapping' then
  perform pg_advisory_xact_lock(724174,1);
  if payload - array['id','revision','status','reason'] <> '{}'::jsonb or coalesce(payload->>'status','') not in ('approved','rejected') or length(btrim(coalesce(payload->>'reason',''))) not between 1 and 1000 then raise exception 'Invalid mapping decision'; end if;
  select * into strict m from reconciliation_private.employee_mappings where id=(payload->>'id')::bigint for update;
  if (payload->>'revision')::integer is distinct from m.revision then raise exception 'Mapping changed; reload'; end if;
  if payload->>'status'='approved' and exists(select 1 from reconciliation_private.employee_mappings x where x.id<>m.id and x.location_id=m.location_id and x.identifier=m.identifier and x.status='approved' and x.start_date<=m.end_date and x.end_date>=m.start_date) then raise exception 'Overlapping employee mapping; resolve before approval'; end if;
  old:=to_jsonb(m);
  update reconciliation_private.employee_mappings set status=payload->>'status',reason=btrim(payload->>'reason'),revision=revision+1 where id=m.id returning * into m;
  -- Revoke eligibility when an attribution approval is withdrawn. Keep the old
  -- decision in audit; no record can silently move commissions to another person.
  if old->>'status'='approved' and m.status<>'approved' then
   for s in select x.* from reconciliation_private.sales x where x.location_id=m.location_id and x.log_date between m.start_date and m.end_date and x.decision='eligible'
    and exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=x.id and ib.kind='original' and o.employee_identifier=m.identifier) for update loop
     update reconciliation_private.sales set decision='pending',reason='Employee mapping approval withdrawn',revision=revision+1 where id=s.id;
     insert into reconciliation_private.audit(actor,action,subject_id,previous,next) values(auth.uid(),'mapping_withdrawn',s.id,to_jsonb(s),jsonb_build_object('decision','pending'));
   end loop;
  end if;
  insert into reconciliation_private.audit(actor,action,subject_id,previous,next) values(auth.uid(),'decide_mapping',m.id,old,to_jsonb(m));
  return to_jsonb(m);
 elsif action='review_sale' then
  perform pg_advisory_xact_lock(724174,1);
  if payload - array['id','revision','decision','activity','identity_confirmed','reason'] <> '{}'::jsonb then raise exception 'Unexpected review fields'; end if;
  v_decision:=payload->>'decision'; v_activity:=payload->>'activity';
  if coalesce(v_decision,'') not in ('pending','eligible','excluded') or coalesce(v_activity,'') not in ('unknown','new','renewal','reactivation','replacement','refund','void') or length(btrim(coalesce(payload->>'reason',''))) not between 1 and 1000 then raise exception 'Review decision and reason required'; end if;
  select * into strict s from reconciliation_private.sales where id=(payload->>'id')::bigint for update;
  if (payload->>'revision')::integer is distinct from s.revision then raise exception 'Transaction changed; reload'; end if;
  if v_decision<>'pending' and (payload->>'identity_confirmed')::boolean is distinct from true then raise exception 'Confirm transaction identity before deciding'; end if;
  if v_decision='eligible' then
   if v_activity='unknown' or not exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=s.id and ib.kind='reviewed') then raise exception 'Reviewed commission evidence and activity classification required'; end if;
   select o.employee_identifier into v_identifier from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=s.id and ib.kind='original' limit 1;
   if v_identifier is null or v_identifier !~ '^\d{10}$' then raise exception 'Original full employee identifier required'; end if;
   if exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=s.id and ib.kind='reviewed' and o.employee_identifier<>v_identifier) then raise exception 'Reviewed identifier changed or shortened; exclusion evidence must not become eligible'; end if;
   select count(*) into v_count from reconciliation_private.employee_mappings x where x.location_id=s.location_id and x.identifier=v_identifier and x.status='approved' and s.log_date between x.start_date and x.end_date;
   if v_count<>1 then raise exception 'Exactly one approved employee mapping required'; end if;
   if v_activity in ('refund','void','replacement','renewal') then raise exception 'This activity cannot be marked commission eligible'; end if;
  end if;
  old:=to_jsonb(s);
  update reconciliation_private.sales set decision=v_decision,activity=v_activity,identity_confirmed=coalesce((payload->>'identity_confirmed')::boolean,false),reason=btrim(payload->>'reason'),revision=revision+1 where id=s.id returning * into s;
  insert into reconciliation_private.audit(actor,action,subject_id,previous,next) values(auth.uid(),'review_sale',s.id,old,to_jsonb(s));
  return to_jsonb(s);
 elsif action='customer_matches' then
  -- Search the private ledger across reporting windows. Matching names are only
  -- review leads; never employee identity or a commission decision.
  if payload - array['id'] <> '{}'::jsonb then raise exception 'Unexpected customer lookup fields'; end if;
  select * into strict s from reconciliation_private.sales where id=(payload->>'id')::bigint;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into result from (
   select distinct other.id,other.location_id,other.sale_id,other.log_date,other.activity,other.decision,
    exists(select 1 from reconciliation_private.observations a join reconciliation_private.observations z
     on regexp_replace(a.customer_phone,'[^0-9]','','g')=regexp_replace(z.customer_phone,'[^0-9]','','g')
     where a.sale_id=s.id and z.sale_id=other.id and length(regexp_replace(a.customer_phone,'[^0-9]','','g'))>=7) phone_match,
    exists(select 1 from reconciliation_private.observations a join reconciliation_private.observations z
     on lower(btrim(a.customer_name))=lower(btrim(z.customer_name))
     where a.sale_id=s.id and z.sale_id=other.id and btrim(a.customer_name)<>'') name_match
   from reconciliation_private.sales other where other.id<>s.id and exists(
    select 1 from reconciliation_private.observations a join reconciliation_private.observations z on
     (length(regexp_replace(a.customer_phone,'[^0-9]','','g'))>=7 and regexp_replace(a.customer_phone,'[^0-9]','','g')=regexp_replace(z.customer_phone,'[^0-9]','','g'))
     or (btrim(a.customer_name)<>'' and lower(btrim(a.customer_name))=lower(btrim(z.customer_name)))
    where a.sale_id=s.id and z.sale_id=other.id)
   order by other.log_date desc,other.id limit 101
  ) q;
  return jsonb_build_object('matches',result,'truncated',jsonb_array_length(result)>100);
 elsif action='read' then
  v_start:=(payload->>'start')::date; v_end:=(payload->>'end')::date;
  if v_start is null or v_end is null or v_end<v_start or v_end-v_start>92 then raise exception 'Select at most 93 days'; end if;
  if (select count(*) from reconciliation_private.sales where log_date between v_start and v_end)>5000 then raise exception 'Narrow the reporting period to 5,000 transactions'; end if;
  select jsonb_build_object(
   'sales',coalesce((select jsonb_agg(to_jsonb(q) order by q.log_date,q.id) from (
    select sr.*, e.id employee_id,e.name employee_name,
     exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=sr.id and ib.kind='original') has_original,
     exists(select 1 from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=sr.id and ib.kind='reviewed') has_reviewed,
     (select jsonb_agg(to_jsonb(o)||jsonb_build_object('kind',ib.kind)) from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=sr.id) observations
    from reconciliation_private.sales sr
    left join lateral (select o.employee_identifier from reconciliation_private.observations o join reconciliation_private.batches ib on ib.id=o.batch_id where o.sale_id=sr.id and ib.kind='original' order by o.id limit 1) origin on true
    left join reconciliation_private.employee_mappings em on em.location_id=sr.location_id and em.identifier=origin.employee_identifier and em.status='approved' and sr.log_date between em.start_date and em.end_date
    left join public.employees e on e.id=em.employee_id
    where sr.log_date between v_start and v_end
   ) q),'[]'::jsonb),
   'mappings',coalesce((select jsonb_agg(to_jsonb(em) order by em.id) from reconciliation_private.employee_mappings em where em.start_date<=v_end and em.end_date>=v_start),'[]'::jsonb),
   'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select au.id,au.actor,au.happened_at,au.action,au.subject_id,au.previous,au.next from reconciliation_private.audit au order by au.id desc limit 100) a),'[]'::jsonb)
  ) into result;
  return result;
 end if;
 raise exception 'Unknown reconciliation operation';
end $$;
revoke all on function reconciliation_private.api(text,jsonb) from public,anon,authenticated,service_role;
-- Exposed invoker wrapper; the private function performs current-account checks.
grant usage on schema reconciliation_private to authenticated;
grant execute on function reconciliation_private.api(text,jsonb) to authenticated;
create function public.drb_reconciliation(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select reconciliation_private.api(action,payload); $$;
revoke all on function public.drb_reconciliation(text,jsonb) from public,anon,service_role;
grant execute on function public.drb_reconciliation(text,jsonb) to authenticated;
comment on function public.drb_reconciliation(text,jsonb) is 'Private DRB review workflow; no reviewer grants at installation. No Daily Log or ranking writes.';
commit;
