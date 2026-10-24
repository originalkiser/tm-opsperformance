-- PREPARED, Authorized isolated tests only. psql-only, separately approved disposable LOCAL DB.
-- This suite WILL apply draft DDL to the guarded synthetic fixture if authorized.
-- It is deliberately NOT part of npm/node test automation and never links remote.
\set ON_ERROR_STOP on
\ir employee-identity-foundation.fixture.sql
\ir ../../supabase/migrations/20261024222502_employee_identity_foundation.sql

begin;
do $tests$
declare before_rows jsonb; after_rows jsonb; before_policies jsonb; after_policies jsonb;
begin
  select logs into before_rows from public.fixture_before;
  select jsonb_agg(to_jsonb(d) order by id) into after_rows from public.daily_logs d;
  if before_rows is distinct from after_rows then raise exception 'Migration changed raw historical rows'; end if;
  select policies into before_policies from public.fixture_policies;
  select jsonb_agg(to_jsonb(p) order by tablename,policyname) into after_policies
    from pg_policies p where schemaname='public' and tablename in ('employees','daily_logs');
  if before_policies is distinct from after_policies then raise exception 'RLS policies changed'; end if;

  -- Metric edits preserve both a prior ID and original recorded name.
  update public.daily_logs set total_washes=101 where id='30000000-0000-0000-0000-000000000002';
  if not exists(select 1 from public.daily_logs where id='30000000-0000-0000-0000-000000000002'
      and employee_id='20000000-0000-0000-0000-000000000001' and employee_name='Original name') then
    raise exception 'Existing ID/name was not retained';
  end if;
  insert into public.daily_logs(id,location_id,log_date,time_slot,total_washes) values
    ('30000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','2026-10-21','08:00',102)
    on conflict(location_id,log_date,time_slot,split_index) do update set total_washes=excluded.total_washes;
  if not exists(select 1 from public.daily_logs where id='30000000-0000-0000-0000-000000000002'
      and employee_id='20000000-0000-0000-0000-000000000001' and total_washes=102) then
    raise exception 'Legacy checkpoint upsert lost preexisting ID';
  end if;
  begin
    update public.daily_logs set employee_id='20000000-0000-0000-0000-000000000001' where id='30000000-0000-0000-0000-000000000001';
    raise exception 'NULL-to-ID assignment accepted';
  exception when check_violation then null; end;
  begin
    update public.daily_logs set employee_id=null where id='30000000-0000-0000-0000-000000000002';
    raise exception 'ID clearing accepted';
  exception when check_violation then null; end;
  begin
    update public.daily_logs set employee_id='20000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000002';
    raise exception 'ID reassignment accepted';
  exception when check_violation then null; end;
  begin
    insert into public.daily_logs(id,location_id,employee_id,log_date,time_slot) values
      ('30000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-22','08:00');
    raise exception 'New ID insert accepted';
  exception when check_violation then null; end;
  begin
    update public.daily_logs set location_id='10000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000002';
    raise exception 'Cross-site employee reference accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.employees set location_id='10000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000001';
    raise exception 'Employee location changed';
  exception when check_violation then null; end;
  begin
    update public.employees set id='20000000-0000-0000-0000-000000000099' where id='20000000-0000-0000-0000-000000000001';
    raise exception 'Employee UUID changed';
  exception when check_violation then null; end;
  begin
    delete from public.employees where id='20000000-0000-0000-0000-000000000001';
    raise exception 'Referenced employee deleted';
  exception when foreign_key_violation then null; end;

  -- Current legacy split saves and checkpoint upserts continue to work.
  insert into public.daily_logs(id,location_id,log_date,time_slot,split_index,employee_name) values
    ('30000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','2026-10-20','08:00',1,'Cam');
  insert into public.daily_logs(id,location_id,log_date,time_slot,split_index,employee_name,total_washes) values
    ('30000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','2026-10-20','08:00',1,'Cam',20)
    on conflict(location_id,log_date,time_slot,split_index) do update set total_washes=excluded.total_washes;
  if (select count(*) from public.daily_logs where log_date='2026-10-20' and split_index=1)<>1 then raise exception 'Checkpoint upsert duplicated activity'; end if;
  delete from public.daily_logs where id='30000000-0000-0000-0000-000000000011';

  -- Structural future compatibility only: privileged bypass is confined to a
  -- synthetic subtransaction and rolled back. NOT a production enablement path.
  begin
    alter table public.daily_logs disable trigger guard_daily_employee_assignment_phase1;
    insert into public.daily_logs(id,location_id,employee_id,log_date,time_slot,split_index) values
      ('30000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-21','08:00',1);
    begin
      insert into public.daily_logs(id,location_id,employee_id,log_date,time_slot,split_index) values
        ('30000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-21','08:00',1);
      raise exception 'Duplicate checkpoint accepted';
    exception when unique_violation then null; end;
    begin
      insert into public.daily_logs(id,location_id,employee_id,log_date,time_slot,split_index) values
        ('30000000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','2026-10-21','08:00',2);
      raise exception 'Same-location FK bypassed';
    exception when foreign_key_violation then null; end;
    raise exception using errcode='ZX001',message='Roll back privileged synthetic bypass';
  exception when sqlstate 'ZX001' then null; end;
  if not exists(select 1 from pg_trigger where tgrelid='public.daily_logs'::regclass and tgname='guard_daily_employee_assignment_phase1' and tgenabled='O') then raise exception 'Test bypass leaked'; end if;

  -- Existing daily-loss protection still fires with both triggers installed.
  insert into public.daily_logs(id,location_id,log_date,time_slot,plans_lost_today) values
    ('30000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000001','2026-10-24','08:00',2);
  begin
    delete from public.daily_logs where id='30000000-0000-0000-0000-000000000030';
    raise exception 'Daily-loss anchor deleted';
  exception when raise_exception then
    if sqlerrm<>'Daily plans lost must be retained; set losses to zero instead' then raise; end if;
  end;
end;
$tests$;
rollback;

-- Check an allowed legacy write versus an unauthorized location under RLS.
begin;
set local role authenticated;
insert into public.daily_logs(id,location_id,log_date,time_slot,employee_name) values
 ('30000000-0000-0000-0000-000000000040','10000000-0000-0000-0000-000000000001','2026-10-23','08:00','Cam');
do $$ begin
  begin
    insert into public.daily_logs(id,location_id,log_date,time_slot,employee_name) values
      ('30000000-0000-0000-0000-000000000041','10000000-0000-0000-0000-000000000002','2026-10-23','08:00','Cam');
    raise exception 'Fixture RLS location restriction bypassed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- Remaining unexecuted scenarios are separate sessions: migration timeout while
-- a writer holds a lock, concurrent FK/key edits, schema-drift refusal, and
-- rollback refusal with preexisting IDs / successful rollback in an all-NULL
-- fixture. See the runbook; none is replaced by static syntax checks.
