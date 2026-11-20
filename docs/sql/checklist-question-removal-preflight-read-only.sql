-- Run before and after the single-function question-removal migration. Metadata/counts only;
-- no account identifiers, responses, Storage paths, credentials or photo bytes.
begin read only;
select p.oid::regprocedure::text as function,md5(p.prosrc) as body_md5,p.prosecdef,p.proconfig,p.proacl::text
from pg_proc p where p.oid='configuration_private.validate_template(text,jsonb,boolean,integer)'::regprocedure;
select count(*) as published_templates,
 md5(string_agg(md5(to_jsonb(t)::text),'' order by t.key)) as published_fingerprint
from public.checklist_templates t;
select 'submissions' as object,count(*) as records from public.checklist_submissions
union all select 'attachments',count(*) from public.checklist_attachments
union all select 'template_versions',count(*) from configuration_private.template_versions
union all select 'template_drafts',count(*) from configuration_private.template_drafts
union all select 'super_admin_grants',count(*) from configuration_private.super_admins;
select md5(string_agg(p.oid::text||p.prosrc||coalesce(p.proacl::text,'')||p.prosecdef::text||coalesce(p.proconfig::text,''),'|' order by p.oid)) as unchanged_checklist_function_permissions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname in ('checklist_private','configuration_private')
 or (n.nspname='public' and (p.proname like '%checklist%' or p.proname='configuration_capabilities')))
 and p.oid<>'configuration_private.validate_template(text,jsonb,boolean,integer)'::regprocedure;
select has_function_privilege('authenticated','configuration_private.validate_template(text,jsonb,boolean,integer)','execute') as direct_authenticated_validator,
 has_function_privilege('anon','configuration_private.validate_template(text,jsonb,boolean,integer)','execute') as direct_anonymous_validator;
select enforced,endpoint_verified_at is not null as endpoint_attested from checklist_private.photo_rollout where singleton;
-- After installation, all three counts must be zero: the migration performs no
-- DML. Live users may legitimately change aggregate record counts separately.
select 'submissions_written_by_migration' as provenance,count(*) as records from public.checklist_submissions
where xmin=(select xmin from pg_proc where oid='configuration_private.validate_template(text,jsonb,boolean,integer)'::regprocedure)
union all select 'attachments_written_by_migration',count(*) from public.checklist_attachments
where xmin=(select xmin from pg_proc where oid='configuration_private.validate_template(text,jsonb,boolean,integer)'::regprocedure)
union all select 'templates_written_by_migration',count(*) from public.checklist_templates
where xmin=(select xmin from pg_proc where oid='configuration_private.validate_template(text,jsonb,boolean,integer)'::regprocedure);
rollback;
