-- NOT AUTHORIZED TO RUN. Separate release approval required after BOTH frontend deployments.
-- On this same trusted connection, privately set tmops.weekly_frontend_deployed_at
-- to the verified production deployment completion timestamp (not an arbitrary policy date).
-- Use the later successful deployment completion time if the two hosts finish separately.
-- This is the release marker: site-local next Mondays are derived from it once, forever.
begin;
set local lock_timeout='3s';
do $$
declare released timestamptz; prior timestamptz;
begin
 released:=nullif(current_setting('tmops.weekly_frontend_deployed_at',true),'')::timestamptz;
 if released is null then raise exception 'Verified frontend deployment timestamp required'; end if;
 select activated_at into strict prior from checklist_private.weekly_deadline_policy where singleton for update;
 if prior is not null then raise exception 'Weekly deadline policy already activated; stop and review'; end if;
 update checklist_private.weekly_deadline_policy set activated_at=released where singleton;
end;
$$;
select site_code,timezone,checklist_private.weekly_policy_start(timezone) as first_new_reporting_week
 from public.locations where exclude_from_reporting is not true order by site_code;
commit;
