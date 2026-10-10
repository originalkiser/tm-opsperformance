-- migration12.sql
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Only admins may change a user's role, location, active/deleted status or email.
--
-- Why: the user_profiles UPDATE policies let anyone edit their OWN row (and area
-- managers edit rows for users at their locations) with no limit on which columns
-- or what values, so a signed-in user could set their own role to 'admin'. Row
-- policies can't compare old vs. new values, so this is a trigger instead.
--
-- Who is still allowed:
--   * admins                      - everything (Admin panel: role, location, deactivate/restore)
--   * requests with no signed-in  - the service-role key used by edge functions
--     user (auth.uid() is null)     (admin-users changes email), and SQL run directly
--   * everyone else               - name, settings and the other non-privileged columns
--                                   only (SettingsModal saves `settings` on the user's own row)

create or replace function protect_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.get_user_role() = 'admin' then
    return new;
  end if;

  if new.id          is distinct from old.id
     or new.role        is distinct from old.role
     or new.location_id is distinct from old.location_id
     or new.is_active   is distinct from old.is_active
     or new.deleted_at  is distinct from old.deleted_at
     or new.email       is distinct from old.email then
    raise exception 'Only an admin can change a user''s role, location, status or email'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on user_profiles;
create trigger protect_profile_privileged_columns
  before update on user_profiles
  for each row execute function protect_profile_privileged_columns();
