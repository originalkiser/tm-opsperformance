-- NOT EXECUTED. Run only in verified production project qbdvixxooofdlfurcpqy.
-- Connection/project header verification is mandatory; SQL cannot authenticate a project ref.
-- Private output: account UUIDs are included only to support explicit migration decisions.
-- No names, email addresses, Auth records, credentials or operational values are selected.
-- Includes inactive and deleted profiles. Missing columns are a compatibility STOP, not a reason to improvise.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

select role, is_active, (deleted_at is not null) as is_deleted, count(*) as profile_count
from public.user_profiles
group by role, is_active, (deleted_at is not null)
order by role nulls first, is_active, is_deleted;

with legacy as (
 select id,location_id from public.user_profiles where role='area_manager'
), effective_sites as (
 select id as profile_id,location_id from legacy where location_id is not null
 union
 select l.id,m.location_id from legacy l join public.manager_locations m on m.manager_id=l.id
)
select (select count(*) from legacy) as legacy_accounts,
 (select count(*) from legacy where location_id is not null) as accounts_with_primary_site,
 (select count(*) from public.manager_locations m join legacy l on l.id=m.manager_id) as additional_assignment_rows,
 (select count(*) from effective_sites) as effective_account_site_pairs,
 (select count(distinct location_id) from effective_sites) as affected_sites,
 (select count(*) from legacy l where not exists(select 1 from effective_sites e where e.profile_id=l.id)) as unassigned_legacy_accounts,
 (select count(*) from public.user_profiles where role is null or role not in ('admin','store','area_manager')) as other_unresolved_roles;

select p.id as account_id,p.role,p.is_active,(p.deleted_at is not null) as is_deleted,
 p.location_id as primary_location_id,
 coalesce((select jsonb_agg(m.location_id order by m.location_id)
  from public.manager_locations m where m.manager_id=p.id),'[]'::jsonb) as additional_location_ids
from public.user_profiles p where p.role='area_manager'
order by p.id;

with effective_sites as (
 select p.id as profile_id,p.location_id from public.user_profiles p
 where p.role='area_manager' and p.location_id is not null
 union
 select p.id,m.location_id from public.user_profiles p
 join public.manager_locations m on m.manager_id=p.id where p.role='area_manager'
)
select e.location_id,l.site_code,count(*) as affected_legacy_accounts
from effective_sites e left join public.locations l on l.id=e.location_id
group by e.location_id,l.site_code order by l.site_code,e.location_id;

-- Security/schema metadata in the same read-only snapshot.
select current_database(),current_user,current_setting('server_version') as server_version;
select table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns where table_schema='public'
order by table_name,ordinal_position;
select c.relname as object_name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
 pg_get_userbyid(c.relowner) as owner,c.relacl::text as acl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p','v','m','S') order by c.relname;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' order by tablename,policyname;
select c.relname as table_name,k.conname,k.contype,pg_get_constraintdef(k.oid,true) as definition
from pg_constraint k join pg_class c on c.oid=k.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' order by c.relname,k.conname;
select c.relname as table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) as definition,
 p.oid::regprocedure::text as function_signature,md5(pg_get_functiondef(p.oid)) as function_hash
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname;
select p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,
 p.prosecdef,p.provolatile,p.proconfig,p.proacl::text as acl,
 pg_get_function_result(p.oid) as result_type,md5(pg_get_functiondef(p.oid)) as definition_hash,
 (pg_get_functiondef(p.oid) ilike '%area_manager%') as references_legacy_role,
 case when p.proname in ('get_user_role','user_can_edit_location','user_can_manage_location',
 'protect_profile_privileged_columns','dashboard_mtd_performance','audit_cash_on_hand',
 'audit_daily_cash','stamp_cash_on_hand','reconcile_daily_cash') then pg_get_functiondef(p.oid) end as reviewed_definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind in ('f','p') order by signature;
select grantee,table_name,privilege_type from information_schema.table_privileges
where table_schema='public' order by table_name,grantee,privilege_type;
select grantee,table_name,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' order by table_name,column_name,grantee,privilege_type;
select defaclrole::regrole::text as owner,defaclnamespace::regnamespace::text as schema_name,
 defaclobjtype,defaclacl::text as acl from pg_default_acl order by 1,2,3;
select schemaname,viewname,md5(definition) as definition_hash,
 (definition ilike '%area_manager%') as references_legacy_role
from pg_views where schemaname='public' order by viewname;
commit;
