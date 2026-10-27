#!/usr/bin/env python3
"""Run only in the same explicitly reset local fixture as validate_permissions.py."""
import runpy,sys,json,threading,time
from pathlib import Path
state=runpy.run_path(str(Path(__file__).with_name('validate_permissions.py')))
q,connect=state['q'],state['conn'];c=connect();A,B=state['A'],state['B'];actors=state['actors']
q(c,"insert into employees(location_id,name,is_active) values(%s,'Cam',true),(%s,' CAM ',false)",(A,A))
migration=next((Path(__file__).resolve().parents[2]/'supabase/migrations').glob('*_employee_roster_names_and_review.sql'))
q(c,migration.read_text());q(c,'grant select on user_profiles to authenticated');results=[]
def begin(w,actor=2,isolation='read committed'):
 q(w,'begin isolation level '+isolation);q(w,'set local role authenticated');q(w,"select set_config('request.jwt.claim.sub',%s,true)",(actors[actor],))
def probe(name,sql,args=(),expected=None,actor=2,isolation='read committed',commit=False):
 begin(c,actor,isolation)
 try:actual=q(c,sql,args)
 except Exception as e:actual=getattr(e,'pgcode',str(e))
 finally:q(c,'commit' if commit and not isinstance(actual,str) else 'rollback')
 if expected is not None:assert actual==expected,(name,actual,expected)
 results.append({'case':name,'pass':True});return actual
insert='insert into employees(location_id,name) values(%s,%s)'
probe('inactive_or_active_normalized_duplicate',insert,(A,'\t cAm \n'),'23505')
probe('blank_name',insert,(A,'\t\n'),'23514')
probe('unicode_trim_duplicate',insert,(A,'\u00a0CAM\ufeff'),'23505')
probe('same_name_other_site',insert,(B,'Cam'),1,actor=1)
probe('legacy_duplicate_status_edit',"update employees set is_active=false where name='Cam'",expected=1)
probe('legacy_duplicate_case_edit',"update employees set name='cam' where name='Cam'",expected=1)
probe('rename_collision',"update employees set name='cam' where name='Existing'",expected='23505')
probe('repeatable_read_new_names_refuse',insert,(A,'Snapshot'),'25000',isolation='repeatable read')
probe('serializable_new_names_refuse',insert,(A,'Snapshot'),'25000',isolation='serializable')
probe('snapshot_status_edit_allowed',"update employees set is_active=false where name='Existing'",expected=1,isolation='repeatable read')
probe('new_name_trimmed',insert,(A,' \tTrimmed\n'),1,commit=True)
assert q(c,"select name from employees where name='Trimmed'")==[('Trimmed',)]

def race(label,first_sql,first_args,second_sql,second_args):
 first=connect();begin(first);q(first,first_sql,first_args);out={}
 def worker():
  w=connect();begin(w)
  try:q(w,second_sql,second_args);q(w,'commit');out['state']='unexpected success'
  except Exception as e:out['state']=e.pgcode;q(w,'rollback')
  finally:w.close()
 thread=threading.Thread(target=worker);thread.start();time.sleep(.15);assert not out
 q(first,'commit');first.close();thread.join(5);assert not thread.is_alive();assert out['state']=='23505',out
 results.append({'case':label,'pass':True})
race('concurrent_insert_fresh_snapshot',insert,(A,'Race'),insert,(A,' RACE '))
probe('seed_rename_one',insert,(A,'One'),1,commit=True);probe('seed_rename_two',insert,(A,'Two'),1,commit=True)
race('concurrent_rename_fresh_snapshot',"update employees set name='New Race' where name='One'",(),"update employees set name=' new race ' where name='Two'",())
ids=[x[0] for x in q(c,"select id from employees where location_id=%s and lower(btrim(name))='cam' order by id",(A,))]
snapshot=q(c,"select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active)) from employees where id=any(%s::uuid[])",(ids,))[0][0]
review='select review_employee_duplicates(%s,%s::uuid[],%s,true,'+"'"+json.dumps(snapshot)+"'::jsonb)"
probe('manager_cannot_review',review,(A,ids,ids[0]),'42501')
probe('admin_confirmation_required',review.replace('true,','false,'),(A,ids,ids[0]),'42501',actor=1)
probe('repeated_ids_refuse',review,(A,[ids[0],ids[0]],ids[0]),'22023',actor=1)
probe('missing_primary_refuse',review,(A,ids,'99999999-9999-4999-8999-999999999999'),'22023',actor=1)
other=q(c,'select id from employees where location_id=%s',(B,))[0][0]
probe('cross_site_selection_refuse',review,(A,[ids[0],other],ids[0]),'22023',actor=1)
original=q(c,'select id,name,location_id from employees order by id');logs=q(c,'select * from daily_logs')
probe('stale_review_refuses',review.replace('Cam','Changed'),(A,ids,ids[0]),'40001',actor=1)
probe('atomic_admin_review',review,(A,ids,ids[0]),[(2,)],actor=1,commit=True)
assert q(c,'select id,name,location_id from employees order by id')==original
assert q(c,'select * from daily_logs')==logs
assert q(c,'select count(*) from employees where id=any(%s::uuid[]) and is_active',(ids,))[0][0]==1
results.append({'case':'original_rows_and_daily_logs_retained','pass':True})
report={'environment':'isolated PostgreSQL 17.6','tests':len(results),'results':results}
Path(state['a'].output).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));c.close()
