// Actual in-memory Postgres; fictional data only. No production connection.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
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
insert into public.user_profiles values('${reviewer}','admin',true,null),('${admin}','admin',true,null),('${store}','store',true,null);
insert into public.locations values('${site}','1508'),('${otherSite}','1511');
insert into public.employees values('${employee}','${site}','Fictional Historical Employee',false),('${otherEmployee}','${otherSite}','Fictional Other Employee',true);`)
await db.exec(migration)
async function login(who=reviewer,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec(`set role ${role}`)}
async function root(sql,args=[]){await db.exec('reset role');const r=await db.query(sql,args);await login();return r.rows}
const rpc=async(action,payload={})=>(await db.query('select public.drb_reconciliation($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result
const row=(extra={})=>({site_code:'1508',sale_id:'100',log_date:'2026-11-10',item:'Membership',employee_identifier:'0200000012',commission:'5',customer_name:'Fictional Customer',customer_phone:'5550100000',source_note:'Preserved source note',...extra})
const batch=(hash,rows=[row()])=>({kind:'weekly',file_hash:hash.repeat(64),start_date:'2026-11-08',end_date:'2026-11-14',rows})
const read=()=>rpc('read',{start:'2026-11-08',end:'2026-11-14'})
const proposal=(extra={})=>({location_id:site,identifier:'0012',adp_badge:'0200000012',adp_reference:'Fictional authoritative ADP roster version 1',employee_id:employee,start_date:'2026-11-01',end_date:'2026-11-30',reason:'Verified badge and UUID against ADP, including inactive records',...extra})
const review=(sale,extra={})=>({id:sale.id,revision:sale.revision,decision:'eligible',activity:'new',identity_confirmed:true,reason:'Explicit verified review',...extra})
let mapping

test('zero grants, all tables RLS, ordinary Admin/Store/anonymous and direct RPC bypass denied',async()=>{
 assert.equal((await db.query('select count(*)::int n from reconciliation_private.reviewers')).rows[0].n,0)
 const tables=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='reconciliation_private' and c.relkind='r'")).rows;assert.equal(tables.length,6);assert.ok(tables.every(t=>t.relrowsecurity))
 for(const who of [reviewer,admin,store]){await login(who);await assert.rejects(read(),/reviewer required/);await assert.rejects(db.exec('select * from reconciliation_private.observations'),/permission denied/);await assert.rejects(db.exec("select reconciliation_private.api('status','{}')"),/reviewer required/)}
 await login('','anon');await assert.rejects(rpc('status'),/permission denied/)
 await root(`insert into reconciliation_private.reviewers(user_id) values('${reviewer}')`)
})
test('single weekly source preserves 10/9/4 values; classification precedes shared last-four key',async()=>{
 await rpc('import',batch('a',[row(),row({sale_id:'101',employee_identifier:'200000012'}),row({sale_id:'102',employee_identifier:'0012'}),row({sale_id:'103',employee_identifier:'9900000012'})]))
 const data=await read();assert.deepEqual(data.sales.map(s=>[s.identifier_classification,s.employee_key,s.commission_status,s.employee_id]),[['retained','0012','pending',null],['retained','0012','pending',null],['excluded','0012','excluded',null],['unresolved',null,'pending',null]])
 assert.deepEqual(data.sales.map(s=>s.observations[0].employee_identifier),['0200000012','200000012','0012','9900000012'])
 assert.ok(data.sales.every(s=>s.review_complete===false))
})
test('repeat files idempotent; overlapping rows do not double sales; conflicting raw source fails atomically',async()=>{
 const original=batch('a',[row(),row({sale_id:'101',employee_identifier:'200000012'}),row({sale_id:'102',employee_identifier:'0012'}),row({sale_id:'103',employee_identifier:'9900000012'})])
 assert.equal((await rpc('import',original)).repeat,true)
 await rpc('import',batch('b'));assert.equal((await read()).sales.length,4)
 await assert.rejects(rpc('import',batch('a')),/different content/)
 await assert.rejects(rpc('import',batch('c',[row(),row()])),/line identifier/)
 await assert.rejects(rpc('import',batch('d',[row({item:'Changed'})])),/identity conflict/)
 await assert.rejects(rpc('import',batch('e',[row({employee_identifier:'0012'})])),/Conflicting source/)
 await assert.rejects(rpc('import',{...batch('f'),review_completed_by:reviewer}),/Unexpected import/)
})
test('ADP badge evidence required; inactive/historical employee matches all three source formats after approval',async()=>{
 await assert.rejects(rpc('propose_mapping',proposal({adp_badge:'0200009999'})),/check constraint/)
 await assert.rejects(rpc('propose_mapping',proposal({adp_reference:''})),/check constraint/)
 mapping=await rpc('propose_mapping',proposal());assert.ok((await read()).sales.every(s=>s.employee_id===null))
 await rpc('decide_mapping',{id:mapping.id,revision:0,status:'approved',reason:'Verified unique ADP key, historical roster and inclusive dates'})
 const data=await read();assert.deepEqual(data.sales.map(s=>s.employee_id),[employee,employee,employee,null]);assert.equal(data.sales[2].commission_status,'excluded');assert.equal(data.sales[1].commission_status,'pending')
})
test('global conflicting employee keys cannot be approved, and unverified full-ID formats never match',async()=>{
 const second=await rpc('propose_mapping',proposal({location_id:otherSite,employee_id:otherEmployee}))
 await assert.rejects(rpc('decide_mapping',{id:second.id,revision:0,status:'approved',reason:'Same key is ambiguous across people'}),/Overlapping/)
 await assert.rejects(rpc('decide_mapping',{id:mapping.id,revision:0,status:'approved',reason:'Stale'}),/changed/)
 assert.equal((await read()).sales[3].employee_id,null)
 // Simulate conflicting authoritative crosswalk state outside the application.
 // The report must still refuse an arbitrary first match.
 await root("update reconciliation_private.employee_mappings set status='approved' where id=$1",[second.id])
 assert.ok((await read()).sales.every(s=>s.employee_id===null))
 await root("update reconciliation_private.employee_mappings set status='rejected' where id=$1",[second.id])
})
test('historical effective dates bound attribution; disjoint badge reuse does not create a collision',async()=>{
 const future=await rpc('propose_mapping',proposal({location_id:otherSite,employee_id:otherEmployee,start_date:'2026-12-01',end_date:'2026-12-31'}))
 await rpc('decide_mapping',{id:future.id,revision:0,status:'approved',reason:'Verified distinct non-overlapping historical badge assignment'})
 assert.equal((await read()).sales[0].employee_id,employee)
 await root("update reconciliation_private.employee_mappings set end_date='2026-11-09' where id=$1",[mapping.id])
 assert.equal((await read()).sales[0].employee_id,null)
 await root("update reconciliation_private.employee_mappings set end_date='2026-11-30' where id=$1",[mapping.id])
})
test('four digits cannot earn commission; retained 9/10 IDs wait for verified weekly completion',async()=>{
 const sales=(await read()).sales
 await assert.rejects(rpc('review_sale',review(sales[2])),/Sara-excluded/)
 await assert.rejects(rpc('review_sale',review(sales[3])),/Verified retained/)
 for(const sale of sales.slice(0,2))await assert.rejects(rpc('review_sale',review(sale)),/Weekly review completion/)
 await assert.rejects(rpc('complete_review',{id:1}),/Unknown reconciliation/)
 await assert.rejects(db.exec('update reconciliation_private.batches set review_completed_at=now()'),/permission denied/)
 // Fictional fixture only: no real completion/grant is performed by these tests.
 await root('update reconciliation_private.batches set review_completed_by=$1,review_completed_at=now()',[reviewer])
 for(const sale of sales.slice(0,2))await rpc('review_sale',review(sale))
 const result=await read();assert.deepEqual(result.sales.map(s=>s.commission_status),['eligible','eligible','excluded','pending'])
})
test('stale review and customer name matches cannot change eligibility; audit and raw values immutable',async()=>{
 const sales=(await read()).sales
 await assert.rejects(rpc('review_sale',review({...sales[0],revision:0})),/changed/)
 const matches=await rpc('customer_matches',{id:sales[0].id});assert.equal(matches.matches.length,3);assert.ok(matches.matches.every(s=>s.name_match))
 assert.equal((await read()).sales[2].commission_status,'excluded')
 await assert.rejects(db.exec('delete from reconciliation_private.audit'),/permission denied/)
 await assert.rejects(db.exec("update reconciliation_private.observations set employee_identifier='0012'"),/permission denied/)
 assert.ok((await read()).audit.some(a=>a.action==='review_sale'&&a.previous.decision==='pending'&&a.next.decision==='eligible'))
})
test('withdrawal invalidates eligible decisions but preserves excluded classification and gross records',async()=>{
 await rpc('decide_mapping',{id:mapping.id,revision:1,status:'rejected',reason:'ADP mapping verification withdrawn'})
 const sales=(await read()).sales;assert.equal(sales.length,4);assert.ok(sales.every(s=>s.employee_id===null));assert.deepEqual(sales.map(s=>s.commission_status),['pending','pending','excluded','pending'])
})
test('inactive reviewer immediately loses private read/write access',async()=>{
 await root('update public.user_profiles set is_active=false where id=$1',[reviewer])
 await assert.rejects(read(),/reviewer required/);await assert.rejects(rpc('import',batch('9')),/reviewer required/)
})
