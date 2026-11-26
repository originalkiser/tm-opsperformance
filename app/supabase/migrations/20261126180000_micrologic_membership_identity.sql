begin;
set local lock_timeout='3s';
-- Keep event IDs and all references intact. Only the verified generic
-- Micrologic placeholder needs a business-date identity discriminator.
alter table membership_private.events add column identity_date date;
do $guard$
begin
 if exists(
  select 1 from membership_private.events e left join membership_private.revisions r on r.event_id=e.id
  where e.system='Micrologic' and lower(e.ticket)='wasignup'
  group by e.id having count(distinct r.business_date)<>1
 ) then raise exception 'Cannot safely date an existing Micrologic WASignup history.';end if;
end
$guard$;
update membership_private.events e set identity_date=r.day_date
from (select event_id,min(business_date) day_date from membership_private.revisions group by event_id) r
where r.event_id=e.id and e.system='Micrologic' and lower(e.ticket)='wasignup';
alter table membership_private.events
 drop constraint events_system_location_id_ticket_key,
 add constraint events_identity_date_kind check ((identity_date is not null)=(system='Micrologic' and lower(ticket)='wasignup'));
create unique index membership_standard_ticket_key on membership_private.events(system,location_id,ticket) where identity_date is null;
create unique index membership_micrologic_generic_ticket_key on membership_private.events(location_id,identity_date)
 where system='Micrologic' and lower(ticket)='wasignup';

create or replace function public.pos_membership_import(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare system_code text; workbook_sha text; first_day date; last_day date; reason text; batch uuid; item jsonb; fact jsonb;
 loc uuid; day_date date; event bigint; prev membership_private.revisions; attr record; results jsonb:='[]'; action text; rev int; snapshot jsonb;
 snapshot_results jsonb:='[]'; earlier_batch uuid; earlier_count int; collision record; event_day date;
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
 select x->>'site' as site,
   case when system_code='Micrologic' and lower(x->>'ticket')='wasignup' then lower(x->>'ticket') else x->>'ticket' end as ticket,
   string_agg(format('%s (%s)',x->>'date',x->>'activity'),', ' order by x->>'date',x->>'activity') as rows
 into collision
 from jsonb_array_elements(p_payload->'events') x
 group by 1,2,case when system_code='Micrologic' and lower(x->>'ticket')='wasignup' then x->>'date' end
 having count(*)>1 limit 1;
 if found then raise exception 'Duplicate membership ticket conflict at location %, ticket %: %. Review the source before saving.',
   collision.site,collision.ticket,collision.rows;end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'snapshots') x
    group by x->>'site',x->>'date',x->>'activity',x->>'product' having count(*)>1)
 then raise exception 'Duplicate activity snapshot group';end if;
 perform pg_advisory_xact_lock(761241,1);
 if p_action='commit' then
   if exists(select 1 from membership_private.batches b where b.system=system_code and b.sha=workbook_sha and b.starts=first_day and b.ends=last_day)
     and reason is null then return '{"repeat":true}'::jsonb; end if;
   insert into membership_private.batches(system,sha,starts,ends,actor,reason,externally_validated,parser)
    values(system_code,workbook_sha,first_day,last_day,auth.uid(),reason,system_code='DRB',
      case when system_code='Micrologic' then 'membership-v4.1.0' else 'membership-v4.0.0' end) returning id into batch;
 end if;
 for item in select value from jsonb_array_elements(p_payload->'events') loop
  loc:=membership_private.site(system_code,item->>'site');day_date:=(item->>'date')::date;
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['site','date','ticket','product','tier','activity']
   or exists(select 1 from jsonb_each(item) f where f.key in ('site','date','ticket','product','tier','activity','greeter','cashier','identifier','legalName')
     and jsonb_typeof(f.value) not in ('string','null'))
   or loc is null or day_date is null or day_date not between first_day and last_day or coalesce(item->>'ticket','') !~ '^[A-Za-z0-9-]{1,30}$'
   or (system_code='DRB' and item->>'ticket' !~ '^[0-9]{1,30}$')
   or item->>'product' is null or length(item->>'product')>150
   or (item->>'product'='' and not (system_code='Micrologic' and item->>'activity'='regular'))
   or coalesce(length(item->>'legalName'),0)>150 or (item->>'cashier' is not null and btrim(item->>'cashier') !~ '^[[:alnum:]_. @-]{0,80}$')
   or (item->>'greeter' is not null and btrim(item->>'greeter') !~ '^[[:alnum:]_. @-]{0,80}$')
   or item - array['site','date','ticket','product','tier','activity','identifier','legalName','commission','greeter','cashier','eligible','expectedRevision'] <> '{}'::jsonb
   or (item->>'commission' is not null and (jsonb_typeof(item->'commission') <> 'number'
     or item->>'commission' !~ '^-?[0-9]{1,12}$'))
   or (membership_private.tier(system_code,item->>'product') is null and not (
     system_code='Micrologic' and (
       (item->>'activity'='new' and item->>'site'='1512' and lower(btrim(item->>'product'))='$18 unlimited')
       or (item->>'activity'='regular' and lower(btrim(item->>'product')) in ('','military & veteran','old fam better wash unl'))
       or (item->>'activity'='grace' and lower(btrim(item->>'product')) in ('fam best wash unlimited 22','old fam better wash unl')))))
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
  event_day:=case when system_code='Micrologic' and lower(item->>'ticket')='wasignup' then day_date end;
  if event_day is null then
   select id into event from membership_private.events
    where system=system_code and location_id=loc and identity_date is null and ticket=item->>'ticket';
  else
   select id into event from membership_private.events
    where system='Micrologic' and location_id=loc and identity_date=event_day and lower(ticket)='wasignup';
  end if;
  select * into prev from membership_private.revisions where event_id=event order by revision desc limit 1;
  -- Only a matching lower-priority observation can reuse a saved grace classification.
  if system_code='Micrologic' and prev.source->>'activity'='grace' and fact->>'activity'='new' then
   if (prev.source-'activity'-'ticket') is distinct from (fact-'activity'-'ticket') then
    raise exception 'Membership classification conflict at location %, % ticket %: saved grace, incoming new.',
     item->>'site',day_date,item->>'ticket';
   end if;
   fact:=prev.source;
  end if;
  -- Case variations of the generic source token are the same identity on this date.
  if event_day is not null and prev.revision is not null then
   fact:=jsonb_set(fact,'{ticket}',prev.source->'ticket');
  end if;
  select * into attr from membership_private.resolve(system_code,loc,day_date,fact);
  -- A repeated observation preserves its original employee snapshot unless a reviewer explicitly corrects it.
  action:=case when prev.revision is null then 'new' when prev.source<>fact then 'correction'
    when prev.employee_id is null and attr.employee is not null then 'attribution' else 'duplicate' end;
  results:=results||jsonb_build_array(jsonb_build_object('site',item->>'site','ticket',item->>'ticket','date',day_date,'action',action,
    'previousActivity',prev.source->>'activity','activity',fact->>'activity',
    'expectedRevision',coalesce(prev.revision,0),'attribution',case when action='duplicate' then prev.attribution else attr.status end));
  if p_action='commit' then
   if (item->>'expectedRevision')::int is distinct from coalesce(prev.revision,0) then raise exception 'Membership revision changed. Preview again.';end if;
   if action in ('correction','attribution') and reason is null then raise exception 'An explicit correction reason is required.';end if;
   if event is null then insert into membership_private.events(system,location_id,ticket,identity_date) values(system_code,loc,item->>'ticket',event_day) returning id into event;end if;
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
       'zbest unlimited','zbest unlimited promo','zbetter blue vet unlimited','zbest unlimited bogo',
       'old fam better wash unl','zbetter unlimited promo','basic - rinsed - 25% off 3 months',
       'fam best wash unlimited 22','fam good wash unlimited 22','zbetter blue unlimited bogo'))
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

commit;
