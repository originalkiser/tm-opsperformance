begin;

create schema employee_identity_private;
revoke all on schema employee_identity_private from public,anon,authenticated,service_role;
create table employee_identity_private.consolidations (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 retained_id uuid not null references public.employees(id),
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 reason text not null,
 selected_aliases jsonb not null,
 mappings jsonb not null,
 roster_before jsonb not null,
 roster_after jsonb not null,
 reversed_at timestamptz,
 reversed_by uuid references auth.users(id),
 reversal_reason text
);
alter table employee_identity_private.consolidations enable row level security;
revoke all on employee_identity_private.consolidations from public,anon,authenticated,service_role;
create index employee_consolidations_location on employee_identity_private.consolidations(location_id,created_at desc);

create function employee_identity_private.checkpoint_digest(loc_id uuid, aliases jsonb)
returns text language sql stable set search_path='' as $$
 with days as (
  select distinct d.log_date from public.daily_logs d
  join jsonb_array_elements(aliases) a on d.employee_name=a->>'name' and d.log_date between (a->>'start')::date and (a->>'end')::date
  where d.location_id=loc_id
 ), checkpoints as (
  select d.id,to_jsonb(d) j from public.daily_logs d join days using(log_date) where d.location_id=loc_id
 )
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(array[
  j->>'id',j->>'log_date',j->>'time_slot',j->>'split_index',j->>'employee_id',j->>'employee_name',
  j->>'total_washes',j->>'member_washes',j->>'basic',j->>'good',j->>'better',j->>'best',j->>'google_reviews'
 ]) order by id),'[]')::text,'UTF8')),'hex') from checkpoints;
$$;
revoke all on function employee_identity_private.checkpoint_digest(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.employee_identity_consolidation(loc_id uuid, action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid(); retained uuid; reason_text text; run employee_identity_private.consolidations;
 before_rows jsonb; after_rows jsonb; approved jsonb:='[]'; alias jsonb; decision public.employee_name_mappings;
 reviewed_count int; observed_count bigint; observed_start date; observed_end date; from_day date; through_day date;
 roster_ids uuid[]; recorded text;
begin
 if not exists(select 1 from public.user_profiles where id=actor_id and role in ('admin','store') and is_active is true and deleted_at is null)
   or (public.can_propose_employee_mapping(loc_id) is distinct from true or public.can_maintain_employee_roster(loc_id) is distinct from true) then
  raise exception 'Active assigned Store or Admin access required' using errcode='42501'; end if;
 if action='list' then
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (
    select * from employee_identity_private.consolidations where location_id=loc_id order by created_at desc limit 50
  ) r);
 end if;
 if coalesce(action,'') not in ('apply','reverse') or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Invalid consolidation action or transaction isolation';end if;
 perform pg_advisory_xact_lock(hashtextextended('employee-name-mapping:'||loc_id::text,0));
 perform 1 from public.user_profiles where id=actor_id and role in ('admin','store') and is_active is true and deleted_at is null for share;
 if not found then raise exception 'Location access changed' using errcode='42501';end if;
 perform 1 from public.manager_locations where manager_id=actor_id and location_id=loc_id for share;
 if (public.can_propose_employee_mapping(loc_id) is distinct from true or public.can_maintain_employee_roster(loc_id) is distinct from true) then
   raise exception 'Location access changed' using errcode='42501';end if;
 reason_text:=btrim(payload->>'reason');
 if coalesce(length(reason_text),0) not between 1 and 1000 then raise exception 'Enter an evidence or reversal reason.';end if;

 if action='reverse' then
  select * into strict run from employee_identity_private.consolidations
   where id=(payload->>'id')::uuid and location_id=loc_id and reversed_at is null for update;
  select array_agg((r->>'id')::uuid) into roster_ids from jsonb_array_elements(run.roster_after) r;
  perform 1 from public.employees where location_id=loc_id and id=any(roster_ids) order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by id),'[]') into after_rows
    from public.employees where location_id=loc_id and id=any(roster_ids);
  if after_rows<>run.roster_after then raise exception 'Roster changed after this consolidation. Review before reversing.' using errcode='PT409';end if;
  if exists(select 1 from employee_identity_private.consolidations later
    cross join lateral jsonb_array_elements(later.roster_after) member
    where later.location_id=loc_id and later.created_at>run.created_at and later.reversed_at is null and (member->>'id')::uuid=any(roster_ids))
    then raise exception 'Reverse the newer consolidation first.' using errcode='PT409';end if;
  for alias in select value from jsonb_array_elements(run.mappings) loop
   select * into decision from public.employee_name_mappings where id=(alias->>'id')::uuid and location_id=loc_id
    and version=(alias->>'version')::int and status='approved' for update;
   if not found then raise exception 'A consolidation mapping changed. Review before reversing.' using errcode='PT409';end if;
   update public.employee_name_mappings set status='rejected',version=version+1,reviewed_by=actor_id,reviewed_at=now(),note=reason_text
    where id=decision.id returning to_jsonb(employee_name_mappings) into alias;
   insert into public.employee_name_mapping_audit(mapping_id,location_id,actor_id,operation,before_state,after_state,reason)
   values(decision.id,loc_id,actor_id,'consolidation_reverse',to_jsonb(decision),alias,reason_text);
  end loop;
  update public.employees e set is_active=(r->>'is_active')::boolean
   from jsonb_array_elements(run.roster_before) r
   where e.location_id=loc_id and e.id=(r->>'id')::uuid and e.is_active is distinct from (r->>'is_active')::boolean;
  update employee_identity_private.consolidations set reversed_at=clock_timestamp(),reversed_by=actor_id,reversal_reason=reason_text where id=run.id;
  return jsonb_build_object('id',run.id);
 end if;

 if payload->'confirmed' is distinct from 'true'::jsonb or jsonb_typeof(payload->'aliases') is distinct from 'array'
   or jsonb_typeof(payload->'roster') is distinct from 'array' or jsonb_array_length(payload->'aliases')>100
   or jsonb_array_length(payload->'roster')>100 then raise exception 'Review and explicitly confirm the selected identities.';end if;
 retained:=(payload->>'retained')::uuid;
 before_rows:=payload->'roster';
 reviewed_count:=jsonb_array_length(before_rows);
 if reviewed_count=1 or (reviewed_count=0 and jsonb_array_length(payload->'aliases')=0) then raise exception 'Select historical names or at least two roster records.';end if;
 select array_agg((r->>'id')::uuid order by (r->>'id')::uuid) into roster_ids from jsonb_array_elements(before_rows) r;
 -- Lock the retained row as well as selected duplicates in stable order.
 perform 1 from public.employees where location_id=loc_id and (id=retained or id=any(roster_ids)) order by id for update;
 if not exists(select 1 from public.employees where id=retained and location_id=loc_id) then raise exception 'Choose a retained employee at this location.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by id),'[]') into before_rows
 from public.employees where location_id=loc_id and id=any(roster_ids);
 if before_rows is distinct from (select coalesce(jsonb_agg(r order by (r->>'id')::uuid),'[]') from jsonb_array_elements(payload->'roster') r)
  or (reviewed_count>0 and not coalesce(retained=any(roster_ids),false)) then
  raise exception 'Roster changed or selected records span locations. Reload and review.' using errcode='PT409';end if;
 if jsonb_array_length(payload->'aliases')=0 then
  if payload->'rosterOnlyConfirmed' is distinct from 'true'::jsonb then
   raise exception 'Confirm that roster deactivation will leave historical sales separate.';end if;
 else
  -- Lock the existing checkpoints for all reviewed days before validating sales.
  perform 1 from public.daily_logs d where d.location_id=loc_id and d.log_date in (
   select matched.log_date from public.daily_logs matched join jsonb_array_elements(payload->'aliases') a
    on matched.employee_name=a->>'name' and matched.log_date between (a->>'start')::date and (a->>'end')::date
   where matched.location_id=loc_id
  ) order by d.id for share of d;
  if employee_identity_private.checkpoint_digest(loc_id,payload->'aliases') is distinct from payload->>'checkpointDigest' then
   raise exception 'Historical sales or checkpoints changed. Reload history and review the preview again.' using errcode='PT409';end if;
 end if;
 from_day:=(payload->>'from')::date; through_day:=(payload->>'through')::date;
 if from_day>through_day then raise exception 'Invalid date interval.';end if;
 if exists(select 1 from jsonb_array_elements(payload->'aliases') r group by r->>'name' having count(*)>1) then
  raise exception 'Review each recorded name only once.';end if;
 for alias in select value from jsonb_array_elements(payload->'aliases') loop
  recorded:=alias->>'name';
  select count(*),min(log_date),max(log_date) into observed_count,observed_start,observed_end
   from public.daily_logs where location_id=loc_id and employee_name=recorded
     and (from_day is null or log_date>=from_day) and (through_day is null or log_date<=through_day);
  if observed_count=0 or observed_count is distinct from (alias->>'appearances')::bigint
    or observed_start is distinct from (alias->>'start')::date or observed_end is distinct from (alias->>'end')::date then
    raise exception 'Historical activity changed for %. Reload and review.',recorded using errcode='PT409';end if;
  if exists(select 1 from public.daily_logs where location_id=loc_id and employee_name=recorded
    and log_date between observed_start and observed_end and employee_id is not null and employee_id<>retained
    and not coalesce(employee_id=any(roster_ids),false)) then
    raise exception 'Recorded name % is linked to a different roster record. Select the verified record or narrow the date range.',recorded;end if;
  -- Existing decisions are left intact. A covering decision for this retained
  -- employee already does the job. Any other overlap goes through legacy review.
  if exists(select 1 from public.employee_name_mappings m where m.location_id=loc_id and m.original_name=recorded
    and m.employee_id=retained and m.status in ('approved','locked')
    and daterange(m.start_date,m.end_date,'[]') @> daterange(observed_start,observed_end,'[]')) then continue;end if;
  if exists(select 1 from public.employee_name_mappings m where m.location_id=loc_id and m.original_name=recorded
    and m.status in ('approved','locked')
    and daterange(m.start_date,m.end_date,'[]') && daterange(observed_start,observed_end,'[]')) then
    raise exception 'An approved mapping already covers part of %. Review the existing decision.',recorded using errcode='23P01';end if;
  insert into public.employee_name_mappings(location_id,original_name,employee_id,start_date,end_date,status,proposed_by,reviewed_by,reviewed_at,note)
   values(loc_id,recorded,retained,observed_start,observed_end,'approved',actor_id,actor_id,now(),reason_text) returning * into decision;
  insert into public.employee_name_mapping_audit(mapping_id,location_id,actor_id,operation,after_state,reason)
   values(decision.id,loc_id,actor_id,'consolidation_apply',to_jsonb(decision),reason_text);
  approved:=approved||jsonb_build_array(jsonb_build_object('id',decision.id,'version',decision.version,'name',recorded));
 end loop;
 if reviewed_count>0 then
  perform public.review_employee_duplicates(loc_id,roster_ids,retained,true,before_rows);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by id),'[]') into after_rows
 from public.employees where location_id=loc_id and id=any(roster_ids);
 insert into employee_identity_private.consolidations(location_id,retained_id,actor,reason,selected_aliases,mappings,roster_before,roster_after)
 values(loc_id,retained,actor_id,reason_text,payload->'aliases',approved,before_rows,after_rows) returning * into run;
 return jsonb_build_object('id',run.id,'mappings',approved);
end;
$$;
revoke all on function public.employee_identity_consolidation(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.employee_identity_consolidation(uuid,text,jsonb) to authenticated;

commit;
