-- PR #27: ONE read-only statement, ONE row/JSON value. No function calls to
-- operational RPCs, DML, DDL, role changes, or operational record contents.
-- Run as postgres in the Supabase SQL editor ONLY after independently confirming
-- tm-opsperformance / qbdvixxooofdlfurcpqy. current_database() is not a project ID.
-- Reuses PR #16/#18 reporting security and PR #22/#23 Plans Lost evidence.
-- Compare scoped policies/helper hashes with that accepted inventory; changed
-- evidence needs review, not an automatic general security remediation.
with required(table_name,column_name,expected_type) as (values
 ('budget_targets','location_id','uuid'),
 ('budget_targets','target_month','date'),
 ('budget_targets','starting_members','integer'),
 ('budget_daily_entries','location_id','uuid'),
 ('budget_daily_entries','entry_date','date'),
 ('budget_daily_entries','mtd_membership_actual','integer'),
 ('daily_logs','location_id','uuid'),
 ('daily_logs','log_date','date'),
 ('daily_logs','time_slot','time without time zone'),
 ('daily_logs','split_index','integer'),
 ('daily_logs','basic','integer'),
 ('daily_logs','good','integer'),
 ('daily_logs','better','integer'),
 ('daily_logs','best','integer'),
 ('daily_logs','reactivations','integer'),
 ('daily_logs','net_members','integer'),
 ('daily_logs','plans_lost_today','integer'),
 ('daily_logs','net_members_legacy','boolean'),
 ('locations','id','uuid'),
 ('locations','show_budget_tracking','boolean'),
 ('locations','exclude_from_reporting','boolean'),
 ('locations','timezone','text'),
 ('locations','opportunities_formula','text'),
 ('user_profiles','id','uuid'),
 ('user_profiles','role','text'),
 ('user_profiles','is_active','boolean'),
 ('user_profiles','deleted_at','timestamp with time zone'),
 ('manager_locations','manager_id','uuid'),
 ('manager_locations','location_id','uuid')
), columns_checked as (
 select r.*,pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type,
  coalesce(pg_catalog.format_type(a.atttypid,a.atttypmod)=r.expected_type,false) compatible
 from required r left join pg_namespace n on n.nspname='public'
 left join pg_class c on c.relnamespace=n.oid and c.relname=r.table_name
 left join pg_attribute a on a.attrelid=c.oid and a.attname=r.column_name and a.attnum>0 and not a.attisdropped
), old_rpc as (
 select p.*,pg_get_function_result(p.oid) result_type
 from pg_proc p where p.oid=to_regprocedure('public.dashboard_mtd_performance(uuid[],date,date)')
), source_tables as (
 select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in('daily_logs','budget_targets','budget_daily_entries')
), helper_evidence as (
 select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,
  p.prosecdef security_definer,p.proconfig settings,p.proacl::text acl,
  md5(pg_get_functiondef(p.oid)) definition_md5,pg_get_functiondef(p.oid) definition
 from pg_proc p where p.oid in (
  to_regprocedure('public.get_user_role()'),to_regprocedure('public.user_can_edit_location(uuid)'),
  to_regprocedure('public.user_can_manage_location(uuid)'),to_regprocedure('public.current_user_role()'),
  to_regprocedure('public.user_manages_location(uuid)'))
), scoped_policies as (
 select tablename,policyname,permissive,roles,cmd,qual,with_check
 from pg_policies where schemaname='public' and tablename in('daily_logs','budget_targets','budget_daily_entries')
)
select jsonb_build_object(
 'expected_project','tm-opsperformance / qbdvixxooofdlfurcpqy (confirm in Dashboard)',
 'session',jsonb_build_object('database',current_database(),'user',current_user),
 'requirements',jsonb_build_object(
  'required_column_types_match',(select bool_and(compatible) from columns_checked),
  'new_rpc_absent',to_regprocedure('public.dashboard_membership_snapshots(uuid[],date,date)') is null,
  'target_site_month_unique',exists(select 1 from pg_index i where i.indrelid=to_regclass('public.budget_targets') and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null and i.indnkeyatts=2 and (select array_agg(a.attname::text order by a.attname) from unnest(i.indkey::smallint[]) with ordinality x(attnum,pos) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=x.attnum where x.pos<=i.indnkeyatts)=array['location_id','target_month']),
  'snapshot_site_date_unique',exists(select 1 from pg_index i where i.indrelid=to_regclass('public.budget_daily_entries') and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null and i.indnkeyatts=2 and (select array_agg(a.attname::text order by a.attname) from unnest(i.indkey::smallint[]) with ordinality x(attnum,pos) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=x.attnum where x.pos<=i.indnkeyatts)=array['entry_date','location_id']),
  'auth_uid_present',to_regprocedure('auth.uid()') is not null,
  'existing_rpc_matches_reviewed_body',coalesce((select md5(prosrc)='7979e2d29c8cb22e9e67b7ccd9d41a3c' from old_rpc),false),
  'existing_rpc_security_and_execution',coalesce((select pg_get_userbyid(proowner)='postgres' and prosecdef
    and provolatile='s' and proconfig=array['search_path=""']
    and has_function_privilege('authenticated',oid,'EXECUTE')
    and not has_function_privilege('anon',oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from old_rpc),false),
  'source_tables_rls_enabled',(select count(*)=3 and bool_and(relrowsecurity) from source_tables),
  'authenticated_daily_log_select',coalesce((select has_table_privilege('authenticated',oid,'SELECT') from source_tables where relname='daily_logs'),false),
  'postgres_can_read_dependencies',(select count(*)=6 and bool_and(has_table_privilege('postgres',c.oid,'SELECT')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('budget_targets','budget_daily_entries','daily_logs','locations','user_profiles','manager_locations'))
 ),
 'columns',(select jsonb_agg(to_jsonb(c) order by table_name,column_name) from columns_checked c),
 'existing_rpc',(select jsonb_build_object('signature',oid::regprocedure::text,'owner',pg_get_userbyid(proowner),
  'security_definer',prosecdef,'settings',proconfig,'acl',proacl::text,'body_md5',md5(prosrc),'result_type',result_type) from old_rpc),
 'unique_keys',(select jsonb_agg(jsonb_build_object('table',k.conrelid::regclass::text,'definition',pg_get_constraintdef(k.oid)) order by k.conrelid::regclass::text,k.conname)
  from pg_constraint k where k.conrelid in(select oid from source_tables) and k.contype in('p','u')),
 'table_security',(select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl::text,
  'authenticated_select',has_table_privilege('authenticated',oid,'SELECT'),
  'authenticated_insert',has_table_privilege('authenticated',oid,'INSERT'),
  'authenticated_update',has_table_privilege('authenticated',oid,'UPDATE'),
  'authenticated_delete',has_table_privilege('authenticated',oid,'DELETE')) order by relname) from source_tables),
 'scoped_policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from scoped_policies p),
 'authorization_helpers',(select jsonb_agg(to_jsonb(h) order by signature) from helper_evidence h),
 'postgres_function_default_acls',(select coalesce(jsonb_agg(jsonb_build_object('schema',coalesce(n.nspname,'GLOBAL'),'acl',a.defaclacl::text) order by n.nspname nulls first),'[]'::jsonb)
  from pg_default_acl a left join pg_namespace n on n.oid=a.defaclnamespace
  where a.defaclrole='postgres'::regrole and a.defaclobjtype='f' and (a.defaclnamespace=0 or n.nspname='public')),
 'review_note','All requirements must pass; confirm unique (location_id,target_month), unique (location_id,entry_date), and scoped authorization evidence against the previously accepted inventory. Existing trusted service_role execution defaults are not a new exposure. The reviewed migration changes no existing policies, helpers, table grants or data.'
) as pr27_production_compatibility;
