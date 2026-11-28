begin;

create table membership_private.commission_reports (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  starts date not null,
  ends date not null check (ends - starts between 0 and 366),
  sha text not null check (sha ~ '^[0-9a-f]{64}$'),
  active_only boolean not null,
  actor uuid not null references auth.users(id),
  received_at timestamptz not null default now(),
  unique (location_id, starts, ends)
);

create table membership_private.commission_signups (
  report_id uuid not null references membership_private.commission_reports(id),
  username text not null,
  product text not null,
  quantity integer not null check (quantity between 1 and 999999),
  primary key (report_id, username, product)
);

alter table membership_private.commission_reports enable row level security;
alter table membership_private.commission_signups enable row level security;
revoke all on membership_private.commission_reports, membership_private.commission_signups from public, anon, authenticated, service_role;

-- Aggregate rows carry no sale dates. The same employee must own the username
-- continuously for the entire window, including adjacent alias continuations.
create function membership_private.commission_employee(loc uuid, user_key text, first_day date, last_day date)
returns uuid language sql stable set search_path='' as $$
  select case when count(distinct a.employee_id)=1
     and range_agg(daterange(a.starts,a.ends,'[]')) @> daterange(first_day,last_day,'[]')
   then (array_agg(a.employee_id))[1] end
  from membership_private.aliases a
  join public.employees e on e.id=a.employee_id and e.location_id=loc
  where a.location_id=loc and a.kind='username' and a.identifier=user_key
   and daterange(a.starts,a.ends,'[]') && daterange(first_day,last_day,'[]');
$$;

create function membership_private.commission_status(username text, product text)
returns text language sql immutable set search_path='' as $$
  select case
    when username ~ '^kiosk[123]?$' then 'kiosk'
    when lower(product) ~ '^employee([^[:alnum:]_]|$)' then 'employee-plan'
    when membership_private.tier('Micrologic',product) is null then 'unknown-product'
    else 'eligible' end;
$$;

create function public.pos_membership_commissions(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare loc uuid; first_day date; last_day date; checksum text; details jsonb; active_only boolean;
 existing membership_private.commission_reports; result jsonb; saved uuid;
begin
 if p_action is null or p_action not in ('preview','commit') or not reconciliation_private.allowed() then
  raise exception 'Authorized sales reviewer required' using errcode='42501';end if;
 loc:=membership_private.site('Micrologic',p_payload->>'site');
 first_day:=(p_payload->>'start')::date; last_day:=(p_payload->>'end')::date;
 checksum:=p_payload->>'sha'; details:=p_payload->'details'; active_only:=(p_payload->>'activeOnly')::boolean;
 if loc is null or first_day is null or last_day is null or last_day-first_day not between 0 and 366
   or coalesce(checksum,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(details) is distinct from 'array'
   or jsonb_typeof(p_payload->'activeOnly') is distinct from 'boolean'
   or p_payload-array['site','start','end','sha','details','activeOnly']<>'{}'::jsonb
   or pg_column_size(p_payload)>2000000
 then raise exception 'Invalid commission report scope';end if;

 if exists(select from jsonb_array_elements(details) x where jsonb_typeof(x) is distinct from 'object'
   or not x ?& array['username','product','quantity'] or x-array['username','product','quantity']<>'{}'::jsonb
   or jsonb_typeof(x->'username') is distinct from 'string' or x->>'username' !~ '^[[:alnum:]][[:alnum:]_. @-]{0,79}$'
   or x->>'username'<>lower(btrim(x->>'username'))
   or jsonb_typeof(x->'product') is distinct from 'string' or length(x->>'product')>150
   or jsonb_typeof(x->'quantity') is distinct from 'number' or x->>'quantity' !~ '^[1-9][0-9]{0,5}$')
   or exists(select from jsonb_array_elements(details) x group by x->>'username',x->>'product' having count(*)>1)
 then raise exception 'Invalid or duplicate commission detail';end if;

 if p_action='commit' then
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use read committed for commission imports'; end if;
  perform pg_advisory_xact_lock(761241,1);
  perform 1 from public.user_profiles where id=auth.uid() for share;
  perform 1 from reconciliation_private.reviewers where user_id=auth.uid() for share;
  if not reconciliation_private.allowed() then raise exception 'Reviewer access changed' using errcode='42501';end if;
 end if;
 select * into existing from membership_private.commission_reports r where r.location_id=loc
  and daterange(r.starts,r.ends,'[]') && daterange(first_day,last_day,'[]') order by r.starts limit 1;
 if existing.id is not null and (existing.starts<>first_day or existing.ends<>last_day or existing.sha<>checksum) then
  raise exception 'Commission scope overlaps a saved report (% through %). Use a nonoverlapping period.',existing.starts,existing.ends;
 end if;
 if existing.id is not null and (existing.active_only is distinct from active_only or
   (select coalesce(jsonb_agg(to_jsonb(d)-'report_id' order by d.username,d.product),'[]')
    from membership_private.commission_signups d where d.report_id=existing.id)
   is distinct from (select coalesce(jsonb_agg(x order by x->>'username',x->>'product'),'[]') from jsonb_array_elements(details) x))
 then raise exception 'Same workbook checksum has different commission details';end if;

 select coalesce(jsonb_agg(to_jsonb(q) order by q.username),'[]') into result from (
  select d.username,sum(d.quantity) reported,
   coalesce(sum(d.quantity) filter(where status='eligible'),0) eligible,
   coalesce(sum(d.quantity) filter(where status='eligible' and employee is not null),0) credited,
   coalesce(sum(d.quantity) filter(where status='unknown-product'),0) unknown_product,
   coalesce(sum(d.quantity) filter(where status in ('employee-plan','kiosk')),0) excluded
  from jsonb_to_recordset(details) d(username text,product text,quantity integer)
  cross join lateral (select membership_private.commission_status(d.username,d.product) status,
   membership_private.commission_employee(loc,d.username,first_day,last_day) employee) f
  group by d.username
 ) q;

 if p_action='commit' and existing.id is null then
  insert into membership_private.commission_reports(location_id,starts,ends,sha,active_only,actor)
   values(loc,first_day,last_day,checksum,active_only,auth.uid()) returning id into saved;
  insert into membership_private.commission_signups(report_id,username,product,quantity)
   select saved,d.* from jsonb_to_recordset(details) d(username text,product text,quantity integer);
 end if;
 return jsonb_build_object('repeat',existing.id is not null,'report',coalesce(existing.id,saved),'users',result);
end;
$$;
revoke all on function membership_private.commission_employee(uuid,text,date,date),
 membership_private.commission_status(text,text),public.pos_membership_commissions(text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.pos_membership_commissions(text,jsonb) to authenticated;

create or replace function public.pos_membership_report(p_sites uuid[],p_start date,p_end date)
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
 ), scopes as (
  select r.*, r.starts>=p_start and r.ends<=p_end as included
  from membership_private.commission_reports r where r.location_id=any(p_sites)
   and r.starts<=p_end and r.ends>=p_start
 ), commission as (
  select r.id,r.location_id,r.starts,r.ends,r.included,d.username,d.quantity,
    membership_private.tier('Micrologic',d.product) tier,
    membership_private.commission_status(d.username,d.product) status,
    membership_private.commission_employee(r.location_id,d.username,r.starts,r.ends) employee_id
  from scopes r join membership_private.commission_signups d on d.report_id=r.id
 ), detailed_people as (
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
    and not exists(select from commission c where v.system='Micrologic' and c.included
      and c.location_id=v.location_id and v.business_date between c.starts and c.ends
      and c.status='eligible' and c.employee_id is not null
      and (c.employee_id=v.employee_id or c.username=lower(btrim(v.source->>'greeter'))))
  group by location_id,employee_id
 ), commission_people as (
  select c.location_id,c.employee_id,min(e.name) name,sum(quantity) credited,
    coalesce(sum(quantity) filter(where tier in ('better','best')),0) premium,
    coalesce(sum(quantity) filter(where tier in ('basic','good','better','best')),0) tiered,
    0 unknown
  from commission c join public.employees e on e.id=c.employee_id
  where c.included and c.status='eligible'
  group by c.location_id,c.employee_id
 ), people as (
  select location_id,employee_id,min(name) name,sum(credited) credited,sum(premium) premium,sum(tiered) tiered,sum(unknown) unknown
  from (select * from detailed_people union all select * from commission_people) combined
  group by location_id,employee_id
 ), dates as (
  select distinct loc, p_start+i as day_date from unnest(p_sites) loc cross join generate_series(0,p_end-p_start) i
 ), comparison as (
  select d.loc,d.day_date,
   (r.document#>>'{metrics,memberships}')::int gsr,
   (select aggregate.eligible_total from scopes s cross join lateral (select coalesce(sum(c.quantity),0) eligible_total
   from commission c where c.id=s.id) aggregate where s.location_id=d.loc and s.starts=d.day_date and s.ends=d.day_date) as commission_daily_observed,
   exists(select from scopes s where s.location_id=d.loc and d.day_date between s.starts and s.ends
      and (s.starts<>s.ends or s.active_only or exists(select from commission c where c.id=s.id
        and (c.status='unknown-product' or (c.status='eligible' and c.employee_id is null)))))
      as commission_provisional,
   (select count(*) from latest e where e.location_id=d.loc and e.business_date=d.day_date
    and e.source->>'activity'='new') observed,
   (select count(*) from latest e where e.location_id=d.loc and e.business_date=d.day_date
    and (e.attribution in ('unmatched','ambiguous','name-conflict') or e.source->>'activity'='unresolved')) unresolved,
   exists(select 1 from membership_private.batches b where d.day_date between b.starts and b.ends and exists(
    select 1 from membership_private.observations o join membership_private.events e on e.id=o.event_id
    where o.batch_id=b.id and e.location_id=d.loc
   )) or exists(select from scopes s where s.included and s.location_id=d.loc and d.day_date between s.starts and s.ends) imported
  from dates d left join pos_import_private.current_records c on (c.location_id,c.business_date)=(d.loc,d.day_date)
  left join pos_import_private.revisions r on (r.location_id,r.business_date,r.revision)=(c.location_id,c.business_date,c.revision)
 )
 select jsonb_build_object('people',coalesce((select jsonb_agg(to_jsonb(p)) from people p),'[]'),
 'coverage',coalesce((select jsonb_agg(to_jsonb(c) order by c.day_date,c.loc) from comparison c),'[]'),
 'commissionScopes',coalesce((select jsonb_agg(to_jsonb(t) order by t.starts,t.location_id) from (
   select s.location_id,s.starts,s.ends,s.included,s.active_only,
    (select coalesce(sum(c.quantity),0) from commission c where c.id=s.id) reported,
    (select coalesce(sum(c.quantity),0) from commission c where c.id=s.id
      and (c.status='unknown-product' or (c.status='eligible' and c.employee_id is null))) unresolved
   from scopes s) t),'[]')));
end;
$$;

commit;
