-- Metadata only. No account identifiers, emails, answers, signatures or image paths.
begin read only;
set local statement_timeout='15s';
select key,cadence,version,jsonb_array_length(definition) as question_count,
 md5(definition::text) as definition_fingerprint from public.checklist_templates order by key;
select schemaname,tablename,policyname,cmd,roles,qual,with_check from pg_policies
 where tablename in ('checklist_templates','user_profiles') order by schemaname,tablename,policyname;
select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name in ('checklist_templates','user_profiles')
 and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef,p.proconfig,md5(pg_get_functiondef(p.oid)) as definition_fingerprint
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='public' and p.proname in ('configure_checklist_pilot','protect_profile_privileged_columns','save_checklist'))
 or (n.nspname='checklist_private' and p.proname in ('validate_answers','access_action','qr_template_allowed','period_end'))
 order by n.nspname,p.proname;
select enforced from checklist_private.photo_rollout where singleton;
select count(*) as existing_submissions,md5(coalesce(string_agg(id::text||template_snapshot::text,'' order by id),'')) as snapshot_fingerprint
 from public.checklist_submissions;
commit;
