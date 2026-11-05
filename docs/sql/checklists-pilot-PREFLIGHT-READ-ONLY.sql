-- READ ONLY. Confirm dashboard URL project qbdvixxooofdlfurcpqy and recovery point separately.
select current_user as execution_role,
 to_regnamespace('checklist_private') is null as private_schema_absent,
 not exists(select 1 from pg_tables where schemaname='public' and tablename in
 ('checklist_templates','checklist_pilot_access','checklist_submissions','checklist_attachments')) as new_tables_absent,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('save_checklist','attach_checklist_evidence','configure_checklist_pilot')) as rpc_names_absent,
 not exists(select 1 from storage.buckets where id='manager-checklist-evidence') as bucket_absent,
 (select relrowsecurity from pg_class where oid='storage.objects'::regclass) as storage_rls_enabled;
-- Verify referenced column types and nullability. No operational record contents returned.
select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and
 ((table_name='user_profiles' and column_name in ('id','name','role','location_id','is_active','deleted_at')) or
 (table_name='locations' and column_name in ('id','site_code','timezone')) or
 (table_name='manager_locations' and column_name in ('manager_id','location_id')) or
 (table_name='edit_audit_log' and column_name in ('table_name','location_id','period','changed_by','changed_by_name','summary','old_values','new_values')))
 order by table_name,ordinal_position;
select table_name,column_name,data_type from information_schema.columns where table_schema='storage' and
 ((table_name='buckets' and column_name in ('id','name','public','file_size_limit','allowed_mime_types')) or
 (table_name='objects' and column_name in ('id','bucket_id','name','owner','owner_id'))) order by table_name,ordinal_position;
select conrelid::regclass as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint
 where conrelid in ('public.user_profiles'::regclass,'public.locations'::regclass,'public.manager_locations'::regclass,'public.edit_audit_log'::regclass) order by 1,2;
select policyname,roles,cmd,permissive,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname;
select role,has_table_privilege(role,'storage.objects','SELECT') as can_select,
 has_table_privilege(role,'storage.objects','INSERT') as can_insert
 from (values('anon'),('authenticated')) r(role);
-- Informational count. Selected pilot sites must have valid IANA time zones; do not change unrelated sites.
select count(*) filter(where l.timezone is null or z.name is null) as invalid_location_timezones
 from public.locations l left join pg_timezone_names z on z.name=l.timezone;
-- Inspect relevant existing triggers for additional requirements; do not alter them.
select t.tgrelid::regclass as relation,t.tgname,pg_get_triggerdef(t.oid) as definition,t.tgfoid::regprocedure as function
 from pg_trigger t where not t.tgisinternal and t.tgrelid in
 ('public.edit_audit_log'::regclass,'storage.buckets'::regclass,'storage.objects'::regclass) order by 1,2;
