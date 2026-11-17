#!/usr/bin/env python3
# Requires psycopg2-binary==2.9.11 and pglast==7.21 in an isolated Python environment.
# Explicit reset consent + Unix-socket/server-path checks precede all destructive SQL.
import sys,time,json,re,threading,uuid
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description='Destructive disposable LOCAL identity database validation; never production')
parser.add_argument('--socket',required=True)
parser.add_argument('--port',type=int,required=True)
parser.add_argument('--expected-data-directory',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--reset-disposable-db',action='store_true',required=True)
args=parser.parse_args()
for path in (args.socket,args.expected_data_directory):
 if not Path(path).resolve().is_relative_to('/private/tmp'):raise SystemExit('Only private /private/tmp clusters permitted')
import psycopg2,pglast
BASE=Path(__file__).resolve().parents[3]
SOCKET=args.socket;PORT=args.port;USER='identity_test_admin';DB='tm_identity_foundation_test'
MIG=next((BASE/'app/supabase/migrations').glob('*_employee_identity_foundation.sql'))
ROLLBACK=BASE/'docs/sql/employee-identity-foundation-ROLLBACK-REVIEW-ONLY.sql'
results=[]
def connect(db=DB):
 c=psycopg2.connect(host=SOCKET,port=PORT,dbname=db,user=USER);c.autocommit=True;return c
def q(c,s,args=None):
 with c.cursor() as cur:
  cur.execute(s,args)
  return cur.fetchall() if cur.description else None
def execute_sql(c,text):
 for statement in pglast.split(text):q(c,statement)
def execute_file(c,path):
 buffer=[]
 for line in path.read_text().splitlines():
  if line.startswith('\\ir '):
   execute_sql(c,'\n'.join(buffer));buffer=[];execute_file(c,(path.parent/line[4:].strip()).resolve())
  elif not line.startswith('\\'):buffer.append(line)
 execute_sql(c,'\n'.join(buffer))
def reset(null_ids=False):
 a=connect('postgres')
 assert q(a,"select current_setting('data_directory'),inet_server_addr()")[0]==(args.expected_data_directory,None)
 q(a,"select pg_terminate_backend(pid) from pg_stat_activity where datname=%s and pid<>pg_backend_pid()",(DB,))
 q(a,'DROP DATABASE IF EXISTS '+DB);q(a,'CREATE DATABASE '+DB);a.close()
 c=connect();execute_file(c,BASE/'app/tests/sql/employee-identity-foundation.fixture.sql')
 if null_ids:q(c,'update public.daily_logs set employee_id=null')
 return c

def snapshot(c):
 return q(c,"""select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(d) order by id) from daily_logs d),
 'employees',(select jsonb_agg(to_jsonb(e) order by id) from employees e),
 'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid in ('public.employees'::regclass,'public.daily_logs'::regclass)),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
 'guards',(select jsonb_agg(pg_get_functiondef(oid) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname like 'guard_%'))""")[0][0]
def expect_error(c,sql,state):
 try:execute_sql(c,sql)
 except psycopg2.Error as e:
  q(c,'ROLLBACK')
  assert e.pgcode==state,(e.pgcode,str(e));return str(e).split('\n')[0]
 raise AssertionError('Expected SQLSTATE '+state)
def case(name,fn):
 t=time.monotonic();detail=fn();r={'case':name,'pass':True,'seconds':round(time.monotonic()-t,4),'detail':detail};results.append(r);Path(args.output).write_text(json.dumps(results,indent=2));print(json.dumps(r),flush=True)

def prepared_suite():
 c=reset();c.close()
 # Suite creates its own fixture, so start fresh empty database again.
 a=connect('postgres');q(a,'DROP DATABASE '+DB);q(a,'CREATE DATABASE '+DB);a.close()
 c=connect();execute_file(c,BASE/'app/tests/sql/employee-identity-foundation.regression.sql');c.close();return 'Prepared migration + functional/RLS/PlansLost suite passed'
def rollback_suite():
 c=reset();c.close();a=connect('postgres');q(a,'DROP DATABASE '+DB);q(a,'CREATE DATABASE '+DB);a.close()
 c=connect();execute_file(c,BASE/'app/tests/sql/employee-identity-foundation.rollback.sql');c.close();return 'All-NULL rollback suite passed'
def refusal():
 c=reset();execute_file(c,MIG);before=snapshot(c)
 msg=expect_error(c,ROLLBACK.read_text(),'P0001');assert snapshot(c)==before
 q(c,"update daily_logs set total_washes=total_washes+1 where id='30000000-0000-0000-0000-000000000001'")
 expect_error(c,"update daily_logs set employee_id=null where employee_id is not null",'23514')
 assert q(c,'select count(*) from daily_logs where employee_id is not null')[0][0]==1
 c.close();return msg+'; legacy metric edits and assignment guards remain operational'
def reapply():
 c=reset();execute_file(c,MIG);before=snapshot(c);msg=expect_error(c,MIG.read_text(),'P0001');assert snapshot(c)==before;c.close();return msg
def bad_existing():
 c=reset();q(c,"update employees set location_id='10000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000001'")
 before=snapshot(c);msg=expect_error(c,MIG.read_text(),'23503');assert snapshot(c)==before;c.close();return msg
def comment_drift():
 c=reset();q(c,"comment on constraint daily_logs_employee_id_fkey on daily_logs is 'existing meaningful comment'")
 before=snapshot(c);msg=expect_error(c,MIG.read_text(),'P0001');assert snapshot(c)==before;c.close();return msg
def body_drift():
 c=reset(True);execute_file(c,MIG)
 q(c,"create or replace function public.guard_employee_key_phase1() returns trigger language plpgsql security invoker set search_path='' as $$begin return new; end$$")
 before=snapshot(c);msg=expect_error(c,ROLLBACK.read_text(),'P0001');assert snapshot(c)==before;c.close();return msg
def lock_timeout():
 c=reset();before=snapshot(c);hold=connect();q(hold,'BEGIN');q(hold,"update daily_logs set total_washes=101 where id='30000000-0000-0000-0000-000000000001'")
 t=time.monotonic();msg=expect_error(c,MIG.read_text(),'55P03');elapsed=time.monotonic()-t
 q(hold,'ROLLBACK');hold.close();assert snapshot(c)==before;assert 1.8<elapsed<3.5
 execute_file(c,MIG);c.close();return {'expected_lock_timeout_seconds':round(elapsed,4),'message':msg,'retry_after_release':'pass'}
def queued_writers():
 c=reset();stmts=list(pglast.split(MIG.read_text()))
 for s in stmts[:-1]:q(c,s)
 output={}
 def writer(key,hasid):
  w=connect();q(w,"set lock_timeout='4s'")
  sql="insert into daily_logs(id,location_id,log_date,time_slot,employee_name"+(',employee_id' if hasid else '')+") values(%s,'10000000-0000-0000-0000-000000000001','2026-10-23',%s,'Cam'"+(",'20000000-0000-0000-0000-000000000001'" if hasid else '')+")"
  t=time.monotonic()
  try:q(w,sql,(str(uuid.uuid4()),'10:00' if hasid else '09:00'));output[key]={'state':'ok','seconds':round(time.monotonic()-t,4)}
  except psycopg2.Error as e:output[key]={'state':e.pgcode,'seconds':round(time.monotonic()-t,4)}
  finally:w.close()
 threads=[threading.Thread(target=writer,args=('legacy',False)),threading.Thread(target=writer,args=('nonnull_id',True))]
 for th in threads:th.start()
 time.sleep(.25);assert output=={},output
 q(c,stmts[-1])
 for th in threads:th.join(6);assert not th.is_alive()
 assert output['legacy']['state']=='ok' and output['nonnull_id']['state']=='23514',output
 assert q(c,"select count(*) from daily_logs where log_date='2026-10-23'")[0][0]==1;c.close();return output

def rls_matrix():
 c=reset();execute_file(c,BASE/'app/tests/sql/employee-identity-foundation.rls-fixture.sql')
 def probe(actor,site,kind='legacy',role='authenticated'):
  q(c,'BEGIN');q(c,'SET LOCAL ROLE '+role)
  q(c,"select set_config('request.jwt.claim.sub',%s,true)",(actor or '',))
  try:
   if kind=='roster_rename':
    q(c,"update employees set name='Synthetic renamed' where location_id=%s",(site,))
    count=q(c,"select count(*) from employees where location_id=%s and name='Synthetic renamed'",(site,))[0][0]
    outcome='allowed' if count else 'no_rows'
   else:
    sql="insert into daily_logs(id,location_id,log_date,time_slot,employee_name"+(',employee_id' if kind=='id' else '')+") values(%s,%s,'2026-10-23','12:00','Cam'"+(",'20000000-0000-0000-0000-000000000001'" if kind=='id' else '')+")"
    q(c,sql,(str(uuid.uuid4()),site));outcome='allowed'
  except psycopg2.Error as e:outcome=e.pgcode
  finally:q(c,'ROLLBACK')
  return outcome
 A='10000000-0000-0000-0000-000000000001';B='10000000-0000-0000-0000-000000000002'
 cases=[('admin_B','40000000-0000-0000-0000-000000000001',B,'legacy','authenticated','allowed'),
 ('assigned_manager_A','40000000-0000-0000-0000-000000000002',A,'legacy','authenticated','allowed'),
 ('assigned_manager_B','40000000-0000-0000-0000-000000000002',B,'legacy','authenticated','42501'),
 ('unassigned_manager_A','40000000-0000-0000-0000-000000000003',A,'legacy','authenticated','42501'),
 ('store_A','40000000-0000-0000-0000-000000000004',A,'legacy','authenticated','allowed'),
 ('store_B','40000000-0000-0000-0000-000000000004',B,'legacy','authenticated','42501'),
 ('disabled_store_legacy_gap','40000000-0000-0000-0000-000000000005',A,'legacy','authenticated','allowed'),
 ('deleted_store_legacy_gap','40000000-0000-0000-0000-000000000006',A,'legacy','authenticated','allowed'),
 ('manager_roster_cross_scope_legacy_gap','40000000-0000-0000-0000-000000000003',B,'roster_rename','authenticated','allowed'),
 ('anon',None,A,'legacy','anon','42501'),
 ('service_role',None,A,'legacy','service_role','allowed')]
 before={name:probe(actor,site,kind,role) for name,actor,site,kind,role,_ in cases}
 execute_file(c,MIG)
 after={name:probe(actor,site,kind,role) for name,actor,site,kind,role,_ in cases}
 for name,actor,site,kind,role,expected in cases:assert before[name]==after[name]==expected,(name,before[name],after[name],expected)
 id_guards={}
 for name,actor,site,kind,role,_ in cases:
  if name in ['admin_B','assigned_manager_A','store_A','service_role']:
   id_guards[name]=probe(actor,A,'id',role);assert id_guards[name]=='23514'
 c.close();return {'legacy_policy_cases':len(cases),'before_equals_after':True,'id_assignment_denied':id_guards,'legacy_gaps_preserved_not_repaired':['disabled/deleted store helper checks','manager roster scope']}

def benchmark():
 out=[]
 for n in [24512,100000]:
  c=reset();q(c,'alter table daily_logs disable trigger guard_daily_plans_lost')
  q(c,"""insert into daily_logs(id,location_id,log_date,time_slot,split_index,employee_name,total_washes,best)
    select gen_random_uuid(),'10000000-0000-0000-0000-000000000001',date '2030-01-01'+(g/13)::integer,
    time '08:00'+mod(g,13)*interval '1 hour',0,'Synthetic',10*mod(g,13),mod(g,13) from generate_series(1,%s) g""",(n,))
  q(c,'alter table daily_logs enable trigger guard_daily_plans_lost');q(c,'analyze employees');q(c,'analyze daily_logs')
  size=q(c,"select pg_total_relation_size('daily_logs')")[0][0]
  t=time.monotonic();execute_file(c,MIG);elapsed=time.monotonic()-t
  out.append({'synthetic_rows':n+2,'daily_logs_bytes_before':size,'blocking_ddl_seconds':round(elapsed,4)})
  c.close()
 return out

def preflight_read_only():
 c=reset();before=snapshot(c)
 execute_file(c,BASE/'docs/sql/employee-identity-foundation-preflight-READ-ONLY.sql')
 assert snapshot(c)==before
 c.close();return 'All three inventory SELECTs execute in READ ONLY transaction; no data/schema differences'

def rollback_wrong_role():
 c=reset(True);execute_file(c,MIG);before=snapshot(c)
 q(c,'SET ROLE service_role')
 msg=expect_error(c,ROLLBACK.read_text(),'P0001')
 q(c,'RESET ROLE');assert snapshot(c)==before
 c.close();return msg+'; rejection precedes table lock request'

case('rollback_scope_gate_before_locks',rollback_wrong_role)
case('reviewed_preflight_read_only',preflight_read_only)
case('prepared_regressions',prepared_suite)
case('all_null_rollback',rollback_suite)
case('nonnull_id_rollback_refuses_without_mutation',refusal)
case('reapplication_refuses_without_mutation',reapply)
case('cross_site_preexisting_id_aborts_atomically',bad_existing)
case('constraint_comment_drift_refuses',comment_drift)
case('rollback_guard_body_drift_refuses',body_drift)
case('busy_writer_lock_timeout_and_retry',lock_timeout)
case('queued_legacy_and_id_writers',queued_writers)
case('production_policy_reproduction_parity',rls_matrix)
case('synthetic_lock_benchmarks',benchmark)
Path(args.output).write_text(json.dumps(results,indent=2))
