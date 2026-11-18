-- Release metadata/aggregate evidence only. No identities, credentials, answers or evidence paths.
begin read only;
set local statement_timeout='20s';
select jsonb_build_object('check','installation','configuration_schema_absent',to_regnamespace('configuration_private') is null,
 'new_editor_absent',to_regprocedure('public.checklist_template_editor(text,text,integer,integer,jsonb,text,integer)') is null,
 'new_capability_absent',to_regprocedure('public.configuration_capabilities()') is null,
 'new_account_guard_absent',to_regprocedure('public.authorize_admin_user_action(uuid)') is null,
 'validator_backup_absent',to_regprocedure('checklist_private.validate_answers_before_photo_counts(public.checklist_submissions,jsonb,text,boolean,uuid)') is null) as preflight
union all
select jsonb_build_object('check','template','key',key,'version',version,'cadence',cadence,'questions',jsonb_array_length(definition),
 'definition_md5',md5(definition::text),'signatures',(select count(*) from jsonb_array_elements(definition) i where (i->>'signature_required')::boolean),
 'conditional_questions',(select count(*) from jsonb_array_elements(definition) i where i ? 'condition')) from public.checklist_templates
union all
select jsonb_build_object('check','relation','schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where
 (n.nspname='public' and c.relname in ('checklist_templates','checklist_submissions','checklist_attachments','user_profiles','locations','manager_locations'))
 or (n.nspname='checklist_private' and c.relname in ('working_copies','versions','upload_intents','photo_fingerprints'))
union all
select jsonb_build_object('check','function','schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
 'source_md5',md5(p.prosrc),'definer',p.prosecdef,'search_path',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='checklist_private' and p.proname in ('validate_answers','access_action','qr_template_allowed','period_end','assigned','evidence_ids'))
 or (n.nspname='public' and p.proname in ('configure_checklist_pilot','save_checklist','protect_profile_privileged_columns','get_checklist_compliance'))
union all
select jsonb_build_object('check','profile_auth_trigger','schema',n.nspname,'table',c.relname,'name',t.tgname,
 'function',p.proname,'event_flags',t.tgtype,'enabled',t.tgenabled,'function_md5',md5(p.prosrc))
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
 where not t.tgisinternal and ((n.nspname='auth' and c.relname='users') or (n.nspname='public' and c.relname='user_profiles'))
union all
select jsonb_build_object('check','template_privileges','role',r,'select',has_table_privilege(r,'public.checklist_templates','SELECT'),
 'table_write',has_table_privilege(r,'public.checklist_templates','INSERT,UPDATE,DELETE,TRUNCATE'),
 'definition_column_update',has_column_privilege(r,'public.checklist_templates','definition','UPDATE')) from unnest(array['anon','authenticated']) r
union all
select jsonb_build_object('check','profile_privileges','role','authenticated','select',has_table_privilege('authenticated','public.user_profiles','SELECT'),
 'update',has_table_privilege('authenticated','public.user_profiles','UPDATE'))
union all
select jsonb_build_object('check','policy','schema',schemaname,'table',tablename,'name',policyname,'command',cmd,
 'roles',roles,'using_md5',md5(coalesce(qual,'')),'check_md5',md5(coalesce(with_check,''))) from pg_policies
 where (schemaname='public' and tablename in ('checklist_templates','user_profiles'))
union all
select jsonb_build_object('check','profiles','role',role,'count',count(*),'active',count(*) filter(where is_active=true and deleted_at is null),
 'null_active',count(*) filter(where is_active is null)) from public.user_profiles group by role
union all
select jsonb_build_object('check','assignments','count',count(*),'fingerprint',md5(coalesce(string_agg(to_jsonb(m)::text,'' order by m.manager_id,m.location_id),''))) from public.manager_locations m
union all
select jsonb_build_object('check','submissions','count',count(*),'drafts',count(*) filter(where status='draft'),'submitted',count(*) filter(where status='submitted'),
 'snapshots_md5',md5(coalesce(string_agg(id::text||template_snapshot::text,'' order by id),''))) from public.checklist_submissions
union all
select jsonb_build_object('check','history','versions',(select count(*) from checklist_private.versions),'working_copies',(select count(*) from checklist_private.working_copies),
 'attachments',(select count(*) from public.checklist_attachments),'photos',(select count(*) from public.checklist_attachments where kind='photo'),
 'signatures',(select count(*) from public.checklist_attachments where kind='signature'))
union all
select jsonb_build_object('check','evidence_bucket','private',not public,'size_limit',file_size_limit,'mime_types',allowed_mime_types)
 from storage.buckets where id='manager-checklist-evidence'
union all
select jsonb_build_object('check','photo_integrity','enforced',enforced,'verified_endpoint',endpoint_version='sha256-v1',
 'missing_storage_objects',(select count(*) from public.checklist_attachments a where not exists(select 1 from storage.objects o where o.bucket_id='manager-checklist-evidence' and o.name=a.object_path)),
 'unverified_operational_photos',(select count(*) from public.checklist_attachments a join public.checklist_submissions s on s.id=a.submission_id
 where a.kind='photo' and checklist_private.qr_template_allowed(s.template_key) and not exists(select 1 from checklist_private.photo_fingerprints f where f.attachment_id=a.id and (f.legacy or f.state='verified'))))
 from checklist_private.photo_rollout where singleton;
commit;
