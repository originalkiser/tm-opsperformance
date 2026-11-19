-- Metadata only; use role-context/no-op or rolled-back authorization checks separately.
begin read only;
select count(*) as fixed_fields,count(*) filter(where revision<>0 or label<>default_label or helper<>default_helper) as changed_wording from configuration_private.budget_labels;
select count(*) as initial_audit_records from configuration_private.budget_label_history;
select count(*) as capability_count from configuration_private.super_admins;
select n.nspname,p.proname,md5(p.prosrc),p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
 has_function_privilege('service_role',p.oid,'execute') service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('read_budget_labels','budget_label_editor','budget_tracker_labels','budget_tracker_label_editor') order by 1,2;
select c.relname,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_table_access,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') authenticated_table_access,
 has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') service_table_access
from pg_class c where c.oid in ('configuration_private.budget_labels'::regclass,'configuration_private.budget_label_history'::regclass);
commit;
