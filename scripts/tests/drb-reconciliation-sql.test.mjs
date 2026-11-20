// Actual in-memory Postgres, fictional identities only; never contacts production.
import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration=await readFile(new URL('../../app/supabase/migrations/20261119162120_drb_sales_reconciliation.sql',import.meta.url),'utf8')
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const reviewer=id(1),admin=id(2),store=id(3),site=id(10),otherSite=id(11),employee=id(20),otherEmployee=id(21)
const db=new PGlite();after(()=>db.close())
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table public.user_profiles(id uuid primary key,role text,is_active boolean,deleted_at timestamptz);
create table public.locations(id uuid primary key,site_code text);
create table public.employees(id uuid primary key,location_id uuid,name text,is_active boolean);
create table public.daily_logs(id integer primary key,memberships_sold integer);insert into public.daily_logs values(1,42);
insert into public.user_profiles values('${reviewer}','admin',true,null),('${admin}','admin',true,null),('${store}','store',true,null);
insert into public.locations values('${site}','1508'),('${otherSite}','1511');
insert into public.employees values('${employee}','${site}','Fictional Historical Employee',false),('${otherEmployee}','${otherSite}','Fictional Other Employee',true);`)
await db.exec(migration)
async function login(who=reviewer,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec(`set role ${role}`)}
async function root(sql,args=[]){await db.exec('reset role');const r=await db.query(sql,args);await login();return r.rows}
const rpc=async(action,payload={})=>(await db.query('select public.drb_reconciliation($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result
const row=(extra={})=>({site_code:'1508',sale_id:'100',log_date:'2026-11-10',item:'Membership',employee_identifier:'0200000012',commission:'5',...extra})
const rows=[row(),row({sale_id:'101',employee_identifier:'200000012'}),row({sale_id:'102',employee_identifier:'0012'}),row({sale_id:'103',employee_identifier:'9900000012'}),row({sale_id:'104',employee_identifier:''}),row({sale_id:'105',employee_identifier:'arbitrary unusual value'}),row({sale_id:'106',employee_identifier:'0200009999'})]
const batch=(hash,data=rows,extra={})=>({kind:'weekly',file_hash:hash.repeat(64),start_date:'2026-11-08',end_date:'2026-11-14',rows:data,...extra})
const read=()=>rpc('read',{start:'2026-11-08',end:'2026-11-14'})
const proposal=(extra={})=>({location_id:site,identifier:'0012',adp_badge:'0200000012',adp_reference:'Fictional authoritative ADP roster v1',employee_id:employee,start_date:'2026-11-01',end_date:'2026-11-30',reason:'Verified unique badge and historical UUID',...extra})
let mapping,batchId

test('installation grants nobody; new RLS tables contain no customer fields or raw source documents',async()=>{
 assert.equal((await db.query('select count(*)::int n from reconciliation_private.reviewers')).rows[0].n,0)
 const tables=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='reconciliation_private' and c.relkind='r'")).rows;assert.equal(tables.length,6);assert.ok(tables.every(t=>t.relrowsecurity))
 const cols=(await db.query("select column_name from information_schema.columns where table_schema='reconciliation_private'")).rows.map(c=>c.column_name)
 for(const forbidden of ['customer_name','customer_phone','source_note','document','raw_file'])assert.ok(!cols.includes(forbidden))
 const f=(await db.query("select prosecdef from pg_proc where oid='public.drb_reconciliation(text,jsonb)'::regprocedure")).rows[0];assert.equal(f.prosecdef,false)
})
test('ordinary Admin, Store, anonymous and direct private calls cannot import or complete a period',async()=>{
 for(const who of [reviewer,admin,store]){await login(who);for(const action of ['read','import','complete_review'])await assert.rejects(rpc(action,{}),/reviewer required/);await assert.rejects(db.exec('select * from reconciliation_private.observations'),/permission denied/);await assert.rejects(db.exec("select reconciliation_private.api('status','{}')"),/reviewer required/)}
 await login('','anon');await assert.rejects(rpc('status'),/permission denied/)
 await root(`insert into reconciliation_private.reviewers(user_id) values('${reviewer}')`)
})
test('server rejects customer fields and completion spoofing before any record is saved',async()=>{
 for(const forbidden of ['customer_name','customer_phone','source_note','Legal Name'])await assert.rejects(rpc('import',batch('f',[row({[forbidden]:'DO NOT STORE'})])),/Invalid transaction/)
 await assert.rejects(rpc('import',{...batch('f'),review_completed_by:reviewer}),/Unexpected import/)
 assert.equal((await read()).sales.length,0)
})
test('one weekly export accepts unusual/missing IDs; exclusion is independent of attribution',async()=>{
 const imported=await rpc('import',batch('a'));batchId=imported.batch_id
 const data=await read();assert.equal(data.sales.length,7);assert.deepEqual(data.sales.map(s=>s.identifier_classification),['retained','retained','excluded','unresolved','unresolved','unresolved','retained'])
 assert.deepEqual(data.sales.map(s=>s.commission_status),['pending','pending','excluded','pending','pending','pending','pending'])
 assert.ok(data.sales.every(s=>s.employee_id===null&&s.review_complete===false));assert.deepEqual(data.sales.map(s=>s.observations[0].employee_identifier),rows.map(r=>r.employee_identifier))
 assert.equal(data.batches[0].review_completed_at,null)
})
test('same file and semantic repeats are idempotent; changed/overlapping periods cannot silently replace a reviewed snapshot',async()=>{
 const initial=(await read()).audit.length
 assert.equal((await rpc('import',batch('a'))).repeat,true);assert.equal((await rpc('import',batch('b',[...rows].reverse()))).repeat,true)
 assert.equal((await read()).audit.length,initial);assert.equal((await read()).sales.length,7)
 await assert.rejects(rpc('import',batch('a',[row()])),/different content/)
 await assert.rejects(rpc('import',batch('c',[row()])),/different export already/)
 await assert.rejects(rpc('import',batch('d',[row()],{start_date:'2026-11-09',end_date:'2026-11-15'})),/periods overlap/)
})
test('duplicate or reused transaction identity is blocked atomically without invented line keys',async()=>{
 const next=row({log_date:'2026-11-17'})
 await assert.rejects(rpc('import',batch('d',[next,next],{start_date:'2026-11-15',end_date:'2026-11-21'})),/line identifier/)
 await assert.rejects(rpc('import',batch('e',[next],{start_date:'2026-11-15',end_date:'2026-11-21'})),/identity conflict/)
 assert.equal((await read()).batches.length,1)
})
test('ADP evidence and explicit approval required; both full formats and excluded IDs match inactive historical employee',async()=>{
 await assert.rejects(rpc('propose_mapping',proposal({adp_badge:'0200009999'})),/check constraint/)
 await assert.rejects(rpc('propose_mapping',proposal({adp_reference:''})),/check constraint/)
 mapping=await rpc('propose_mapping',proposal());assert.ok((await read()).sales.every(s=>s.employee_id===null))
 await rpc('decide_mapping',{id:mapping.id,revision:0,status:'approved',reason:'Verified authoritative ADP crosswalk'})
 assert.deepEqual((await read()).sales.map(s=>s.employee_id),[employee,employee,employee,null,null,null,null])
 assert.equal((await read()).sales[0].commission_status,'pending')
})
test('Review Complete requires explicit consent and fresh revision; completion audits once and unlocks only matched retained IDs',async()=>{
 await assert.rejects(rpc('complete_review',{batch_id:batchId,revision:0,confirm_reviewed:false}),/Confirm Sara/)
 await assert.rejects(rpc('complete_review',{batch_id:batchId,revision:99,confirm_reviewed:true}),/period changed/)
 await assert.rejects(rpc('complete_review',{batch_id:batchId,revision:0,confirm_reviewed:true,actor:admin}),/Confirm Sara/)
 await rpc('complete_review',{batch_id:batchId,revision:0,confirm_reviewed:true})
 const data=await read();assert.deepEqual(data.sales.map(s=>s.commission_status),['eligible','eligible','excluded','pending','pending','pending','pending'])
 assert.equal(data.batches[0].review_completed_by,reviewer);assert.ok(data.batches[0].review_completed_at)
 assert.equal(data.audit.filter(a=>a.action==='complete_review').length,1)
 await assert.rejects(rpc('complete_review',{batch_id:batchId,revision:0,confirm_reviewed:true}),/period changed/)
 await rpc('complete_review',{batch_id:batchId,revision:1,confirm_reviewed:true});assert.equal((await read()).audit.filter(a=>a.action==='complete_review').length,1)
 await assert.rejects(rpc('review_sale',{}),/Unknown reconciliation/);await assert.rejects(rpc('customer_matches',{}),/Unknown reconciliation/)
 await assert.rejects(db.exec('update reconciliation_private.batches set review_completed_at=null'),/permission denied/)
 await assert.rejects(db.exec('delete from reconciliation_private.audit'),/permission denied/)
})
test('ambiguous crosswalk keys never select arbitrary employee; historical dates and approval withdrawal remove eligibility immediately',async()=>{
 const second=await rpc('propose_mapping',proposal({location_id:otherSite,employee_id:otherEmployee}))
 await assert.rejects(rpc('decide_mapping',{id:second.id,revision:0,status:'approved',reason:'Conflicting key'}),/Overlapping/)
 await root("update reconciliation_private.employee_mappings set status='approved' where id=$1",[second.id])
 assert.equal((await read()).sales[0].employee_id,null);assert.equal((await read()).sales[0].commission_status,'pending')
 await root("update reconciliation_private.employee_mappings set status='rejected' where id=$1",[second.id])
 await root("update reconciliation_private.employee_mappings set end_date='2026-11-09' where id=$1",[mapping.id]);assert.equal((await read()).sales[0].employee_id,null)
 await root("update reconciliation_private.employee_mappings set end_date='2026-11-30' where id=$1",[mapping.id]);assert.equal((await read()).sales[0].commission_status,'eligible')
 await rpc('decide_mapping',{id:mapping.id,revision:1,status:'rejected',reason:'Crosswalk verification withdrawn'})
 assert.deepEqual((await read()).sales.slice(0,3).map(s=>s.commission_status),['pending','pending','excluded'])
})
test('revocation blocks reads and completion; Daily Logs and user roles remain unchanged',async()=>{
 const logs=await root('select * from public.daily_logs');assert.deepEqual(logs,[{id:1,memberships_sold:42}])
 await root('update public.user_profiles set is_active=false where id=$1',[reviewer])
 await assert.rejects(read(),/reviewer required/);await assert.rejects(rpc('complete_review',{batch_id:batchId,revision:1,confirm_reviewed:true}),/reviewer required/)
 const roles=await root('select role from public.user_profiles order by id');assert.deepEqual(roles.map(r=>r.role),['admin','admin','store'])
})
