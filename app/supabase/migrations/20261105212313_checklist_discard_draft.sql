-- Development/review only. Freeze first, Storage API cleanup second, finish last.
-- No SQL deletion of Storage metadata or evidence. Existing pilot permissions remain authoritative.
begin;
alter table public.checklist_submissions drop constraint checklist_submissions_status_check;
alter table public.checklist_submissions add constraint checklist_submissions_status_check
 check(status in ('draft','discarding','submitted'));

create function public.begin_discard_checklist(p_id uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.checklist_submissions;
begin
 select * into strict s from public.checklist_submissions where id=p_id for update;
 if (checklist_private.active_admin() or (s.created_by=auth.uid() and checklist_private.can_access(s.location_id,s.period_date))) is not true then
  raise exception 'Authorized draft access required';
 end if;
 if s.status='submitted' then raise exception 'Submitted checklists cannot be discarded'; end if;
 if s.status='draft' then
  if p_revision is distinct from s.revision then raise exception 'Draft changed elsewhere. Reload before discarding'; end if;
  update public.checklist_submissions set status='discarding',revision=revision+1,updated_at=clock_timestamp() where id=s.id returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'status',s.status);
end;
$$;

create function public.finish_discard_checklist(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.checklist_submissions; actor_name text;
begin
 select * into strict s from public.checklist_submissions where id=p_id for update;
 if (checklist_private.active_admin() or (s.created_by=auth.uid() and checklist_private.can_access(s.location_id,s.period_date))) is not true then
  raise exception 'Authorized draft access required';
 end if;
 if s.status<>'discarding' then raise exception 'Draft must be frozen before cleanup'; end if;
 if exists(select 1 from storage.objects where bucket_id='manager-checklist-evidence' and starts_with(name,s.id::text||'/')) then
  raise exception 'Private evidence cleanup is not complete';
 end if;
 select name into actor_name from public.user_profiles where id=auth.uid();
 insert into public.edit_audit_log(table_name,location_id,period,changed_by,changed_by_name,summary,old_values,new_values)
 values('checklist_submissions',s.location_id,s.period_date,auth.uid(),coalesce(actor_name,''),'Checklist draft discarded',
  jsonb_build_object('id',s.id,'template_key',s.template_key,'created_by',s.created_by,'revision',s.revision),null);
 delete from public.checklist_attachments where submission_id=s.id;
 delete from public.checklist_submissions where id=s.id;
end;
$$;
revoke all on function public.begin_discard_checklist(uuid,integer),public.finish_discard_checklist(uuid) from public,anon,authenticated;
grant execute on function public.begin_discard_checklist(uuid,integer),public.finish_discard_checklist(uuid) to authenticated;

-- Storage completion may write as its service role after an earlier authorization probe.
-- Lock/check on the final metadata INSERT too, so an in-flight upload cannot commit
-- after the discard freeze. Supabase handles rejected-upload byte cleanup via its API.
create function checklist_private.guard_evidence_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare draft_status text;
begin
 if new.bucket_id is distinct from 'manager-checklist-evidence' then return new; end if;
 select status into draft_status from public.checklist_submissions where id::text=split_part(new.name,'/',1) for share;
 if draft_status is distinct from 'draft' then raise exception 'Checklist draft is unavailable for uploads'; end if;
 return new;
end;
$$;
revoke all on function checklist_private.guard_evidence_insert() from public,anon,authenticated;
create trigger checklist_evidence_draft_insert before insert on storage.objects
 for each row execute function checklist_private.guard_evidence_insert();
notify pgrst,'reload schema';
commit;
