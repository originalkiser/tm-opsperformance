-- REVIEW ONLY. Prospective Opening publication; separate release authorization required.
begin;
do $$ begin
 if not exists(select 1 from checklist_private.photo_rollout where singleton and enforced) then raise exception 'Activate the verified photo backend before publishing the Opening template'; end if;
 if not exists(select 1 from public.checklist_templates where key='opening' and version=1 and jsonb_array_length(definition)=31
 and (select jsonb_agg(i order by ord) from jsonb_array_elements(definition) with ordinality x(i,ord) where i->>'id' in ('opening-9','opening-10')) = $baseline$[{"id": "opening-9", "text": "Check entry trap door (pull grates), inspect carriage for proper tension", "type": "completion", "options": ["Completed", "Not Completed"], "section": "Tunnel Inspection", "critical": true, "na_allowed": false, "instruction": "", "failure_values": ["Not Completed"], "photo_required": false}, {"id": "opening-10", "text": "Check exit trap door (pull grates) for signs of air leaks or debris", "type": "completion", "options": ["Completed", "Not Completed"], "section": "Tunnel Inspection", "critical": true, "na_allowed": false, "instruction": "", "failure_values": ["Not Completed"], "photo_required": false}]$baseline$::jsonb)
 then raise exception 'Opening baseline differs; review replacement before applying'; end if;
end; $$;
update public.checklist_templates set definition=(select jsonb_agg(case i->>'id'
 when 'opening-9' then i || $entry${"text": "Remove the front grate(s) and inspect the entry trap door and carriage for proper tension. Listen for any air leaks.", "photo_required": true, "instruction": "Photo must clearly show the inspected components with the grate(s) removed."}$entry$::jsonb
 when 'opening-10' then i || $exit${"text": "Remove the last two grates at the tunnel exit. Inspect the exit trap door, sprockets for wear and proper alignment, and the HECO drive for chemical leaks or debris.", "photo_required": true, "instruction": "Photo must clearly show the inspected components with the grate(s) removed."}$exit$::jsonb
 else i end order by ord) from jsonb_array_elements(definition) with ordinality x(i,ord)),version=version+1,updated_at=clock_timestamp() where key='opening';
-- No Weekly PM, audit, saved snapshot, draft, submission, signature or evidence is rewritten.
commit;
