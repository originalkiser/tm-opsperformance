begin;

-- The general history list is capped. Roster visibility needs every unreversed
-- consolidation that included roster records, even when the run is older.
create function public.employee_consolidated_roster(loc_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role in ('admin', 'store')
      and is_active is true and deleted_at is null
  ) or public.can_propose_employee_mapping(loc_id) is distinct from true
    or public.can_maintain_employee_roster(loc_id) is distinct from true then
    raise exception 'Active assigned Store or Admin access required' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(c) - 'roster_after' - 'mappings' order by c.created_at desc, c.id), '[]'::jsonb)
    from employee_identity_private.consolidations c
    where c.location_id = loc_id and c.reversed_at is null
      and jsonb_array_length(c.roster_before) > 0
  );
end;
$$;

revoke all on function public.employee_consolidated_roster(uuid) from public, anon, authenticated, service_role;
grant execute on function public.employee_consolidated_roster(uuid) to authenticated;

commit;
