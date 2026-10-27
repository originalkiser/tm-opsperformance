-- REVIEW ONLY: additive Phase 2. No Daily Log/employee DML, identity backfill,
-- shared helper replacement, role migration, or change to entry/Undo triggers.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

create table public.employee_name_mappings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  original_name text not null check (length(btrim(original_name)) > 0),
  employee_id uuid not null constraint employee_name_mappings_employee_id_fkey references public.employees(id),
  start_date date,
  end_date date,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','locked')),
  version integer not null default 1 check (version > 0),
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  note text not null check (length(btrim(note)) > 0),
  check (start_date is null or end_date is null or start_date <= end_date)
);
create index employee_name_mappings_location on public.employee_name_mappings(location_id, original_name);
create table public.employee_name_mapping_audit (
  id bigint generated always as identity primary key,
  mapping_id uuid not null references public.employee_name_mappings(id),
  location_id uuid not null references public.locations(id),
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now(),
  operation text not null,
  before_state jsonb,
  after_state jsonb not null,
  reason text not null
);
create index employee_name_mapping_audit_mapping on public.employee_name_mapping_audit(mapping_id, id);
alter table public.employee_name_mappings enable row level security;
alter table public.employee_name_mapping_audit enable row level security;
revoke all on public.employee_name_mappings, public.employee_name_mapping_audit from public, anon, authenticated, service_role;
revoke all on sequence public.employee_name_mapping_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.employee_name_mappings, public.employee_name_mapping_audit to authenticated;

-- Separate feature scope: only active Admin/Store, including explicit additional
-- Store assignments. Does not change any existing roster or operational helper.
create function public.can_propose_employee_mapping(loc_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active is true and p.deleted_at is null
      and (p.role = 'admin' or (p.role = 'store' and (
        p.location_id = loc_id or exists (select 1 from public.manager_locations ml
          where ml.manager_id = p.id and ml.location_id = loc_id)))));
$$;
revoke all on function public.can_propose_employee_mapping(uuid) from public, anon, authenticated;
grant execute on function public.can_propose_employee_mapping(uuid) to authenticated;

-- Proposal/evidence rows are assigned-location only. Company-wide reports use
-- the narrow approved-only RPC below; decision notes/audit are not exposed there.
create policy employee_name_mappings_read on public.employee_name_mappings
for select to authenticated using (public.can_propose_employee_mapping(location_id));
create policy employee_name_mapping_audit_read on public.employee_name_mapping_audit
for select to authenticated using (public.can_propose_employee_mapping(location_id));

create function public.approved_employee_name_mappings(location_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_profiles p where p.id = auth.uid()
    and p.role in ('admin','store') and p.is_active is true and p.deleted_at is null) then
    raise exception 'Active Admin or Store required' using errcode = '42501';
  end if;
  -- Scalar JSON returns the complete set, unaffected by PostgREST row caps.
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'location_id', m.location_id, 'original_name', m.original_name,
    'employee_id', m.employee_id, 'employee_name', e.name,
    'start_date', m.start_date, 'end_date', m.end_date, 'status', m.status
  ) order by m.id), '[]'::jsonb)
  from public.employee_name_mappings m join public.employees e on e.id = m.employee_id
  where m.location_id = any(location_ids) and m.status in ('approved','locked'));
end;
$$;
revoke all on function public.approved_employee_name_mappings(uuid[]) from public,anon,authenticated;
grant execute on function public.approved_employee_name_mappings(uuid[]) to authenticated;

-- No client table writes. One checked RPC serializes the complete lifecycle and
-- writes append-only audit in the same transaction. No data modification RPC for
-- Daily Logs, employees or assignments is introduced.
create function public.change_employee_name_mapping(
  operation text, loc_id uuid, mapping_id uuid, expected_version integer,
  recorded_name text, target_id uuid, from_date date, through_date date,
  reason text, identity_confirmed boolean
) returns public.employee_name_mappings
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  admin_actor boolean;
  old_row public.employee_name_mappings;
  new_row public.employee_name_mappings;
begin
  if not public.can_propose_employee_mapping(loc_id) then
    raise exception 'Active assigned Store or Admin required' using errcode = '42501';
  end if;
  select p.role = 'admin' into admin_actor from public.user_profiles p where p.id = actor;
  if operation is null or operation not in ('propose','approve','reject','lock','correct') then
    raise exception 'Unknown mapping operation' using errcode = '22023';
  end if;
  if operation <> 'propose' and admin_actor is distinct from true then
    raise exception 'Only Admin may approve, reject, lock or correct mappings' using errcode = '42501';
  end if;
  if reason is null or length(btrim(reason)) = 0 then
    raise exception 'Evidence or reason is required' using errcode = '22023';
  end if;
  if operation <> 'reject' and identity_confirmed is distinct from true then
    raise exception 'Confirm identity for all activity within the dates' using errcode = '22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Mapping changes require READ COMMITTED' using errcode = '25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('employee-name-mapping:' || loc_id::text, 0));
  -- Recheck authorization after any lock wait, before observing/editing proposals.
  if not public.can_propose_employee_mapping(loc_id) then
    raise exception 'Location access changed; reload' using errcode = '42501';
  end if;
  select p.role = 'admin' into admin_actor from public.user_profiles p where p.id = actor;
  if operation <> 'propose' and admin_actor is distinct from true then
    raise exception 'Admin access changed; reload' using errcode = '42501';
  end if;
  if operation = 'propose' then
    if mapping_id is not null or expected_version is not null then
      raise exception 'New proposals must not reference an existing mapping' using errcode = '22023';
    end if;
    new_row.id := gen_random_uuid();
    new_row.location_id := loc_id;
    new_row.original_name := recorded_name;
    new_row.employee_id := target_id;
    new_row.start_date := from_date;
    new_row.end_date := through_date;
    new_row.status := 'proposed';
    new_row.version := 1;
    new_row.proposed_by := actor;
    new_row.proposed_at := now();
  else
    select m.* into old_row from public.employee_name_mappings m
      where m.id = mapping_id and m.location_id = loc_id for update;
    if not found or expected_version is null or old_row.version <> expected_version then
      raise exception 'Mapping changed or is unavailable; reload' using errcode = '40001';
    end if;
    new_row := old_row;
    new_row.version := old_row.version + 1;
    new_row.reviewed_by := actor;
    new_row.reviewed_at := now();
    if operation = 'approve' then
      if old_row.status <> 'proposed' then raise exception 'Only proposed mappings can be approved' using errcode = '22023'; end if;
      new_row.status := 'approved';
    elsif operation = 'lock' then
      if old_row.status <> 'approved' then raise exception 'Only approved mappings can be locked' using errcode = '22023'; end if;
      new_row.status := 'locked';
    elsif operation = 'reject' then
      if old_row.status not in ('proposed','approved','locked') then raise exception 'Mapping is already rejected' using errcode = '22023'; end if;
      new_row.status := 'rejected';
    else
      -- Correction of even a locked decision requires explicit Admin evidence and
      -- a fresh version. Preserve locked status; rejected corrections need review.
      if recorded_name is distinct from old_row.original_name then
        raise exception 'Correction cannot change the original recorded alias' using errcode = '22023';
      end if;
      new_row.employee_id := target_id;
      new_row.start_date := from_date;
      new_row.end_date := through_date;
      if old_row.status = 'rejected' then new_row.status := 'proposed'; end if;
    end if;
  end if;
  new_row.note := btrim(reason);
  if new_row.original_name is null or length(btrim(new_row.original_name)) = 0
     or (new_row.start_date is not null and new_row.end_date is not null and new_row.start_date > new_row.end_date) then
    raise exception 'A recorded name and valid date interval are required' using errcode = '22023';
  end if;
  -- The target must exist at this exact location; inactive originals remain valid
  -- for historical attribution. Never infer a match from spelling or an ID.
  perform 1 from public.employees e where e.id = new_row.employee_id and e.location_id = loc_id for key share;
  if not found then raise exception 'Choose an existing roster employee at this location' using errcode = '22023'; end if;
  if operation <> 'reject' and not exists (select 1 from public.daily_logs d where d.location_id = loc_id
    and d.employee_name = new_row.original_name
    and (new_row.start_date is null or d.log_date >= new_row.start_date)
    and (new_row.end_date is null or d.log_date <= new_row.end_date)) then
    raise exception 'No recorded activity exists for that exact name and date interval' using errcode = '22023';
  end if;
  -- Under the location lock the fresh READ COMMITTED snapshot prevents two
  -- concurrent approvals/corrections attributing the same source row twice.
  if new_row.status in ('approved','locked') and exists (
    select 1 from public.employee_name_mappings m where m.location_id = loc_id
      and m.original_name = new_row.original_name and m.id <> new_row.id
      and m.status in ('approved','locked')
      and daterange(m.start_date,m.end_date,'[]') && daterange(new_row.start_date,new_row.end_date,'[]')
  ) then raise exception 'An approved mapping already covers these dates; correct or reject it first' using errcode = '23P01'; end if;
  if operation = 'propose' then
    insert into public.employee_name_mappings select (new_row).*;
  else
    update public.employee_name_mappings m set employee_id = new_row.employee_id,
      start_date = new_row.start_date, end_date = new_row.end_date, status = new_row.status,
      version = new_row.version, reviewed_by = new_row.reviewed_by,
      reviewed_at = new_row.reviewed_at, note = new_row.note where m.id = new_row.id;
  end if;
  insert into public.employee_name_mapping_audit(mapping_id,location_id,actor_id,operation,before_state,after_state,reason)
    values(new_row.id,loc_id,actor,operation,
      case when operation = 'propose' then null else to_jsonb(old_row) end,to_jsonb(new_row),new_row.note);
  return new_row;
end;
$$;
revoke all on function public.change_employee_name_mapping(text,uuid,uuid,integer,text,uuid,date,date,text,boolean) from public,anon,authenticated;
grant execute on function public.change_employee_name_mapping(text,uuid,uuid,integer,text,uuid,date,date,text,boolean) to authenticated;
commit;
