#!/usr/bin/env python3
"""Destructive LOCAL synthetic test only. psycopg2-binary==2.9.11.
Fixed disposable database; Unix socket + exact server data-dir checked before reset.
No production/project credentials, remote hosts or identity-foundation SQL allowed.
"""
import argparse,json,time
from pathlib import Path
import psycopg2
p=argparse.ArgumentParser()
p.add_argument('--reset-disposable-db',action='store_true',required=True)
p.add_argument('--socket',required=True)
p.add_argument('--port',type=int,required=True)
p.add_argument('--data-directory',required=True)
p.add_argument('--output',required=True)
a=p.parse_args()
for value in [a.socket,a.data_directory]:
    if not Path(value).resolve().is_relative_to('/private/tmp'):raise SystemExit('Only disposable /private/tmp paths permitted')
DB='tm_roster_permissions_test';USER='identity_test_admin'
def conn(db=DB):
    c=psycopg2.connect(host=a.socket,port=a.port,user=USER,dbname=db);c.autocommit=True;return c
def q(c,s,args=None):
    with c.cursor() as cur:
        cur.execute(s,args)
        return cur.fetchall() if cur.description else cur.rowcount
c=conn('postgres')
assert q(c,"select current_setting('data_directory'),inet_server_addr(),current_user")[0]==(a.data_directory,None,USER)
q(c,'DROP DATABASE IF EXISTS '+DB);q(c,'CREATE DATABASE '+DB);c.close();c=conn()
q(c,"""
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz);
create table manager_locations(manager_id uuid,location_id uuid);
create table employees(id uuid primary key default gen_random_uuid(),location_id uuid not null,name text not null,is_active boolean default true);
create table daily_logs(id integer,employee_name text,employee_id uuid);
insert into daily_logs values(1,'Historical Cam',null);
create function get_user_role() returns text language sql stable security definer as $$select role from user_profiles where id=auth.uid()$$;
alter table employees enable row level security;
create policy employees_select on employees for select to authenticated using(true);
create policy employees_write on employees for all to authenticated using(get_user_role() = any(array['admin'::text,'area_manager'::text]));
grant all on employees to anon,authenticated,service_role;
insert into employees(id,location_id,name) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Existing'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other');
""")
A='10000000-0000-0000-0000-000000000001';B='10000000-0000-0000-0000-000000000002'
actors={}
for n,(role,loc,active,deleted) in enumerate([
('admin',None,True,None),('store',A,True,None),('store',B,True,None),
('area_manager',None,True,None),('area_manager',None,True,None),
('store',A,False,None),('store',A,True,'2026-01-01'),('other',A,True,None),('admin',None,False,None)],1):
    uid=f'40000000-0000-0000-0000-{n:012d}';actors[n]=uid
    q(c,'insert into user_profiles values(%s,%s,%s,%s,%s)',(uid,role,loc,active,deleted))
for loc in [A,B]:q(c,'insert into manager_locations values(%s,%s)',(actors[4],loc))
def snapshot():
    return q(c,"select (select jsonb_agg(to_jsonb(d)) from daily_logs d),(select pg_get_functiondef('get_user_role()'::regprocedure))")[0]
before=snapshot()
sql=next((Path(__file__).resolve().parents[2]/'supabase/migrations').glob('*_employee_roster_permissions.sql')).read_text()
q(c,sql);assert snapshot()==before
results=[]
def probe(label,actor,sql,args=(),expected=1,role='authenticated'):
    q(c,'BEGIN');q(c,'SET LOCAL ROLE '+role);q(c,"select set_config('request.jwt.claim.sub',%s,true)",(actors.get(actor,''),))
    try:
        value=q(c,sql,args)
        actual=value if isinstance(value,int) else len(value)
    except psycopg2.Error as e:actual=e.pgcode
    finally:q(c,'ROLLBACK')
    assert actual==expected,(label,actual,expected)
    results.append({'case':label,'pass':True})
insert='insert into employees(location_id,name,is_active) values(%s,\'Synthetic\',true)'
for label,actor,loc,want in [
('admin_all_locations',1,B,1),('store_own',2,A,1),('store_other',2,B,'42501'),
('manager_first_assignment',4,A,1),('manager_second_assignment',4,B,1),
('unassigned_manager',5,A,'42501'),('inactive_store',6,A,'42501'),
('deleted_store',7,A,'42501'),('unknown_role',8,A,'42501'),
('inactive_admin',9,B,'42501'),('missing_profile',0,A,'42501')]:
    probe(label,actor,insert,(loc,),want)
probe('unauthenticated',0,insert,(A,),'42501','anon')
probe('store_rename',2,'update employees set name=\'Renamed\' where location_id=%s',(A,))
probe('store_deactivate',2,'update employees set is_active=false where location_id=%s',(A,))
probe('store_reactivate',2,'update employees set is_active=true where location_id=%s',(A,))
probe('store_cannot_update_other',2,'update employees set name=\'No\' where location_id=%s',(B,),0)
probe('admin_status_other',1,'update employees set is_active=false where location_id=%s',(B,))
for actor in [1,2,4]:
    probe(f'no_delete_{actor}',actor,'delete from employees',expected='42501')
    probe(f'no_move_{actor}',actor,'update employees set location_id=%s',(B,),'42501')
    probe(f'no_key_change_{actor}',actor,'update employees set id=gen_random_uuid()',expected='42501')
    probe(f'no_custom_key_insert_{actor}',actor,'insert into employees(id,location_id,name) values(gen_random_uuid(),%s,\'No\')',(A,),'42501')
    probe(f'no_truncate_{actor}',actor,'truncate employees',expected='42501')
probe('historical_roster_read_preserved',2,'select * from employees',expected=2)
q(c,'delete from manager_locations where manager_id=%s',(actors[4],))
probe('assignment_revocation_immediate',4,insert,(A,),'42501')
try:q(c,sql);raise AssertionError('reapplication unexpectedly succeeded')
except psycopg2.Error as e:
    assert e.pgcode=='P0001';q(c,'ROLLBACK')
results.append({'case':'reapplication_refuses_atomically','pass':True})
assert snapshot()==before
assert q(c,'select count(*) from employees')[0][0]==2
results.append({'case':'historical_logs_shared_helper_and_existing_roster_preserved','pass':True})
report={'environment':'isolated PostgreSQL '+q(c,'show server_version')[0][0],'tests':len(results),'results':results}
Path(a.output).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));c.close()
