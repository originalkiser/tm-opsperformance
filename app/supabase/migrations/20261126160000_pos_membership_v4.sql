begin;
set local lock_timeout='3s';
create schema membership_private;
revoke all on schema membership_private from public,anon,authenticated,service_role;
create table membership_private.aliases (
 id bigint generated always as identity primary key,
 location_id uuid not null references public.locations(id),
 employee_id uuid not null references public.employees(id),
 kind text not null check(kind in ('username','adp')),
 identifier text not null,
 legal_name text,
 starts date not null,
 ends date,
 actor uuid not null,
 created_at timestamptz not null default now(),
 check(ends is null or ends>=starts)
);
create index membership_alias_lookup on membership_private.aliases(location_id,kind,identifier,starts);
-- Update an actual row while holding the advisory lock so transactions using
-- an older repeatable-read snapshot cannot insert overlapping aliases.
create table membership_private.alias_write_locks (
 location_id uuid primary key references public.locations(id),
 generation bigint not null default 1
);
create table membership_private.batches (
 id uuid primary key default gen_random_uuid(),
 system text not null check(system in ('DRB','Micrologic')),
 sha text not null check(sha ~ '^[0-9a-f]{64}$'),
 parser text not null default 'membership-v4.0.0',
 starts date not null, ends date not null check(ends>=starts),
 actor uuid not null, reason text, externally_validated boolean not null, created_at timestamptz not null default now()
);
create index membership_batch_sha on membership_private.batches(system,sha);
create table membership_private.events (
 id bigint generated always as identity primary key,
 system text not null,
 location_id uuid not null references public.locations(id),
 ticket text not null,
 unique(system,location_id,ticket)
);
create table membership_private.revisions (
 event_id bigint not null references membership_private.events(id),
 revision int not null check(revision>0),
 batch_id uuid not null references membership_private.batches(id),
 business_date date not null,
 source jsonb not null,
 employee_id uuid references public.employees(id),
 employee_name text,
 alias_id bigint references membership_private.aliases(id),
 attribution text not null,
 reason text,
 primary key(event_id,revision)
);
create index membership_revision_day on membership_private.revisions(business_date,event_id);
create table membership_private.observations (
 batch_id uuid not null references membership_private.batches(id),
 event_id bigint not null,
 revision int not null,
 primary key(batch_id,event_id),
 foreign key(event_id,revision) references membership_private.revisions(event_id,revision)
);
create table membership_private.snapshots (
 batch_id uuid not null references membership_private.batches(id),
 location_id uuid not null references public.locations(id),
 business_date date not null,
 activity text not null check(activity in ('cancel','decline')),
 product text not null,
 quantity int not null check(quantity>0),
 primary key(batch_id,location_id,business_date,activity,product)
);
create table membership_private.alias_audit (
 id bigint generated always as identity primary key,
 alias_id bigint not null references membership_private.aliases(id),
 actor uuid not null, action text not null, reason text not null,
 happened_at timestamptz not null default now(), details jsonb not null
);
alter table membership_private.aliases enable row level security;
alter table membership_private.alias_write_locks enable row level security;
alter table membership_private.batches enable row level security;
alter table membership_private.events enable row level security;
alter table membership_private.revisions enable row level security;
alter table membership_private.observations enable row level security;
alter table membership_private.snapshots enable row level security;
alter table membership_private.alias_audit enable row level security;
revoke all on all tables in schema membership_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema membership_private from public,anon,authenticated,service_role;

create function membership_private.name_key(value text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(coalesce(value,'')), '[[:punct:][:space:]]+', '', 'g');
$$;
create function membership_private.site(system text, code text) returns uuid language sql stable set search_path='' as $$
 select id from public.locations where split_part(site_code,'-',1)=code and exclude_from_reporting is not true
  and case system when 'DRB' then code in ('1508','1511','1516','1518','1519','1520','1521','1522','1524','1525','1526','1527','1530')
     when 'Micrologic' then code in ('1512','1515','1517','1528','1529','1531','1532') else false end;
$$;
create function membership_private.tier(system text,product text) returns text
language sql immutable set search_path='' as $$
 select case system when 'DRB' then case lower(btrim(product))
    when 'unl police special' then 'non-tier' when 'unl. military sld' then 'best'
    else substring(lower(btrim(product)) from '^unl\. (basic|good|better|best)(?: w\$| int)? sld$') end
  when 'Micrologic' then case lower(btrim(product))
    when 'zbetter blue vet unlimited bogo' then 'best' when 'employee best uwc' then 'best'
    else substring(lower(btrim(product)) from '^(basic|good|better|best)(?: wash unlimited(?: sign up(?: -promo)?)?| - rinsed - 50% off 3 months updated)$') end
  end;
$$;
create function membership_private.drb_activity(identifier text) returns text
language sql immutable set search_path='' as $$
 select case when length(identifier)<=32 and identifier ~ '^(?:[0-9]+|\([0-9]{2,4}\)[ .-]*[0-9]+)(?:[ .-]+[0-9]+)*$'
  then case length(regexp_replace(identifier,'[^0-9]','','g'))
    when 9 then 'new' when 10 then 'new' when 4 then 'regular' else 'unresolved' end
  else 'unresolved' end;
$$;
-- Reused for attribution and report-time credit. Commission and client eligibility are absent.
create function membership_private.credit_block(system text,item jsonb) returns text
language sql immutable set search_path='' as $$
 select case
  when item->>'activity' is distinct from 'new' then 'no-credit'
  when system='DRB' then case when membership_private.drb_activity(item->>'identifier')<>'new' then 'no-credit'
    when membership_private.name_key(item->>'legalName')='' then 'name-conflict' end
  when system='Micrologic' then case
    when lower(btrim(item->>'product')) ~ '^employee([^[:alnum:]_]|$)' then 'employee-plan'
    when coalesce(btrim(item->>'greeter'),'')='' then 'blank'
    when lower(btrim(item->>'greeter')) ~ '^kiosk[123]?$' then 'kiosk' end
  else 'no-credit' end;
$$;
create function membership_private.resolve(system text, loc uuid, day_date date, item jsonb)
returns table(employee uuid, employee_name text, alias bigint, status text)
language plpgsql stable set search_path='' as $$
declare ident text; kind_key text; matches int; exact_match boolean;
begin
  status:=membership_private.credit_block(system,item);
  if status is not null then return next; return; end if;
  if system='Micrologic' then
    ident:=lower(btrim(item->>'greeter'));
    kind_key:='username';
  else
    ident:=regexp_replace(item->>'identifier','[^0-9]','','g');
    kind_key:='adp';
  end if;
  exact_match:=exists(select 1 from membership_private.aliases a where a.location_id=loc and a.kind=kind_key and
    a.identifier=ident and a.starts<=day_date and (a.ends is null or a.ends>=day_date));
  select count(*) into matches from membership_private.aliases a
  where a.location_id=loc and a.kind=kind_key and a.starts<=day_date and (a.ends is null or a.ends>=day_date)
    and (a.identifier=ident or (kind_key='adp' and not exact_match and ltrim(a.identifier,'0')=ltrim(ident,'0')));
  if matches<>1 then status:=case when matches=0 then 'unmatched' else 'ambiguous' end;
  else
    select a.employee_id,e.name,a.id,case when kind_key='adp' and
      (membership_private.name_key(item->>'legalName')='' or membership_private.name_key(item->>'legalName')<>membership_private.name_key(a.legal_name))
      then 'name-conflict' else 'matched' end into employee,employee_name,alias,status
    from membership_private.aliases a join public.employees e on e.id=a.employee_id
    where a.location_id=loc and a.kind=kind_key and a.starts<=day_date and (a.ends is null or a.ends>=day_date)
     and (a.identifier=ident or (kind_key='adp' and not exact_match and ltrim(a.identifier,'0')=ltrim(ident,'0')));
    if status<>'matched' then employee:=null;employee_name:=null;alias:=null;end if;
  end if;
  return next;
end;
$$;

create function public.pos_membership_aliases(p_location uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare is_admin boolean; kind_key text; ident text; legal text; emp uuid; begin_date date; end_date date; entry membership_private.aliases;
begin
 if public.can_propose_employee_mapping(p_location) is distinct from true then raise exception 'Location access required' using errcode='42501'; end if;
 select role='admin' and is_active is true and deleted_at is null into is_admin from public.user_profiles where id=auth.uid();
 if p_action='read' then
  return (select coalesce(jsonb_agg(to_jsonb(a) - 'actor' order by a.starts desc,a.id desc),'[]') from membership_private.aliases a
   where a.location_id=p_location and (a.kind='username' or is_admin));
 end if;
 perform pg_advisory_xact_lock(761241,1);
 -- Pin the profile and any delegated assignment, then recheck under the write lock.
 select role='admin' and is_active is true and deleted_at is null into is_admin
   from public.user_profiles where id=auth.uid() for share;
 perform 1 from public.manager_locations where manager_id=auth.uid() and location_id=p_location for share;
 if public.can_propose_employee_mapping(p_location) is distinct from true then
   raise exception 'Location access required' using errcode='42501'; end if;
 if p_action not in ('add','close') or p_action is null then raise exception 'Invalid alias action';end if;
 insert into membership_private.alias_write_locks as l(location_id) values(p_location)
 on conflict(location_id) do update set generation=l.generation+1;
 if p_action='close' then
  end_date:=(p_payload->>'ends')::date;
  select * into strict entry from membership_private.aliases where location_id=p_location and id=(p_payload->>'id')::bigint for update;
  if (entry.kind='adp' and is_admin is distinct from true) or entry.ends is not null or end_date is null or end_date<entry.starts
   or exists(select 1 from membership_private.revisions where alias_id=entry.id and business_date>end_date)
   or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'Alias end date or permission is invalid.'; end if;
  update membership_private.aliases set ends=end_date where id=entry.id;
  insert into membership_private.alias_audit(alias_id,actor,action,reason,details)
   values(entry.id,auth.uid(),'close',p_payload->>'reason',jsonb_build_object('end',end_date));
  return jsonb_build_object('id',entry.id);
 end if;
 kind_key:=p_payload->>'kind'; ident:=lower(btrim(p_payload->>'identifier')); legal:=nullif(btrim(p_payload->>'legalName'),'');
 emp:=(p_payload->>'employee')::uuid; begin_date:=(p_payload->>'starts')::date; end_date:=(p_payload->>'ends')::date;
 if kind_key is null or kind_key not in ('username','adp') or begin_date is null or (end_date is not null and end_date<begin_date)
  or (kind_key='adp' and (is_admin is distinct from true or coalesce(ident,'') !~ '^[0-9]{9,10}$' or legal is null or length(legal)>150))
  or (kind_key='username' and (coalesce(ident,'') !~ '^[[:alnum:]][[:alnum:]_. @-]{0,79}$' or ident ~ '^kiosk[123]?$'))
  or nullif(btrim(p_payload->>'reason'),'') is null
  or not exists(select 1 from public.employees where id=emp and location_id=p_location)
 then raise exception 'Invalid employee alias or location permissions.'; end if;
 perform 1 from public.employees where id=emp and location_id=p_location for share;
 if not found then raise exception 'Employee location changed. Reload the roster.';end if;
 if exists(select 1 from membership_private.aliases where location_id=p_location and kind=kind_key
   and (identifier=ident or kind_key='adp' and ltrim(identifier,'0')=ltrim(ident,'0'))
   and daterange(starts,ends,'[]') && daterange(begin_date,end_date,'[]'))
   then raise exception 'Alias overlaps an existing mapping for this location.'; end if;
 insert into membership_private.aliases(location_id,employee_id,kind,identifier,legal_name,starts,ends,actor)
 values(p_location,emp,kind_key,ident,case when kind_key='adp' then legal end,begin_date,end_date,auth.uid()) returning * into entry;
 insert into membership_private.alias_audit(alias_id,actor,action,reason,details)
 values(entry.id,auth.uid(),'add',p_payload->>'reason',to_jsonb(entry));
 return jsonb_build_object('id',entry.id);
end;
$$;

create function public.pos_membership_import(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare system_code text; workbook_sha text; first_day date; last_day date; reason text; batch uuid; item jsonb; fact jsonb;
 loc uuid; day_date date; event bigint; prev membership_private.revisions; attr record; results jsonb:='[]'; action text; rev int; snapshot jsonb;
 snapshot_results jsonb:='[]'; earlier_batch uuid; earlier_count int;
begin
 if not reconciliation_private.allowed() then raise exception 'Authorized sales reviewer required' using errcode='42501';end if;
 if p_action='status' then return '{"reviewer":true}'::jsonb; end if;
 if p_action='queue' then
  return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
    select e.system,e.ticket,l.site_code,r.business_date,r.source->>'greeter' greeter,r.attribution,1 as quantity
    from membership_private.events e join lateral (select * from membership_private.revisions where event_id=e.id order by revision desc limit 1) r on true
    join public.locations l on l.id=e.location_id where r.attribution in ('unmatched','ambiguous','name-conflict')
    order by r.business_date desc,e.id limit 250
  ) q);
 end if;
 if coalesce(p_action,'') not in ('preview','commit') then raise exception 'Invalid import action';end if;
 if p_action='commit' then
   perform 1 from public.user_profiles where id=auth.uid() for share;
   perform 1 from reconciliation_private.reviewers where user_id=auth.uid() for share;
   if not reconciliation_private.allowed() then raise exception 'Reviewer access changed' using errcode='42501';end if;
 end if;
 system_code:=p_payload->>'system'; workbook_sha:=p_payload->>'sha'; first_day:=(p_payload->>'start')::date; last_day:=(p_payload->>'end')::date;
 reason:=nullif(btrim(p_payload->>'reason'),'');
 if coalesce(system_code,'') not in ('DRB','Micrologic') or coalesce(workbook_sha,'') !~ '^[0-9a-f]{64}$'
   or first_day is null or last_day is null or last_day<first_day or last_day-first_day>92
   or jsonb_typeof(p_payload->'events') is distinct from 'array' or jsonb_typeof(p_payload->'snapshots') is distinct from 'array'
   or (system_code='DRB' and p_payload->'externallyValidated' is distinct from 'true'::jsonb)
   or coalesce(length(reason),0)>500 or pg_column_size(p_payload)>5000000
   or p_payload - array['system','sha','start','end','events','snapshots','externallyValidated','reason'] <> '{}'::jsonb then raise exception 'Invalid workbook scope';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'events') x group by x->>'site',x->>'ticket' having count(*)>1)
  then raise exception 'Duplicate workbook ticket';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'snapshots') x
    group by x->>'site',x->>'date',x->>'activity',x->>'product' having count(*)>1)
 then raise exception 'Duplicate activity snapshot group';end if;
 perform pg_advisory_xact_lock(761241,1);
 if p_action='commit' then
   if exists(select 1 from membership_private.batches b where b.system=system_code and b.sha=workbook_sha and b.starts=first_day and b.ends=last_day)
     and reason is null then return '{"repeat":true}'::jsonb; end if;
   insert into membership_private.batches(system,sha,starts,ends,actor,reason,externally_validated)
    values(system_code,workbook_sha,first_day,last_day,auth.uid(),reason,system_code='DRB') returning id into batch;
 end if;
 for item in select value from jsonb_array_elements(p_payload->'events') loop
  loc:=membership_private.site(system_code,item->>'site');day_date:=(item->>'date')::date;
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['site','date','ticket','product','tier','activity']
   or exists(select 1 from jsonb_each(item) f where f.key in ('site','date','ticket','product','tier','activity','greeter','cashier','identifier','legalName')
     and jsonb_typeof(f.value) not in ('string','null'))
   or loc is null or day_date is null or day_date not between first_day and last_day or coalesce(item->>'ticket','') !~ '^[A-Za-z0-9-]{1,30}$'
   or (system_code='DRB' and item->>'ticket' !~ '^[0-9]{1,30}$')
   or coalesce(length(item->>'product'),0) not between 1 and 150
   or coalesce(length(item->>'legalName'),0)>150 or (item->>'cashier' is not null and btrim(item->>'cashier') !~ '^[[:alnum:]_. @-]{0,80}$')
   or (item->>'greeter' is not null and btrim(item->>'greeter') !~ '^[[:alnum:]_. @-]{0,80}$')
   or item - array['site','date','ticket','product','tier','activity','identifier','legalName','commission','greeter','cashier','eligible','expectedRevision'] <> '{}'::jsonb
   or (item->>'commission' is not null and (jsonb_typeof(item->'commission') <> 'number'
     or item->>'commission' !~ '^-?[0-9]{1,12}$'))
   or membership_private.tier(system_code,item->>'product') is null
   or item->>'tier' is distinct from membership_private.tier(system_code,item->>'product')
   or (system_code='Micrologic' and (coalesce(item->>'activity','') not in ('new','regular','grace') or item->>'identifier' is not null
     or item->>'legalName' is not null or item->>'commission' is not null))
   or (system_code='DRB' and (item->>'greeter' is not null or item->>'cashier' is not null or
     (item->>'identifier' is not null and (length(item->>'identifier')>32 or
       item->>'identifier' !~ '^(?:[0-9]+|\([0-9]{2,4}\)[ .-]*[0-9]+)(?:[ .-]+[0-9]+)*$'))
     or item->>'activity' is distinct from membership_private.drb_activity(item->>'identifier')
     or (item->>'activity'<>'new' and item->>'legalName' is not null)))
   then raise exception 'Invalid sanitized membership event';end if;
  fact:=item-array['expectedRevision','eligible'];
  select id into event from membership_private.events where system=system_code and location_id=loc and ticket=item->>'ticket';
  select * into prev from membership_private.revisions where event_id=event order by revision desc limit 1;
  select * into attr from membership_private.resolve(system_code,loc,day_date,fact);
  -- A repeated observation preserves its original employee snapshot unless a reviewer explicitly corrects it.
  action:=case when prev.revision is null then 'new' when prev.source<>fact then 'correction'
    when prev.employee_id is null and attr.employee is not null then 'attribution' else 'duplicate' end;
  results:=results||jsonb_build_array(jsonb_build_object('site',item->>'site','ticket',item->>'ticket','action',action,
    'expectedRevision',coalesce(prev.revision,0),'attribution',case when action='duplicate' then prev.attribution else attr.status end));
  if p_action='commit' then
   if (item->>'expectedRevision')::int is distinct from coalesce(prev.revision,0) then raise exception 'Membership revision changed. Preview again.';end if;
   if action in ('correction','attribution') and reason is null then raise exception 'An explicit correction reason is required.';end if;
   if event is null then insert into membership_private.events(system,location_id,ticket) values(system_code,loc,item->>'ticket') returning id into event;end if;
   rev:=coalesce(prev.revision,0);
   if action<>'duplicate' then
    rev:=rev+1;
    insert into membership_private.revisions values(event,rev,batch,day_date,fact,attr.employee,attr.employee_name,attr.alias,attr.status,reason);
   end if;
   insert into membership_private.observations values(batch,event,rev);
  end if;
 end loop;
 for snapshot in select value from jsonb_array_elements(p_payload->'snapshots') loop
  loc:=membership_private.site(system_code,snapshot->>'site');day_date:=(snapshot->>'date')::date;
  if system_code<>'Micrologic' or loc is null or day_date is null or day_date not between first_day and last_day
    or coalesce(snapshot->>'activity','') not in ('cancel','decline') or coalesce(length(snapshot->>'product'),0) not between 1 and 150
    or (membership_private.tier('Micrologic',snapshot->>'product') is null and lower(btrim(snapshot->>'product')) not in (
       'best - rinsed - 25% off 3 months','best wash unlimited - mo','better - rinsed - 25% off 3 months',
       'better wash 50% off unlimited - rinsed','fam better wash unlimited 22','military & veteran',
       'zbest unlimited','zbest unlimited promo','zbetter blue vet unlimited'))
    or coalesce(snapshot->>'count','') !~ '^[1-9][0-9]{0,5}$'
    or snapshot-array['site','date','activity','product','count','expectedBatch'] <> '{}'::jsonb
    then raise exception 'Invalid membership activity snapshot'; end if;
  select s.batch_id,s.quantity into earlier_batch,earlier_count
   from membership_private.snapshots s join membership_private.batches b on b.id=s.batch_id
   where s.location_id=loc and s.business_date=day_date and s.activity=snapshot->>'activity'
    and s.product=snapshot->>'product' and s.batch_id is distinct from batch
   order by b.created_at desc,b.id desc limit 1;
  snapshot_results:=snapshot_results||jsonb_build_array(jsonb_build_object(
    'site',snapshot->>'site','date',day_date,'activity',snapshot->>'activity','product',snapshot->>'product',
    'expectedBatch',earlier_batch,'previousQuantity',earlier_count,'quantity',(snapshot->>'count')::int,
    'correction',earlier_batch is not null and earlier_count<>(snapshot->>'count')::int));
  if p_action='commit' then
   if (snapshot->>'expectedBatch')::uuid is distinct from earlier_batch then raise exception 'Activity snapshot changed. Preview again.';end if;
   if earlier_batch is not null and earlier_count<>(snapshot->>'count')::int and reason is null
     then raise exception 'An explicit snapshot correction reason is required.';end if;
   insert into membership_private.snapshots values(batch,loc,day_date,snapshot->>'activity',snapshot->>'product',(snapshot->>'count')::int);
  end if;
 end loop;
 return jsonb_build_object('batch',batch,'rows',results,'snapshots',snapshot_results);
end;
$$;

create function public.pos_membership_report(p_sites uuid[],p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_start is null or p_end is null or p_end-p_start not between 0 and 366 or coalesce(cardinality(p_sites),0)>100
   then raise exception 'Invalid membership report range';end if;
 if not exists(select 1 from public.user_profiles where id=auth.uid() and role in ('admin','store') and is_active and deleted_at is null)
   or exists(select 1 from unnest(p_sites) s where not public.can_propose_employee_mapping(s))
   then raise exception 'Location access required' using errcode='42501';end if;
 return (with latest as (
  select e.location_id,e.system,r.* from membership_private.events e
  join lateral (select * from membership_private.revisions where event_id=e.id order by revision desc limit 1) r on true
  where e.location_id=any(p_sites) and r.business_date between p_start and p_end
 ), people as (
  select location_id,employee_id,min(employee_name) name,count(*) credited,
   count(*) filter(where source->>'tier' in ('better','best')) premium,
   count(*) filter(where source->>'tier' in ('basic','good','better','best')) tiered,
   count(*) filter(where source->>'tier' is null) unknown
  from latest v
  where v.employee_id is not null and v.attribution='matched'
    and membership_private.credit_block(v.system,v.source) is null
    and exists(select 1 from membership_private.aliases a where a.id=v.alias_id and a.employee_id=v.employee_id
      and a.location_id=v.location_id and v.business_date between a.starts and coalesce(a.ends,'infinity'::date)
      and (v.system='Micrologic' and a.kind='username' and a.identifier=lower(btrim(v.source->>'greeter'))
        or v.system='DRB' and a.kind='adp' and membership_private.name_key(a.legal_name)=membership_private.name_key(v.source->>'legalName')
          and ltrim(a.identifier,'0')=ltrim(regexp_replace(v.source->>'identifier','[^0-9]','','g'),'0')
          and exists(select 1 from membership_private.batches b where b.id=v.batch_id and b.externally_validated)))
  group by location_id,employee_id
 ), dates as (
  select distinct loc, p_start+i as day_date from unnest(p_sites) loc cross join generate_series(0,p_end-p_start) i
 ), comparison as (
  select d.loc,d.day_date,
   (r.document#>>'{metrics,memberships}')::int gsr,
   (select count(*) from latest e where e.location_id=d.loc and e.business_date=d.day_date
    and e.source->>'activity'='new') observed,
   (select count(*) from latest e where e.location_id=d.loc and e.business_date=d.day_date
    and (e.attribution in ('unmatched','ambiguous','name-conflict') or e.source->>'activity'='unresolved')) unresolved,
   exists(select 1 from membership_private.batches b where d.day_date between b.starts and b.ends and exists(
    select 1 from membership_private.observations o join membership_private.events e on e.id=o.event_id
    where o.batch_id=b.id and e.location_id=d.loc
   )) imported
  from dates d left join pos_import_private.current_records c on (c.location_id,c.business_date)=(d.loc,d.day_date)
  left join pos_import_private.revisions r on (r.location_id,r.business_date,r.revision)=(c.location_id,c.business_date,c.revision)
 )
 select jsonb_build_object('people',coalesce((select jsonb_agg(to_jsonb(p)) from people p),'[]'),
 'coverage',coalesce((select jsonb_agg(to_jsonb(c) order by c.day_date,c.loc) from comparison c),'[]')));
end;
$$;
revoke all on all functions in schema membership_private from public,anon,authenticated,service_role;
revoke all on function public.pos_membership_aliases(uuid,text,jsonb),public.pos_membership_import(text,jsonb),
 public.pos_membership_report(uuid[],date,date) from public,anon,authenticated,service_role;
grant execute on function public.pos_membership_aliases(uuid,text,jsonb),public.pos_membership_import(text,jsonb),
 public.pos_membership_report(uuid[],date,date) to authenticated;
commit;
