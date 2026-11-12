// Isolated in-memory PostgreSQL with fictional profiles/storage metadata only. Never contacts Supabase.
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import { checklistAccess } from '../../app/supabase/functions/checklist-access/handler.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration = readFileSync(new URL('../../app/supabase/migrations/20261105173034_manager_checklists_pilot.sql', import.meta.url), 'utf8')
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const admin=uuid(1),store=uuid(2),other=uuid(3),outsider=uuid(4),inactive=uuid(5),deleted=uuid(6),manager=uuid(7),site=uuid(10),away=uuid(11)
async function actor(db,id=admin,role='authenticated') { await db.exec(`reset role;set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']) }
async function root(db,sql,args=[]) { await db.exec('reset role');const result=await db.query(sql,args);await db.exec('set role authenticated');return result.rows }
async function setup({deadlines=true,audits=true}={}) {
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz,name text);
 create table public.locations(id uuid primary key,site_code text,timezone text,name text,market text,exclude_from_reporting boolean default false);
 create table public.manager_locations(manager_id uuid,location_id uuid);
 create table public.edit_audit_log(id uuid default gen_random_uuid(),table_name text,location_id uuid not null,period date,changed_by uuid,changed_by_name text,summary text,old_values jsonb,new_values jsonb);
 create table public.actuals(id integer primary key,value numeric);insert into public.actuals values(1,123.456);
 create table public.budget_targets(id integer primary key,goal numeric);insert into public.budget_targets values(1,987.654);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant all on storage.objects to anon,authenticated;
 -- Deliberately broad existing policies: new bucket restrictions must still deny unauthorized operations.
 create policy preexisting_permissive on storage.objects for all to anon,authenticated using(true) with check(true);
 insert into storage.buckets values('unrelated','unrelated',false,null,null);
 insert into storage.objects(bucket_id,name) values('unrelated','untouched.png');
 insert into public.locations(id,site_code,timezone) values('${site}','1000-Fictional','America/Los_Angeles'),('${away}','1001-Fictional','America/New_York');
 insert into public.user_profiles values('${admin}','admin',null,true,null,'Test Admin'),('${store}','store','${site}',true,null,'Test Store'),('${other}','store','${site}',true,null,'Other Store'),('${outsider}','store','${away}',true,null,'Outside Store'),('${inactive}','store','${site}',false,null,'Inactive'),('${deleted}','store','${site}',true,now(),'Deleted'),('${manager}','area_manager',null,true,null,'Legacy Manager');
 insert into public.manager_locations values('${manager}','${site}');
 `)
 await db.exec(`alter default privileges grant all on schemas to authenticated;alter default privileges grant all on tables to anon,authenticated;alter default privileges grant execute on functions to anon,authenticated;`)
 await db.exec(migration)
 const today=(await db.query(`select (now() at time zone 'America/Los_Angeles')::date::text as d`)).rows[0].d
 await db.exec(`insert into public.checklist_pilot_access(location_id,user_id,enabled_from) values('${site}','${store}',date '${today}'-40);`)
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261105212313_checklist_discard_draft.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261109172331_checklist_companywide_access.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261109193454_weekly_pm_checklist.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261112022829_checklist_qr_same_day.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261112143325_checklist_conflict_http_409.sql',import.meta.url),'utf8'))
 if(deadlines) await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261112184148_checklist_occurrence_deadlines.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261111200615_checklist_compliance_report.sql',import.meta.url),'utf8'))
 if(audits) await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261112222936_management_audits.sql',import.meta.url),'utf8'))
 await db.exec('set role service_role')
 return {db,today}
}

const hash='a'.repeat(64), newHash='b'.repeat(64)
async function api(db,action,body={},who=store,token=null) {
 await db.exec('reset role;set role service_role')
 return (await db.query('select public.checklist_access_server($1,$2,$3,$4::jsonb) as result',[who,token,action,JSON.stringify(body)])).rows[0].result
}
async function guest(db,action,body={},token=hash) {return api(db,action,body,null,token)}
async function configure(db) { return api(db,'qr_rotate',{location_id:site,token_hash:hash,expected_generation:0},admin) }
async function start(db,template='midday',who=store,token=null,date) {return api(db,'start',{location_id:site,template_key:template,period_date:date},who,token)}
function allAnswers(row) {return Object.fromEntries(row.template_snapshot.definition.filter(i=>!i.condition).map(i=>[i.id,{value:i.type==='text'?'Fictional inspection':i.options[0],explanation:'Fictional test reason.'}]))}
async function upload(db,row,item=null,kind='signature',who=store,token=null) {
 const body={id:row.id,working_copy_id:row.working_copy_id,kind,item_id:item,extension:'png'}
 const u=await api(db,'upload_begin',body,who,token)
 await db.exec('reset role')
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('manager-checklist-evidence',$1,'{}'::jsonb)",[u.object_path])
 const done=await api(db,'upload_finish',{...body,upload_id:u.upload_id},who,token)
 return done.attachment
}
async function ready(db,row,who=store,token=null) {
 for(const i of row.template_snapshot.definition) {if(i.photo_required) await upload(db,row,i.id,'photo',who,token);if(i.signature_required) await upload(db,row,i.id,'signature',who,token)}
 await upload(db,row,null,'signature',who,token)
}
async function saveNew(db,row,submit=false,who=store,token=null,answers=allAnswers(row)) {return api(db,'save',{id:row.id,working_copy_id:row.working_copy_id,revision:row.revision,answers,manager_name:'Fictional Auditor',submit},who,token)}
const auditKeys=['monthly_site_assessment','quarterly_safety_audit']
const auditMigration=readFileSync(new URL('../../app/supabase/migrations/20261112222936_management_audits.sql',import.meta.url),'utf8')
const inventory=JSON.parse(readFileSync(new URL('../../docs/management-audits/pdf-question-inventory.json',import.meta.url),'utf8'))
async function templates(db){return root(db,'select * from public.checklist_templates order by key')}
async function complete(db,row){await ready(db,row);return (await saveNew(db,row,true)).submission}
test('approved PDF fields become two templates with Failed follow-ups and optional general comments',async()=>{
 const {db}=await setup();try{
 const all=await templates(db);assert.equal(all.length,7)
 for(const key of auditKeys){const t=all.find(t=>t.key===key),source=inventory[key];assert.equal(t.definition.length,source.response_field_count)
 for(const [n,item]of t.definition.entries()){
 const original=source.items[n];for(const field of ['id','text','instruction','section','number','type','options'])assert.deepEqual(item[field],original[field])
 assert.equal(item.required,!original.is_general_comment);assert.equal(item.photo_required,original.photo_required_by_source);assert.equal(item.na_allowed,false);assert.deepEqual(item.failure_values,[])
 if(original.source_condition)assert.deepEqual(item.condition,{...original.source_condition,value:'Failed'});else assert.equal(item.condition,undefined)
 }}
 }finally{await db.close()}
})
test('existing account roles/site ownership apply and both audits are available at 20 eligible sites only',async()=>{
 const {db}=await setup();try{
 await root(db,`insert into public.locations(id,site_code,timezone) select ('00000000-0000-0000-0000-'||lpad((400+i)::text,12,'0'))::uuid,'QA-'||i,'America/New_York' from generate_series(1,18)i`)
 const sites=await root(db,'select id from public.locations order by id');assert.equal(sites.length,20)
 for(const l of sites)for(const key of auditKeys)assert.equal((await api(db,'start',{location_id:l.id,template_key:key},admin)).submission.location_id,l.id)
 await root(db,`insert into public.locations(id,site_code,timezone,exclude_from_reporting) values($1,'QA-Excluded','America/Chicago',true)`,[uuid(999)])
 await assert.rejects(api(db,'start',{location_id:uuid(999),template_key:auditKeys[0]},admin),/Eligible audit location/)
 await assert.rejects(start(db,auditKeys[0],outsider),/Assigned location/)
 await assert.rejects(start(db,auditKeys[0],inactive),/Active account/);await assert.rejects(start(db,auditKeys[0],deleted),/Active account/)
 // Existing manager assignment still permits own records; a different account cannot edit another creator's audit.
 const oldDate=(await root(db,"select (date_trunc('month',now())-interval '1 month')::date::text d"))[0].d
 const row=(await start(db,auditKeys[0],manager,null,oldDate)).submission
 await assert.rejects(api(db,'save',{id:row.id,revision:row.revision,answers:{},manager_name:'Other'},other),/access unavailable|owner/)
 }finally{await db.close()}
})
test('month and quarter identity is canonical and unique; saved drafts resume after their creation day',async()=>{
 const {db,today}=await setup();try{
 for(const key of auditKeys){let row=(await start(db,key)).submission
 const expected=(await root(db,`select date_trunc($1,$2::date::timestamp)::date::text d`,[key===auditKeys[0]?'month':'quarter',today]))[0].d;assert.equal(row.period_date,expected)
 await assert.rejects(start(db,key),{code:'23505'})
 await root(db,"update public.checklist_submissions set created_at=period_date::timestamptz where id=$1",[row.id])
 row=(await saveNew(db,row,false)).submission;const read=await api(db,'read',{id:row.id});assert.equal(read.capabilities.can_edit,true);assert.equal(read.capabilities.edit_deadline_at,null);assert.equal(read.submission.period_date,expected)
 const nonCanonical=(await root(db,'select ($1::date+1)::text d',[expected]))[0].d;await assert.rejects(start(db,key,store,null,nonCanonical),/Invalid checklist business date/)
 }
 }finally{await db.close()}
})
test('site-local month and quarter deadlines handle DST, leap February, year boundaries and legacy deadline overrides',async()=>{
 const {db}=await setup();try{
 for(const [cadence,date,expected]of [['monthly','2026-03-01','2026-04-01T07:00:00Z'],['monthly','2026-11-01','2026-12-01T08:00:00Z'],['monthly','2028-02-01','2028-03-01T08:00:00Z'],['monthly','2026-12-01','2027-01-01T08:00:00Z'],['quarterly','2026-01-01','2026-04-01T07:00:00Z'],['quarterly','2026-10-01','2027-01-01T08:00:00Z']]){
 for(const stored of ['2000-01-01T00:00:00Z','2099-01-01T00:00:00Z',null]){
 const fixture={period_date:date,submitted_at:'2026-11-12T12:00:00Z',edit_deadline_at:stored,template_snapshot:{cadence,timezone:'America/Los_Angeles'}}
 const [r]=await root(db,"select checklist_private.deadline(jsonb_populate_record(null::public.checklist_submissions,$1::jsonb)) d",[JSON.stringify(fixture)]);assert.equal(new Date(r.d).toISOString(),new Date(expected).toISOString())
 const [bounds]=await root(db,"select $1::timestamptz-interval '1 microsecond'<$2::timestamptz b,$1::timestamptz<$2::timestamptz a",[expected,r.d]);assert.equal(bounds.b,true);assert.equal(bounds.a,false)
 }}
 }finally{await db.close()}
})
test('general comments are optional but active Failed follow-ups, source photo and auditor signature are mandatory',async()=>{
 const {db}=await setup();try{
 for(const key of auditKeys){let row=(await start(db,key)).submission;let answers=allAnswers(row)
 for(const item of row.template_snapshot.definition.filter(i=>i.required===false))delete answers[item.id]
 await assert.rejects(saveNew(db,row,true,store,null,answers),/Photo required|signature is required/)
 await ready(db,row)
 for(const follow of row.template_snapshot.definition.filter(i=>i.condition)){
 const parent=follow.condition.item_id;answers[parent]={value:'Failed'}
 await assert.rejects(saveNew(db,row,true,store,null,answers),/Required response/)
 answers[follow.id]={value:'Fictional issue details'}
 }
 row=(await saveNew(db,row,true,store,null,answers)).submission;assert.equal(row.status,'submitted')
 for(const item of row.template_snapshot.definition.filter(i=>i.required===false))assert.equal(row.answers[item.id],undefined)
 }
 }finally{await db.close()}
})
test('valid same-site QR cannot list, start, read, edit, submit, view history, download or authorize/finalize audit evidence',async()=>{
 const {db}=await setup();try{
 await configure(db)
 for(const key of auditKeys){const row=(await start(db,key)).submission
 await assert.rejects(guest(db,'start',{template_key:key}),{code:'42501'})
 for(const action of ['read','begin_edit','save','history','download','upload_begin','upload_finish']){
 await assert.rejects(guest(db,action,{id:row.id,revision:row.revision,submit:true,answers:{},manager_name:'Spoof',kind:'signature',extension:'png',p_actor:admin,location_id:site,template_key:'opening'}),{code:'42501'})
 }
 const context=await guest(db,'context');assert.equal(context.templates.length,5);assert.ok(context.templates.every(t=>!auditKeys.includes(t.key)));assert.equal(context.submissions.some(s=>s.id===row.id),false)
 const official=await complete(db,row)
 for(const action of ['read','history','download','begin_edit','save','upload_begin','upload_finish'])await assert.rejects(guest(db,action,{id:official.id,revision:official.revision,submit:true}),{code:'42501'})
 }
 }finally{await db.close()}
})
test('final Storage insertion rejects a stale guest intent for each audit without registering an object or attachment',async()=>{
 const {db}=await setup();try{
 const grant=await configure(db)
 for(const key of auditKeys){const row=(await start(db,key)).submission,id=uuid(key===auditKeys[0]?700:701),path=row.id+'/'+id+'.png'
 await root(db,`insert into checklist_private.upload_intents(id,submission_id,object_path,kind,actor_guest,guest_generation,expires_at) values($1,$2,$3,'signature',$4,1,clock_timestamp()+interval '5 minutes')`,[id,row.id,path,grant.grant.id])
 await db.exec('reset role');await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata) values('manager-checklist-evidence',$1,'{\"eTag\":\"fictional\",\"size\":100}')",[path]),{code:'42501'})
 assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[path])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.checklist_attachments where id=$1',[id])).rows[0].n,0)
 }
 }finally{await db.close()}
})
test('authenticated corrections preserve initial timestamps, versions, attribution, evidence and PT409 conflict protection',async()=>{
 const {db}=await setup();try{
 for(const key of auditKeys){let row=await complete(db,(await start(db,key)).submission);const original=structuredClone(row),initial=(await api(db,'history',{id:row.id})).versions[0]
 let w=(await api(db,'begin_edit',{id:row.id,revision:row.revision})).submission
 await assert.rejects(saveNew(db,{...w,revision:0},false),{code:'PT409'})
 await assert.rejects(saveNew(db,w,true),/new drawn final signature/)
 w=(await saveNew(db,w,false)).submission;assert.equal((await root(db,'select status from public.checklist_submissions where id=$1',[row.id]))[0].status,'submitted')
 await ready(db,w);row=(await saveNew(db,w,true)).submission
 assert.equal(row.submitted_at,original.submitted_at);assert.equal(row.created_by,original.created_by);assert.equal(row.period_date,original.period_date);assert.deepEqual(row.template_snapshot,original.template_snapshot)
 const history=(await api(db,'history',{id:row.id})).versions;assert.equal(history.length,2);assert.deepEqual(history[1].answers,initial.answers)
 for(const e of history[1].evidence)assert.equal((await api(db,'download',{id:row.id,attachment_id:e.id})).attachment_id,e.id)
 assert.equal((await root(db,"select count(*)::int n from public.edit_audit_log where new_values->>'id'=$1 and summary like '%correction%'",[row.id]))[0].n,1)
 }
 }finally{await db.close()}
})
test('expired submitted audit cannot begin a correction despite a stored future deadline',async()=>{
 const {db}=await setup();try{
 for(const key of auditKeys){const date=(await root(db,"select (date_trunc('quarter',now())-interval '3 months')::date::text d"))[0].d
 let row=await complete(db,(await start(db,key,store,null,date)).submission)
 await root(db,"update public.checklist_submissions set edit_deadline_at='2099-01-01' where id=$1",[row.id])
 assert.equal((await api(db,'read',{id:row.id})).capabilities.can_begin_edit,false);await assert.rejects(api(db,'begin_edit',{id:row.id,revision:row.revision}),{code:'42501'})
 }
 }finally{await db.close()}
})
test('migration preserves original five definitions, existing data/evidence, all 20 QR grants and existing function ACLs',async()=>{
 const {db}=await setup({audits:false});try{
 await root(db,`insert into public.locations(id,site_code,timezone) select ('00000000-0000-0000-0000-'||lpad((400+i)::text,12,'0'))::uuid,'QA-'||i,'America/New_York' from generate_series(1,18)i`)
 await root(db,`insert into checklist_private.qr_grants(location_id,token_hash,created_by) select id,md5(id::text)||md5('salt'||id::text),$1 from public.locations`,[admin])
 const row=await complete(db,(await start(db,'midday')).submission)
 const snapshot=async()=>root(db,`select jsonb_build_object('templates',(select jsonb_agg(to_jsonb(t) order by key) from public.checklist_templates t where key in ('opening','midday','closing','weekly','weekly_pm')),'submissions',(select jsonb_agg(to_jsonb(t) order by id) from public.checklist_submissions t),'attachments',(select jsonb_agg(to_jsonb(t) order by id) from public.checklist_attachments t),'objects',(select jsonb_agg(to_jsonb(t) order by name) from storage.objects t),'versions',(select jsonb_agg(to_jsonb(t) order by revision) from checklist_private.versions t),'QR',(select jsonb_agg(to_jsonb(t) order by id) from checklist_private.qr_grants t),'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.edit_audit_log t),'ACL',(select jsonb_agg(jsonb_build_array(oid,proacl,proconfig,prosecdef) order by oid) from pg_proc where oid in ('checklist_private.actor_allowed(public.checklist_submissions,uuid,uuid,boolean)'::regprocedure,'checklist_private.deadline(public.checklist_submissions)'::regprocedure,'checklist_private.validate_answers(public.checklist_submissions,jsonb,text,boolean,uuid)'::regprocedure,'checklist_private.access_action(uuid,text,text,jsonb)'::regprocedure,'checklist_private.guard_evidence_insert()'::regprocedure))) data`)
 const before=await snapshot();await db.exec('reset role');await db.exec(auditMigration);assert.deepEqual(await snapshot(),before);assert.equal((await root(db,'select count(*)::int n from checklist_private.qr_grants'))[0].n,20)
 }finally{await db.close()}
})
test('Daily and Weekly Compliance results do not include or change with audit drafts, submissions or corrections',async()=>{
 const {db,today}=await setup();try{
 await actor(db,admin);const report=async()=>(await db.query("select public.get_checklist_compliance($1,$1)-'generated_at' d",[today])).rows[0].d
 const before=await report()
 for(const key of auditKeys){let row=(await start(db,key)).submission;await actor(db,admin);assert.deepEqual(await report(),before)
 row=await complete(db,row);await actor(db,admin);assert.deepEqual(await report(),before)
 const work=(await api(db,'begin_edit',{id:row.id,revision:row.revision})).submission;await saveNew(db,work,false);await actor(db,admin);assert.deepEqual(await report(),before)
 }
 }finally{await db.close()}
})
test('anonymous/private RPC restrictions remain intact; authenticated audit metadata is not exposed to QR browser roles',async()=>{
 const {db}=await setup();try{
 for(const role of ['anon','authenticated']){await db.exec(`reset role;set role ${role}`)
 await assert.rejects(db.query("select public.checklist_access_server($1,null,'context','{}')",[admin]),/permission denied/)
 await assert.rejects(db.query("select checklist_private.qr_template_allowed('opening')"),/permission denied/)
 await assert.rejects(db.query("select * from checklist_private.versions"),/permission denied/)
 }
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.checklist_templates'),/permission denied/)
 }finally{await db.close()}
})
test('real Edge handler plus SQL rejects audit requests using a valid QR even with an account JWT and never transfers Storage bytes',async()=>{
 const {db}=await setup();try{
 const token='c'.repeat(64),digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex')
 await api(db,'qr_rotate',{location_id:site,token_hash:digest,expected_generation:0},admin)
 let storageCalls=0
 const server={async rpc(name,args){assert.equal(name,'checklist_access_server');try{return {data:await api(db,args.p_action,args.p_body,args.p_actor,args.p_token_hash)}}catch(e){return {error:{code:e.code,message:e.message}}}},storage:{from(){storageCalls++;throw Error('Audit Storage must not be reached by QR')}}}
 const user={auth:{async getUser(){return {data:{user:{id:admin}}}}}}
 for(const key of auditKeys){const row=(await start(db,key)).submission
 for(const action of ['start','read','history','download','begin_edit','save']){
 const res=await checklistAccess(new Request('https://fictional.invalid',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fictional-account-jwt'},body:JSON.stringify({action,token,id:row.id,template_key:key,revision:row.revision,submit:true,answers:{},manager_name:'Fictional',actor:admin})}),user,server,webcrypto)
 assert.equal(res.status,403);assert.equal(res.headers.get('Cache-Control'),'no-store')
 }
 const form=new FormData();for(const [k,v]of Object.entries({action:'upload',token,id:row.id,kind:'signature'}))form.set(k,v)
 form.set('file',new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0])],{type:'image/png'}),'fictional.png')
 const response=await checklistAccess(new Request('https://fictional.invalid',{method:'POST',body:form}),user,server,webcrypto);assert.equal(response.status,403)
 }
 assert.equal(storageCalls,0)
 }finally{await db.close()}
})
test('legacy authenticated start/save RPC continues to work for the new audits',async()=>{
 const {db,today}=await setup();try{
 for(const [key,cadence]of [[auditKeys[0],'month'],[auditKeys[1],'quarter']]){
 const date=(await root(db,"select date_trunc($1,$2::date::timestamp)::date::text d",[cadence,today]))[0].d
 await actor(db,store);let row=(await db.query('select public.save_checklist($1,$2,$3) s',[key,site,date])).rows[0].s
 assert.equal(row.created_by,store);assert.equal(row.created_by_guest,null)
 row=(await db.query('select public.save_checklist($1,$2,$3,$4,$5,$6,$7,false) s',[key,site,date,row.id,row.revision,JSON.stringify(allAnswers(row)),'Fictional Auditor'])).rows[0].s
 assert.equal(row.status,'draft');assert.equal(row.revision,2)
 }
 for(const [zone,expected]of [['America/Chicago','2026-04-01T05:00:00Z'],['America/Denver','2026-04-01T06:00:00Z'],['America/Phoenix','2026-04-01T07:00:00Z'],['America/New_York','2026-04-01T04:00:00Z']]){
 const s={period_date:'2026-03-01',submitted_at:'2026-03-05T12:00:00Z',template_snapshot:{cadence:'monthly',timezone:zone}}
 const [r]=await root(db,'select checklist_private.deadline(jsonb_populate_record(null::public.checklist_submissions,$1::jsonb)) d',[JSON.stringify(s)]);assert.equal(new Date(r.d).toISOString(),new Date(expected).toISOString())
 }
 }finally{await db.close()}
})
