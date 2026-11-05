-- READ ONLY, after separately approved migration. Expect four templates and ZERO pilot records/grants/files initially.
select t.key,t.name,t.cadence,t.version,jsonb_array_length(t.definition) as questions,
 (select count(*) from jsonb_array_elements(t.definition) i where (i->>'critical')::boolean) as critical_questions,
 (select count(*) from jsonb_array_elements(t.definition) i where (i->>'photo_required')::boolean) as required_photos,
 (select count(*) from jsonb_array_elements(t.definition) i where (i->>'na_allowed')::boolean) as na_allowed
 from public.checklist_templates t order by key;
select (select count(*) from public.checklist_pilot_access) as pilot_grants,
 (select count(*) from public.checklist_submissions) as submissions,
 (select count(*) from public.checklist_attachments) as attachments,
 (select count(*) from storage.objects where bucket_id='manager-checklist-evidence') as evidence_objects;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='manager-checklist-evidence';
select c.relname,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT') as anon_read,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as client_writes
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in
 ('checklist_templates','checklist_pilot_access','checklist_submissions','checklist_attachments');
select schemaname,tablename,policyname,roles,cmd,permissive,qual,with_check from pg_policies
 where (schemaname='public' and tablename like 'checklist_%') or (schemaname='storage' and tablename='objects' and policyname like 'checklist_%') order by schemaname,tablename,policyname;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='checklist_private' or
 (n.nspname='public' and p.proname in ('save_checklist','attach_checklist_evidence','configure_checklist_pilot')) order by 1,2;
select conrelid::regclass,conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in
 ('public.checklist_templates'::regclass,'public.checklist_pilot_access'::regclass,'public.checklist_submissions'::regclass,'public.checklist_attachments'::regclass) order by 1,2;
