-- REVIEW ONLY. Requires PR #38. No Daily Log/identity/scoring changes.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
lock table public.employees in access exclusive mode;
do $$ begin
  if to_regprocedure('public.can_maintain_employee_roster(uuid)') is null
     or to_regprocedure('public.employee_roster_name_key(text)') is not null
     or exists(select 1 from pg_trigger where tgrelid='public.employees'::regclass and tgname='guard_employee_roster_name') then
    raise exception 'PR #38 required; stop on existing name guard or schema drift';
  end if;
end $$;
create function public.employee_roster_trim(value text) returns text
language sql immutable strict security invoker set search_path='' as $$
 select pg_catalog.btrim(value,E' \t\n\r\f\v' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
create function public.employee_roster_name_key(value text) returns text
language sql immutable strict security invoker set search_path='' as $$
 select pg_catalog.lower(public.employee_roster_trim(value));
$$;
create function public.guard_employee_roster_name() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare key text;
begin
  -- Status-only changes and existing duplicate groups remain editable.
  if tg_op='UPDATE' and new.name is not distinct from old.name then return new; end if;
  if not public.can_maintain_employee_roster(new.location_id) then
    raise exception 'Roster location is not authorized' using errcode='42501';
  end if;
  new.name := public.employee_roster_trim(new.name);
  key := public.employee_roster_name_key(new.name);
  if key is null or key='' then raise exception 'Enter an employee name' using errcode='23514'; end if;
  if tg_op='UPDATE' and key=public.employee_roster_name_key(old.name) then return new; end if;
  -- PostgREST uses READ COMMITTED. Reject snapshot isolation for name changes:
  -- a waiter must obtain a fresh snapshot after the transaction-level lock.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Roster name changes require READ COMMITTED; retry normally' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('employee-roster:'||new.location_id::text,0));
  -- VOLATILE function: this statement obtains a fresh READ COMMITTED snapshot
  -- after the lock, including the preceding writer's committed name.
  if exists(select 1 from public.employees e where e.location_id=new.location_id
      and e.id is distinct from new.id and public.employee_roster_name_key(e.name)=key) then
    raise exception 'An active or inactive employee already has this name at this location'
      using errcode='23505',constraint='employee_roster_normalized_name';
  end if;
  return new;
end $$;
revoke all on function public.guard_employee_roster_name() from public,anon,authenticated;
revoke all on function public.employee_roster_trim(text),public.employee_roster_name_key(text) from public,anon;
grant execute on function public.employee_roster_trim(text),public.employee_roster_name_key(text) to authenticated;
create trigger guard_employee_roster_name before insert or update of name on public.employees
 for each row execute function public.guard_employee_roster_name();

-- One transaction, explicit Admin identity confirmation, no deletes/history edits.
-- SECURITY INVOKER keeps PR #38's row and column permissions authoritative.
create function public.review_employee_duplicates(loc_id uuid,selected_ids uuid[],primary_id uuid,confirmed boolean,reviewed_rows jsonb)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare expected integer; changed integer;
begin
  if confirmed is distinct from true or not exists(select 1 from public.user_profiles p
      where p.id=auth.uid() and p.role='admin' and p.is_active is true and p.deleted_at is null)
      or not public.can_maintain_employee_roster(loc_id) then
    raise exception 'Active Admin and explicit identity confirmation required' using errcode='42501';
  end if;
  expected := pg_catalog.cardinality(selected_ids);
  if expected is null or expected<2 or expected>100 or primary_id is null
      or not (primary_id=any(selected_ids))
      or (select count(distinct v) from pg_catalog.unnest(selected_ids) v)<>expected then
    raise exception 'Choose 2–100 distinct records and one retained record' using errcode='22023';
  end if;
  -- Lock in UUID order and require every selected row to still exist at this site.
  perform id from public.employees where location_id=loc_id and id=any(selected_ids) order by id for update;
  if (select count(*) from public.employees where location_id=loc_id and id=any(selected_ids))<>expected then
    raise exception 'Roster changed or selection spans locations; reload' using errcode='22023';
  end if;
  if reviewed_rows is null or pg_catalog.jsonb_typeof(reviewed_rows)<>'array' then
    raise exception 'Reviewed roster snapshot required' using errcode='22023';
  end if;
  if (select count(distinct r.id) from pg_catalog.jsonb_to_recordset(reviewed_rows) as r(id uuid,name text,is_active boolean))<>expected
     or (select count(*) from pg_catalog.jsonb_to_recordset(reviewed_rows) as r(id uuid,name text,is_active boolean)
       join public.employees e on e.id=r.id and e.location_id=loc_id
       where e.id=any(selected_ids) and e.name is not distinct from r.name and e.is_active is not distinct from r.is_active)<>expected then
    raise exception 'Selected employees changed since review; reload and confirm again' using errcode='40001';
  end if;
  update public.employees set is_active=(id=primary_id) where location_id=loc_id and id=any(selected_ids);
  get diagnostics changed=row_count;
  if changed<>expected then raise exception 'Roster update incomplete' using errcode='40001'; end if;
  return changed;
end $$;
revoke all on function public.review_employee_duplicates(uuid,uuid[],uuid,boolean,jsonb) from public,anon;
grant execute on function public.review_employee_duplicates(uuid,uuid[],uuid,boolean,jsonb) to authenticated;
commit;
