-- READ ONLY. Run through existing authorized production workflow, intended project qbdvixxooofdlfurcpqy.
-- No account identifiers/customer rows are returned. No schema or data changes.
begin read only;
select current_setting('server_version_num') as server_version_num;
select table_schema,table_name,column_name,data_type
from information_schema.columns where table_schema='public' and (
 (table_name='user_profiles' and column_name in ('id','role','is_active','deleted_at')) or
 (table_name='locations' and column_name in ('id','site_code','name','opportunities_formula')) or
 (table_name='employees' and column_name in ('id','location_id','name','is_active')))
order by table_name,column_name;
select to_regnamespace('reconciliation_private') is null as namespace_available,
 to_regprocedure('public.drb_reconciliation(text,jsonb)') is null as rpc_available;
select split_part(site_code,'-',1) as drb_site,count(*) as matching_locations
from public.locations where split_part(site_code,'-',1) in
 ('1508','1511','1516','1518','1519','1520','1521','1522','1524','1525','1526','1527','1530')
group by split_part(site_code,'-',1) order by drb_site;
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef as definer,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='approved_employee_name_mappings';
rollback;
