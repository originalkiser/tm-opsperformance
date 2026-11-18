-- Optional safe disable: preserve capability/account protections and all history.
-- Never restore the old unguarded account endpoint or immediate-publish RPC.
begin;
revoke execute on function public.checklist_template_editor(text,text,integer,integer,jsonb,text,integer) from authenticated;
revoke execute on function configuration_private.template_editor(text,text,integer,integer,jsonb,text,integer) from authenticated;
commit;
