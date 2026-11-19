import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration = await readFile(new URL('../../app/supabase/migrations/20261119162120_drb_sales_reconciliation.sql',import.meta.url),'utf8')
const reviewer='00000000-0000-0000-0000-000000000001', admin='00000000-0000-0000-0000-000000000002', store='00000000-0000-0000-0000-000000000003', site='00000000-0000-0000-0000-000000000010', employee='00000000-0000-0000-0000-000000000020'
const db=new PGlite()
after(()=>db.close())
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table public.user_profiles(id uuid primary key,role text,is_active boolean,deleted_at timestamptz);
create table public.locations(id uuid primary key,site_code text);
create table public.employees(id uuid primary key,location_id uuid,name text);
insert into public.user_profiles values('${reviewer}','admin',true,null),('${admin}','admin',true,null),('${store}','store',true,null);
insert into public.locations values('${site}','1508');insert into public.employees values('${employee}','${site}','Fictional Employee');`)
await db.exec(migration)
async function login(id, role='authenticated') { await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec(`set role ${role}`) }
async function rpc(action,payload={}) { return (await db.query('select public.drb_reconciliation($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result }
const row=(extra={})=>({site_code:'1508',sale_id:'100',log_date:'2026-11-10',item:'Membership',employee_identifier:'1234567890',commission:'5',customer_name:'Fictional Customer',customer_phone:'5550100000',source_note:'Source annotation retained without interpretation',...extra})
const batch=(kind,hash,rows=[row()])=>({kind,file_hash:hash.repeat(64),start_date:'2026-11-08',end_date:'2026-11-14',rows})
let mappingId,saleId,revision=0

test('all new tables use RLS and the exposed API cannot elevate anonymous access',async()=>{
 const tables=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='reconciliation_private' and c.relkind='r'")).rows
 assert.equal(tables.length,6);assert.ok(tables.every(t=>t.relrowsecurity))
 const f=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.drb_reconciliation(text,jsonb)'::regprocedure")).rows[0];assert.equal(f.prosecdef,false);assert.ok(f.proconfig.includes('search_path=\"\"'))
})
test('installation grants nobody; anonymous, Store and ordinary Admin cannot bypass private RPC or tables',async()=>{
 assert.equal((await db.query('select count(*)::int n from reconciliation_private.reviewers')).rows[0].n,0)
 for(const id of [reviewer,admin,store]) {await login(id);await assert.rejects(rpc('read',{start:'2026-11-08',end:'2026-11-14'}),/reviewer required/);await assert.rejects(db.exec('select * from reconciliation_private.observations'),/permission denied/);await assert.rejects(db.query("select reconciliation_private.api('status','{}')"),/reviewer required/)}
 await login('', 'anon');await assert.rejects(rpc('status'),/permission denied/)
 await db.exec('reset role');await db.exec(`insert into reconciliation_private.reviewers(user_id) values('${reviewer}')`)
 await login(reviewer)
})
test('original and reviewed imports remain separate, overlap deduplicates and repeat bytes are idempotent',async()=>{
 await rpc('import',batch('original','a'));const repeat=await rpc('import',batch('original','a'));assert.equal(repeat.repeat,true)
 await assert.rejects(rpc('import',batch('original','a',[row({item:'Different'})])),/different content/)
 await rpc('import',batch('original','b'));await rpc('import',batch('reviewed','c'))
 const result=await rpc('read',{start:'2026-11-08',end:'2026-11-14'});assert.equal(result.sales.length,1);saleId=result.sales[0].id
 assert.equal(result.sales[0].observations.length,3);assert.equal(result.sales[0].decision,'pending');assert.equal(result.sales[0].employee_id,null)
 await assert.rejects(rpc('import',batch('original','d',[row(),row()])),/line identifier/)
 await assert.rejects(rpc('import',batch('original','e',[row({item:'Different'})])),/identity conflict/)
 await assert.rejects(rpc('import',batch('original','f',[row({employee_identifier:'9999999999'})])),/Conflicting source/)
 await assert.rejects(rpc('import',{...batch('original','f'),rows:[{...row(),privateNote:'not allowed'}]}),/Invalid transaction/)
})
test('mapping requires explicit proposal and approval, exact roster/site and no overlap',async()=>{
 await assert.rejects(rpc('review_sale',{id:saleId,revision,decision:'eligible',activity:'new',identity_confirmed:true,reason:'Reviewed'}),/approved employee mapping/)
 await assert.rejects(rpc('propose_mapping',{location_id:site,identifier:'7890',employee_id:employee,start_date:'2026-11-01',end_date:'2026-11-30',reason:'Do not infer suffix'}),/check constraint/)
 const m=await rpc('propose_mapping',{location_id:site,identifier:'1234567890',employee_id:employee,start_date:'2026-11-01',end_date:'2026-11-30',reason:'Verified external identifier using roster record'});mappingId=m.id
 await rpc('decide_mapping',{id:m.id,revision:0,status:'approved',reason:'Explicit verification'})
 const second=await rpc('propose_mapping',{location_id:site,identifier:'1234567890',employee_id:employee,start_date:'2026-11-10',end_date:'2026-11-20',reason:'Overlapping candidate'})
 await assert.rejects(rpc('decide_mapping',{id:second.id,revision:0,status:'approved',reason:'Overlap'}),/Overlapping/)
})
test('eligibility is explicit, optimistic revisions conflict, exclusion reasons and immutable audit retained',async()=>{
 await assert.rejects(rpc('review_sale',{id:saleId,revision,decision:'eligible',activity:'new',identity_confirmed:false,reason:'Missing identity'}),/Confirm transaction identity/)
 const saved=await rpc('review_sale',{id:saleId,revision,decision:'eligible',activity:'new',identity_confirmed:true,reason:'Sara confirmed eligible sale'});assert.equal(saved.decision,'eligible');revision=saved.revision
 await assert.rejects(rpc('review_sale',{id:saleId,revision:0,decision:'excluded',activity:'replacement',identity_confirmed:true,reason:'Stale'}),/changed/)
 await rpc('import',batch('original','9'));assert.equal((await rpc('read',{start:'2026-11-08',end:'2026-11-14'})).sales[0].decision,'eligible')
 const excluded=await rpc('review_sale',{id:saleId,revision,decision:'excluded',activity:'replacement',identity_confirmed:true,reason:'Active membership replaced'});revision=excluded.revision
 const result=await rpc('read',{start:'2026-11-08',end:'2026-11-14'});assert.equal(result.sales[0].reason,'Active membership replaced');assert.ok(result.audit.some(a=>a.previous?.decision==='eligible'&&a.next?.decision==='excluded'))
 await assert.rejects(db.exec('delete from reconciliation_private.audit'),/permission denied/)
})
test('shortened reviewed identifiers never reconstruct identity or earn eligibility',async()=>{
 await rpc('import',batch('original','1',[row({sale_id:'101'})]));await rpc('import',batch('reviewed','2',[row({sale_id:'101',employee_identifier:'7890'})]))
 const sale=(await rpc('read',{start:'2026-11-08',end:'2026-11-14'})).sales.find(s=>s.sale_id==='101')
 assert.equal(sale.decision,'pending');assert.equal(sale.employee_id,employee)
 await assert.rejects(rpc('review_sale',{id:sale.id,revision:0,decision:'eligible',activity:'new',identity_confirmed:true,reason:'Attempt'}),/exclusion evidence/)
})
test('repeat customer search is private, cross-period, and names never change decisions',async()=>{
 const matches=await rpc('customer_matches',{id:saleId});assert.equal(matches.matches.length,1);assert.equal(matches.matches[0].name_match,true);assert.equal(matches.matches[0].phone_match,true)
 const sales=(await rpc('read',{start:'2026-11-08',end:'2026-11-14'})).sales;assert.equal(sales.find(s=>s.sale_id==='101').decision,'pending')
 await login(admin);await assert.rejects(rpc('customer_matches',{id:saleId}),/reviewer required/);await login(reviewer)
})
test('withdrawn mapping approval invalidates eligibility; deactivated reviewer denied immediately',async()=>{
 await rpc('review_sale',{id:saleId,revision,decision:'eligible',activity:'new',identity_confirmed:true,reason:'Reviewed again'})
 await rpc('decide_mapping',{id:mappingId,revision:1,status:'rejected',reason:'Identity verification withdrawn'})
 const sale=(await rpc('read',{start:'2026-11-08',end:'2026-11-14'})).sales.find(s=>s.id===saleId);assert.equal(sale.decision,'pending');assert.equal(sale.employee_id,null)
 await db.exec('reset role');await db.exec(`update public.user_profiles set is_active=false where id='${reviewer}'`);await login(reviewer)
 await assert.rejects(rpc('status'),/reviewer required/)

})
