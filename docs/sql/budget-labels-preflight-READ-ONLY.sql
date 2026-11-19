-- Metadata/fingerprints only. Do not emit account identifiers or operational values.
begin read only;
select jsonb_build_object(
 'capabilities',count(*),
 'active_admin_capabilities',count(*) filter(where p.role='admin' and p.is_active and p.deleted_at is null),
 'approved_roster_matches',md5(string_agg(to_jsonb(c)::text,'' order by to_jsonb(c)::text))='29a89b695f2a06c63727fa16a7bdc000'
) as roster from configuration_private.super_admins c join public.user_profiles p on p.id=c.user_id;
select jsonb_build_object(
 'authorization_source_matches',(select md5(prosrc)='d617e3c7623317ca18f2eb3612f941da' from pg_proc where oid='configuration_private.is_super_admin(uuid)'::regprocedure),
 'labels_absent',to_regclass('configuration_private.budget_labels') is null,
 'history_absent',to_regclass('configuration_private.budget_label_history') is null,
 'reader_absent',to_regprocedure('public.budget_tracker_labels()') is null,
 'editor_absent',to_regprocedure('public.budget_tracker_label_editor(text,text,integer,text,text)') is null
) as installation;
select 'budget_daily_entries' as source,count(*),md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) as fingerprint from public.budget_daily_entries t
union all select 'budget_targets',count(*),md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) from public.budget_targets t
union all select 'checklist_templates',count(*),md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) from public.checklist_templates t
union all select 'checklist_submissions',count(*),md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) from public.checklist_submissions t
union all select 'checklist_attachments',count(*),md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) from public.checklist_attachments t;
commit;
