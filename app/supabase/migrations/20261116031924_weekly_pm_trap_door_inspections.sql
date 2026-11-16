-- REVIEW ONLY. Separate prospective template release, after explicit backend activation approval.
begin;
do $$ begin
 if not exists(select 1 from checklist_private.photo_rollout where singleton and enforced) then raise exception 'Activate the verified photo backend before publishing the PM template'; end if;
end; $$;

do $$
begin
 if not exists(select 1 from public.checklist_templates where key='weekly_pm' and exists(select 1 from jsonb_array_elements(definition) i where i->>'id'='weekly-pm-conveyer-10' and i->>'text'='Inspect trap doors! Are they in good condition and are the bolts tight?')) then raise exception 'Weekly PM baseline differs; review replacement before applying'; end if;
end;
$$;
update public.checklist_templates set definition=(select jsonb_agg(entry order by position) from (
 select entry,ordinality::numeric position from jsonb_array_elements(definition) with ordinality x(entry,ordinality) where entry->>'id'<>'weekly-pm-conveyer-10'
 union all select value,(select max(ordinality) from jsonb_array_elements(definition) with ordinality x(entry,ordinality) where entry->>'section'='Tunnel Equipment')+ordinality::numeric/10
 from jsonb_array_elements($photos$[{"id": "weekly-pm-tunnel-entry-trap-door", "section": "Tunnel Equipment", "number": 28, "text": "Remove the front grate(s) and inspect the entry trap door and carriage for proper tension. Listen for any air leaks. Check the trap door’s condition and confirm its bolts are tight.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": true, "instruction": "Photo must clearly show the inspected components with the grate(s) removed.", "na_allowed": false}, {"id": "weekly-pm-tunnel-exit-trap-door", "section": "Tunnel Equipment", "number": 29, "text": "Remove the last two grates at the tunnel exit. Inspect the exit trap door, sprockets for wear and proper alignment, and the HECO drive for chemical leaks or debris. Check the trap door’s condition and confirm its bolts are tight.", "type": "completion", "options": ["Completed", "Not Completed"], "failure_values": ["Not Completed"], "critical": true, "photo_required": true, "instruction": "Photo must clearly show the inspected components with the grate(s) removed.", "na_allowed": false}]$photos$::jsonb) with ordinality
 ) prospective),version=version+1,updated_at=clock_timestamp() where key='weekly_pm';
-- No submission, snapshot, answer, version, signature, Storage object or policy is rewritten.
commit;
