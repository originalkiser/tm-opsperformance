-- Metadata/counts/fingerprints only. No account identifiers, answers or evidence paths.
begin read only;
select to_regclass('checklist_private.weekly_deadline_policy') is null as migration_not_installed;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,p.proconfig,
 md5(p.prosrc),has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='checklist_private' and p.proname in ('access_action','reply','deadline','period_end','validate_answers','guard_evidence_insert','compliance_summary'))
 or (n.nspname='public' and p.proname in ('save_checklist','get_checklist_compliance')) order by 1,2,3;
select key,cadence,version,md5(definition::text) as definition_fingerprint from public.checklist_templates order by key;
select count(*) as submissions,md5(string_agg(to_jsonb(s)::text,'' order by s.id)) as fingerprint from public.checklist_submissions s;
select count(*) as attachments,md5(string_agg(to_jsonb(e)::text,'' order by e.id)) as fingerprint from public.checklist_attachments e;
select count(*) as profiles,md5(string_agg(to_jsonb(p)::text,'' order by p.id)) as fingerprint from public.user_profiles p;
select count(*) as assignments,md5(string_agg(to_jsonb(m)::text,'' order by to_jsonb(m)::text)) as fingerprint from public.manager_locations m;
select count(*) as super_admin_capabilities from configuration_private.super_admins;
select enforced,endpoint_version from checklist_private.photo_rollout where singleton;
commit;
