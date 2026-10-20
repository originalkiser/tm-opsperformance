-- Run only after confirming Dashboard project tm-opsperformance / qbdvixxooofdlfurcpqy.
-- This query cannot establish project identity. Metadata only; no application records.
-- Save the result before installation; rerun unchanged after installation to compare.
begin transaction read only;
set local statement_timeout='15s';
set local lock_timeout='3s';
select jsonb_build_object(
 'postgres_version',current_setting('server_version_num'),
 'daily_logs',(select jsonb_build_object('kind',relkind,'rls',relrowsecurity,'forced_rls',relforcerowsecurity,'owner',pg_get_userbyid(relowner),'acl',relacl::text) from pg_class where oid=to_regclass('public.daily_logs')),
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.daily_logs') and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) order by conname) from pg_constraint where conrelid=to_regclass('public.daily_logs')),
 'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='daily_logs'),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'function_definition',pg_get_functiondef(t.tgfoid)) order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.daily_logs') and not t.tgisinternal),
 'authorization_helpers',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_user_role','user_can_edit_location','guard_daily_plans_lost')),
 'feature_constraint_name_collision',exists(select 1 from pg_constraint where conrelid=to_regclass('public.daily_logs') and conname='daily_logs_plans_lost_once')
) as plans_lost_compatibility;
commit;
