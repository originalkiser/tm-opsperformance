-- REVIEW ONLY: existing roster maintainers may review duplicates at their own
-- authorized locations. Mapping approvals remain Admin-only. No data rewrite.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $$ begin
 if to_regprocedure('public.review_employee_duplicates(uuid,uuid[],uuid,boolean,jsonb)') is null
 or to_regprocedure('public.can_maintain_employee_roster(uuid)') is null then
  raise exception 'Existing roster installation required';
 end if;
end $$;
create or replace function public.review_employee_duplicates(loc_id uuid,selected_ids uuid[],primary_id uuid,confirmed boolean,reviewed_rows jsonb)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare expected integer; changed integer;
begin
  if confirmed is distinct from true or not public.can_maintain_employee_roster(loc_id) then
    raise exception 'Assigned roster access and explicit identity confirmation required' using errcode='42501';
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
    raise exception 'Selected employees changed since review; reload and confirm again' using errcode='PT409';
  end if;
  update public.employees set is_active=(id=primary_id) where location_id=loc_id and id=any(selected_ids);
  get diagnostics changed=row_count;
  if changed<>expected then raise exception 'Roster update incomplete' using errcode='PT409'; end if;
  return changed;
end $$;
commit;
