-- Confirm Dashboard tm-opsperformance / qbdvixxooofdlfurcpqy independently.
-- Metadata only. Reuses PR #22 schema/security evidence; no operational records.
-- Before installation matches_predecessor must be true; afterward matches_replacement must be true.
select p.oid::regprocedure::text as function_name, pg_get_userbyid(p.proowner) as owner,
 p.prosecdef as security_definer, p.proconfig as settings, p.proacl::text as function_acl,
 md5(p.prosrc) as installed_body_md5,
 md5(p.prosrc)='f3350f1af813bdd2d759936643f2fe01' as matches_predecessor,
 md5(p.prosrc)='6f054b665fc27c35e307ee9f0c5b1458' as matches_replacement,
 (select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)))
  from pg_trigger where tgrelid='public.daily_logs'::regclass and tgname='guard_daily_plans_lost') as guard_trigger
from pg_proc p where p.oid=to_regprocedure('public.guard_daily_plans_lost()');
