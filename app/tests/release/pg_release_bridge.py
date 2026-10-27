#!/usr/bin/env python3
"""Synthetic local SQL adapter; NOT an Auth/PostgREST test or production client."""
import sys,json,psycopg2
from psycopg2 import sql
DB='tm_roster_release_writer_test';HOST='/private/tmp/tmid176-sock';PORT=55438;USER='identity_test_admin'
A='10000000-0000-0000-0000-000000000001';ACTOR='40000000-0000-0000-0000-000000000002'
r=json.load(sys.stdin)
c=psycopg2.connect(host=HOST,port=PORT,user=USER,dbname=DB)
try:
 with c.cursor() as cur:
  cur.execute("select current_setting('data_directory'),inet_server_addr()")
  assert cur.fetchone()==('/private/tmp/tmid176-pgdata',None)
  if r['action']=='reset':cur.execute('truncate public.daily_logs');result={'data':[],'error':None}
  else:
   assert r['table'] in ('employees','daily_logs')
   cur.execute('set local role authenticated');cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(ACTOR,))
   filters=r.get('filters',[]);args=[v for k,v in filters]
   where=sql.SQL(' and ').join(sql.SQL('{} is not distinct from %s').format(sql.Identifier(k)) for k,v in filters) if filters else sql.SQL('true')
   if r.get('emptyName'):where+=sql.SQL(" and (employee_name is null or employee_name='')")
   table=sql.Identifier('public',r['table']);action=r['action'];body=r.get('body',{})
   if action=='select':cur.execute(sql.SQL('select * from {} where {} order by id').format(table,where),args)
   elif action=='delete':cur.execute(sql.SQL('delete from {} where {} returning *').format(table,where),args)
   elif action=='update':
    fields=sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(k)) for k in body)
    cur.execute(sql.SQL('update {} set {} where {} returning *').format(table,fields,where),list(body.values())+args)
   else:
    assert action in ('insert','upsert') and r['table']=='daily_logs'
    fields=sql.SQL(',').join(map(sql.Identifier,body));values=sql.SQL(',').join(sql.Placeholder() for k in body)
    statement=sql.SQL('insert into {} ({}) values ({})').format(table,fields,values)
    if action=='upsert':statement+=sql.SQL(' on conflict(location_id,log_date,time_slot,split_index) do update set ')+sql.SQL(',').join(sql.SQL('{}=excluded.{}').format(sql.Identifier(k),sql.Identifier(k)) for k in body)
    cur.execute(statement+sql.SQL(' returning *'),list(body.values()))
   rows=[dict(zip([d.name for d in cur.description],v)) for v in cur.fetchall()]
   result={'data':rows,'count':len(rows),'error':None}
 c.commit()
except Exception as e:
 c.rollback();result={'data':None,'error':{'code':getattr(e,'pgcode','XX000'),'message':str(e)}}
finally:c.close()
print(json.dumps(result,default=str))
