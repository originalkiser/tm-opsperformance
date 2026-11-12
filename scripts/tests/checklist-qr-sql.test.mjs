// Isolated in-memory PostgreSQL with fictional profiles/storage metadata only. Never contacts Supabase.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migration = readFileSync(new URL('../../app/supabase/migrations/20261105173034_manager_checklists_pilot.sql', import.meta.url), 'utf8')
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const admin=uuid(1),store=uuid(2),other=uuid(3),outsider=uuid(4),inactive=uuid(5),deleted=uuid(6),manager=uuid(7),site=uuid(10),away=uuid(11)
async function actor(db,id=admin,role='authenticated') { await db.exec(`reset role;set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']) }
async function root(db,sql,args=[]) { await db.exec('reset role');const result=await db.query(sql,args);await db.exec('set role authenticated');return result.rows }
async function setup({deadlines=true}={}) {
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid primary key,role text,location_id uuid,is_active boolean,deleted_at timestamptz,name text);
 create table public.locations(id uuid primary key,site_code text,timezone text);
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
 insert into public.locations values('${site}','1000-Fictional','America/Los_Angeles'),('${away}','1001-Fictional','America/New_York');
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
test('migration closes private state and spoofable RPC to all browser roles',async()=>{
 const {db}=await setup();try{
 for(const role of ['anon','authenticated']) {
  await db.exec(`reset role;set role ${role}`)
  await assert.rejects(db.query("select public.checklist_access_server($1,null,'context','{}')",[admin]),/permission denied/)
  await assert.rejects(db.query('select * from checklist_private.qr_grants'),/permission denied/)
 }
 const grant=await configure(db);assert.equal(grant.grant.is_active,true);assert.equal('token_hash' in grant.grant,false)
 const context=await guest(db,'context');assert.equal(context.templates.length,5);assert.equal(context.location.id,site)
 }finally{await db.close()}
})
test('QR scopes every read/write; shared account drafts work without widening account privacy or NULL ownership',async()=>{
 const {db}=await setup();try{
 await configure(db)
 let row=(await start(db)).submission
 const outside=(await api(db,'start',{location_id:away,template_key:'midday'},outsider)).submission
 await assert.rejects(guest(db,'read',{id:outside.id}),/access unavailable/)
 await assert.rejects(api(db,'read',{id:row.id},other),/access unavailable/)
 await assert.rejects(api(db,'read',{id:row.id},inactive),/Active account/)
 const edited=await guest(db,'save',{id:row.id,revision:row.revision,answers:{},manager_name:'',submit:false})
 assert.equal(edited.submission.manager_name,'');assert.equal(edited.submission.created_by,store)
 await db.exec('reset role');const event=(await db.query("select new_values from public.edit_audit_log where summary='Checklist guest draft saved'")).rows[0].new_values;assert.equal(event.actor_kind,'guest');assert.equal(event.guest_generation,1);assert.equal('token_hash' in event,false)
 row=(await guest(db,'start',{location_id:away,template_key:'opening'})).submission
 assert.equal(row.location_id,site);assert.equal(row.created_by,null)
 await actor(db,store)
 await assert.rejects(db.query("select public.save_checklist('opening',$1,$2,$3,$4,'{}','',false)",[site,row.period_date,row.id,row.revision]),/owner/)
 await assert.rejects(api(db,'save',{id:row.id,revision:row.revision,answers:{},manager_name:'',submit:false},store),/access unavailable|owner/)
 await assert.rejects(guest(db,'qr_rotate',{location_id:site,token_hash:newHash,expected_generation:1}),/Admin/)
 }finally{await db.close()}
})
test('same-day correction retains original, official status, timestamp and evidence; requires a new signature and conflict protection',async()=>{
 const {db}=await setup();try{
 await configure(db);let row=(await start(db)).submission
 await ready(db,row);row=(await saveNew(db,row,true)).submission
 const initial=structuredClone(row)
 const initialHistory=(await guest(db,'history',{id:row.id})).versions
 assert.equal(initialHistory.length,1);assert.equal(initialHistory[0].evidence.length,1)
 let correction=(await guest(db,'begin_edit',{id:row.id,revision:row.revision})).submission
 assert.ok(correction.working_copy_id);assert.equal(correction.status,'submitted')
 const pending=await saveNew(db,correction,false,null,hash,{})
 correction=pending.submission
 await db.exec('reset role')
 const official=(await db.query('select * from public.checklist_submissions where id=$1',[row.id])).rows[0]
 assert.equal(official.status,'submitted');assert.deepEqual(official.answers,initial.answers)
 await assert.rejects(saveNew(db,{...correction,revision:correction.revision-1},false,null,hash),/changed elsewhere/)
 await assert.rejects(saveNew(db,correction,true,null,hash),/new drawn final signature/)
 await ready(db,correction,null,hash)
 const corrected=(await saveNew(db,correction,true,null,hash)).submission
 assert.equal(corrected.submitted_at,initial.submitted_at);assert.equal(corrected.edit_deadline_at,initial.edit_deadline_at)
 const history=(await guest(db,'history',{id:row.id})).versions
 assert.equal(history.length,2);assert.equal(history[0].actor_kind,'guest');assert.equal(history[1].actor_kind,'account')
 assert.deepEqual(history[1].answers,initial.answers)
 assert.notEqual(history[0].evidence_ids[0],history[1].evidence_ids[0])
 assert.equal((await guest(db,'download',{id:row.id,attachment_id:history[1].evidence_ids[0]})).attachment_id,history[1].evidence_ids[0])
 await assert.rejects(api(db,'begin_edit',{id:row.id,revision:row.revision},admin),/owner/)
 }finally{await db.close()}
})
test('midnight closes working copies, preserves official view and blocks late uploads; pending changes do not extend the deadline',async()=>{
 const {db}=await setup();try{
 await configure(db);let row=(await start(db)).submission;await ready(db,row);row=(await saveNew(db,row,true)).submission
 const original=row.answers
 let working=(await guest(db,'begin_edit',{id:row.id,revision:row.revision})).submission
 working=(await saveNew(db,working,false,null,hash,{})).submission
 const intent=await guest(db,'upload_begin',{id:row.id,working_copy_id:working.working_copy_id,kind:'signature',extension:'png'})
 await db.exec('reset role');await db.query("update public.checklist_submissions set period_date=period_date-1,edit_deadline_at=clock_timestamp()+interval '1 year' where id=$1",[row.id])
 const view=await guest(db,'read',{id:row.id});assert.deepEqual(view.submission.answers,original);assert.equal(view.submission.working_copy_id,undefined);assert.equal(view.capabilities.can_correct,false)
 await assert.rejects(saveNew(db,working,false,null,hash),/no longer editable/)
 await db.exec('reset role');await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path]),/no longer editable/)
 assert.equal((await db.query('select count(*)::int n from checklist_private.working_copies')).rows[0].n,1)
 }finally{await db.close()}
})
test('older weekly drafts remain resumable; late submission cannot reopen the assigned week',async()=>{
 const {db,today}=await setup();try{
 await configure(db)
 const old=(await root(db,"select (date_trunc('week',$1::date)-interval '14 days')::date::text d",[today]))[0].d
 let row=(await start(db,'weekly',store,null,old)).submission
 const context=await guest(db,'context');assert.ok(context.submissions.some(s=>s.id===row.id))
 row=(await guest(db,'save',{id:row.id,revision:row.revision,answers:{},manager_name:'',submit:false})).submission
 await ready(db,row,null,hash);row=(await saveNew(db,row,true,null,hash)).submission
 assert.equal(row.period_date,old)
 await db.exec('reset role')
 const deadline=(await db.query("select ($1::date+7)::timestamp at time zone 'America/Los_Angeles' as d",[old])).rows[0].d
 assert.equal(new Date(row.edit_deadline_at).getTime(),new Date(deadline).getTime())
 assert.equal((await guest(db,'read',{id:row.id})).capabilities.can_correct,false)
 await assert.rejects(guest(db,'begin_edit',{id:row.id,revision:row.revision}),/window is closed/)
 }finally{await db.close()}
})
test('revocation and rotation stop reads, saves, evidence, final upload insertion and registration; stale admin updates fail',async()=>{
 const {db}=await setup();try{
 await configure(db);const row=(await guest(db,'start',{template_key:'midday'})).submission
 const attachment=await upload(db,row,null,'signature',null,hash)
 const intent=await guest(db,'upload_begin',{id:row.id,kind:'signature',extension:'png'})
 await api(db,'qr_rotate',{location_id:site,token_hash:newHash,expected_generation:1},admin)
 await assert.rejects(api(db,'qr_revoke',{location_id:site,expected_generation:1},admin),/changed elsewhere/)
 for(const [action,body] of [['context',{}],['read',{id:row.id}],['download',{id:row.id,attachment_id:attachment.id}],['save',{id:row.id,revision:row.revision,answers:{},manager_name:''}]]) await assert.rejects(guest(db,action,body),/expired or revoked/)
 await db.exec('reset role');await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path]),/revoked/)
 assert.equal((await guest(db,'read',{id:row.id},newHash)).submission.id,row.id)
 await assert.rejects(guest(db,'upload_finish',{id:row.id,upload_id:intent.upload_id},newHash),/expired/)
 await api(db,'qr_revoke',{location_id:site,expected_generation:2},admin)
 await assert.rejects(guest(db,'context',{},newHash),/expired or revoked/)
 }finally{await db.close()}
})
test('initial finalize and correction finalize reject in-flight upload completion and preserve optimistic revisions',async()=>{
 const {db}=await setup();try{
 let row=(await start(db)).submission;await ready(db,row)
 let intent=await api(db,'upload_begin',{id:row.id,kind:'signature',extension:'png'})
 row=(await saveNew(db,row,true)).submission
 await db.exec('reset role');await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path]),/unavailable/)
 let w=(await api(db,'begin_edit',{id:row.id,revision:row.revision})).submission;await ready(db,w)
 intent=await api(db,'upload_begin',{id:row.id,working_copy_id:w.working_copy_id,kind:'signature',extension:'png'})
 await saveNew(db,w,true)
 await db.exec('reset role');await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path]),/no longer editable/)
 }finally{await db.close()}
})
test('authorized discard completes after endpoint uploads, removes only draft intents, and submitted records remain protected',async()=>{
 const {db}=await setup();try{
 let row=(await start(db)).submission;await upload(db,row)
 await actor(db,store)
 await db.query('select public.begin_discard_checklist($1,$2)',[row.id,row.revision])
 await assert.rejects(db.query('select public.finish_discard_checklist($1)',[row.id]),/cleanup is not complete/)
 // Simulates separately mocked Storage API cleanup; production code never deletes Storage metadata by SQL.
 await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='manager-checklist-evidence' and name like $1",[row.id+'/%'])
 await actor(db,store);await db.query('select public.finish_discard_checklist($1)',[row.id])
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from checklist_private.upload_intents')).rows[0].n,0)
 row=(await start(db)).submission;await ready(db,row);row=(await saveNew(db,row,true)).submission
 await actor(db,admin);await assert.rejects(db.query('select public.begin_discard_checklist($1,$2)',[row.id,row.revision]),/cannot be discarded/)
 }finally{await db.close()}
})
test('audit failure rolls back final answers, version and submission; unrelated data remains untouched',async()=>{
 const {db}=await setup();try{
 const row=(await start(db)).submission;await ready(db,row)
 await db.exec('reset role');await db.exec('alter table public.edit_audit_log add constraint reject_audit check(false)')
 await assert.rejects(saveNew(db,row,true),/reject_audit/)
 const saved=await api(db,'read',{id:row.id});assert.equal(saved.submission.status,'draft');assert.equal(saved.submission.submitted_at,null)
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from checklist_private.versions')).rows[0].n,0)
 assert.equal((await db.query('select value from public.actuals')).rows[0].value,'123.456')
 }finally{await db.close()}
})
test('server midnight uses immutable IANA snapshot across DST and rejects oversized/unknown answers',async()=>{
 const {db}=await setup();try{
 const row=(await start(db)).submission
 for(const [date,expected] of [['2026-03-08','2026-03-09T07:00:00Z'],['2026-11-01','2026-11-02T08:00:00Z']]) {
  await db.exec('reset role')
  const d=(await db.query("select checklist_private.deadline(jsonb_populate_record(null::public.checklist_submissions,$1::jsonb)) d",[JSON.stringify({...row,period_date:date,submitted_at:'2026-11-12T12:00:00Z',edit_deadline_at:'2099-01-01T00:00:00Z'})])).rows[0].d
  assert.equal(new Date(d).toISOString(),new Date(expected).toISOString())
 }
 await assert.rejects(saveNew(db,row,false,store,null,{unknown:{value:'Yes'}}),/Unknown answer/)
 await assert.rejects(saveNew(db,row,false,store,null,{'midday-1':{value:'Yes',explanation:'x'.repeat(200001)}}),/Invalid request|Invalid checklist/)
 }finally{await db.close()}
})
test('PM corrections require fresh item and final signatures while originals remain historically readable',async()=>{
 const {db}=await setup();try{
 await configure(db);let row=(await start(db,'weekly_pm')).submission
 const answers=Object.fromEntries(row.template_snapshot.definition.map(i=>[i.id,{value:i.type==='text'?'Fictional response':i.options[0],explanation:'Fictional inspection reason.'}]))
 await ready(db,row);row=(await saveNew(db,row,true,store,null,answers)).submission
 const first=(await guest(db,'history',{id:row.id})).versions[0];assert.equal(first.evidence.filter(e=>e.kind==='signature').length,3)
 const w=(await guest(db,'begin_edit',{id:row.id,revision:row.revision})).submission
 const view=await guest(db,'read',{id:row.id});assert.equal(view.evidence.filter(e=>e.kind==='signature').length,0)
 await upload(db,w,null,'signature',null,hash)
 await assert.rejects(saveNew(db,w,true,null,hash,answers),/Item signature required/)
 for(const i of row.template_snapshot.definition.filter(i=>i.signature_required)) await upload(db,w,i.id,'signature',null,hash)
 await saveNew(db,w,true,null,hash,answers)
 const history=(await guest(db,'history',{id:row.id})).versions
 assert.equal(history.length,2);assert.equal(history[0].evidence.filter(e=>e.kind==='signature').length,3)
 assert.ok(history[0].evidence_ids.every(id=>!first.evidence_ids.includes(id)))
 }finally{await db.close()}
})
test('late daily submission stays outside its occurrence correction window; legacy named starts retain revision one',async()=>{
 const {db,today}=await setup();try{
 await configure(db)
 const old=(await root(db,"select ($1::date-30)::text d",[today]))[0].d
 await actor(db,store)
 let row=(await db.query("select public.save_checklist('midday',$1,$2,null,null,'{}','Fictional Initial Name',false) s",[site,old])).rows[0].s
 assert.equal(row.revision,1);assert.equal(row.manager_name,'Fictional Initial Name')
 await ready(db,row);row=(await saveNew(db,row,true)).submission
 assert.equal((await guest(db,'read',{id:row.id})).capabilities.can_begin_edit,false)
 await assert.rejects(guest(db,'begin_edit',{id:row.id,revision:row.revision}),/window is closed/)
 const context=await guest(db,'context');assert.equal(context.submissions.some(s=>s.id===row.id),false)
 }finally{await db.close()}
})
test('bounded context pagination, per-link request and upload caps fail closed without changing drafts',async()=>{
 const {db,today}=await setup();try{
 const grant=await configure(db)
 await db.exec('reset role')
 await db.query(`insert into public.checklist_submissions(template_key,location_id,period_date,created_by,template_snapshot)
 select 'midday',$1,$2::date-i,$3,jsonb_build_object('name','Fictional','cadence','daily','timezone','America/Los_Angeles','definition','[]'::jsonb)
 from generate_series(0,100) i`,[site,today,store])
 const first=await guest(db,'context');assert.equal(first.submissions.length,100);assert.equal(first.has_more,true);assert.equal(first.next_offset,100)
 const second=await guest(db,'context',{offset:100});assert.equal(second.submissions.length,1);assert.equal(second.has_more,false)
 assert.equal(new Set([...first.submissions,...second.submissions].map(s=>s.id)).size,101)
 await assert.rejects(guest(db,'context',{offset:-1}),/Invalid page/)
 const row=first.submissions[0]
 await db.exec('reset role')
 await db.query("update checklist_private.qr_rate set window_start=date_trunc('minute',clock_timestamp()),requests=120 where grant_id=$1",[grant.grant.id])
 await assert.rejects(guest(db,'read',{id:row.id}),/Too many requests/)
 await db.exec('reset role');await db.query("update checklist_private.qr_rate set requests=0 where grant_id=$1",[grant.grant.id])
 await db.query(`insert into checklist_private.upload_intents(id,submission_id,object_path,kind,actor_user,created_at,expires_at)
 select gen_random_uuid(),$1::uuid,($1::uuid)::text||'/'||gen_random_uuid()::text||'.png','signature',$2,clock_timestamp()-interval '1 hour',clock_timestamp()-interval '55 minutes' from generate_series(1,200)`,[row.id,store])
 await assert.rejects(guest(db,'upload_begin',{id:row.id,kind:'signature',extension:'png'}),/upload limit/)
 assert.equal((await guest(db,'read',{id:row.id})).submission.status,'draft')
 }finally{await db.close()}
})

test('QR generation serialization uses NO KEY UPDATE to remain compatible with a guest INSERT location FK',()=>{
 const sql=readFileSync(new URL('../../app/supabase/migrations/20261112022829_checklist_qr_same_day.sql',import.meta.url),'utf8')
 assert.match(sql,/perform 1 from public\.locations where id=loc for no key update/)
 assert.doesNotMatch(sql,/perform 1 from public\.locations where id=loc for update/)
})

test('business revision/generation conflicts use non-retryable PT409 and leave state unchanged',async()=>{
 const {db}=await setup();try{
  await configure(db)
  await db.exec('reset role')
  const body=(await db.query("select prosrc from pg_proc where oid='checklist_private.access_action(uuid,text,text,jsonb)'::regprocedure")).rows[0].prosrc
  assert.equal((body.match(/errcode='PT409'/g)||[]).length,3)
  assert.doesNotMatch(body,/errcode\s*=\s*'40001'/)
  const state=async()=>{
   await db.exec('reset role')
   return (await db.query(`select jsonb_build_object(
    'grants',(select jsonb_agg(to_jsonb(g) order by g.id) from checklist_private.qr_grants g),
    'submissions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.checklist_submissions s),
    'working',(select jsonb_agg(to_jsonb(w) order by w.id) from checklist_private.working_copies w),
    'versions',(select jsonb_agg(to_jsonb(v) order by v.submission_id,v.revision) from checklist_private.versions v),
    'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.edit_audit_log a)
   ) as result`)).rows[0].result
  }
  let row=(await start(db)).submission
  let before=await state()
  await assert.rejects(api(db,'qr_rotate',{location_id:site,token_hash:newHash,expected_generation:0},admin),{code:'PT409'})
  await assert.rejects(api(db,'qr_revoke',{location_id:site,expected_generation:0},admin),{code:'PT409'})
  await assert.rejects(saveNew(db,{...row,revision:0},false),{code:'PT409'})
  assert.deepEqual(await state(),before)
  await ready(db,row);row=(await saveNew(db,row,true)).submission
  before=await state()
  await assert.rejects(guest(db,'begin_edit',{id:row.id,revision:row.revision-1}),{code:'PT409'})
  assert.deepEqual(await state(),before)
  const working=(await guest(db,'begin_edit',{id:row.id,revision:row.revision})).submission
  before=await state()
  await assert.rejects(saveNew(db,{...working,revision:0},false,null,hash),{code:'PT409'})
  assert.deepEqual(await state(),before)
 }finally{await db.close()}
})

test('weekly corrections survive a legacy early deadline; timestamps, attribution, versions and evidence remain intact',async()=>{
 const {db}=await setup();try{
 await configure(db);let row=(await start(db,'weekly')).submission
 await ready(db,row);row=(await saveNew(db,row,true)).submission
 const original=structuredClone(row)
 await root(db,"update public.checklist_submissions set edit_deadline_at=clock_timestamp()-interval '1 day' where id=$1",[row.id])
 const view=await guest(db,'read',{id:row.id})
 assert.equal(view.capabilities.can_begin_edit,true)
 const expected=(await root(db,"select ($1::date+7)::timestamp at time zone 'America/Los_Angeles' d",[row.period_date]))[0].d
 assert.equal(new Date(view.capabilities.edit_deadline_at).getTime(),new Date(expected).getTime())
 let work=(await guest(db,'begin_edit',{id:row.id,revision:row.revision})).submission
 work=(await saveNew(db,work,false,null,hash)).submission
 await ready(db,work,null,hash)
 const corrected=(await saveNew(db,work,true,null,hash)).submission
 assert.equal(corrected.submitted_at,original.submitted_at);assert.equal(corrected.created_by,original.created_by)
 assert.equal(corrected.period_date,original.period_date);assert.deepEqual(corrected.template_snapshot,original.template_snapshot)
 const history=(await guest(db,'history',{id:row.id})).versions
 assert.equal(history.length,2);assert.equal(history[1].actor_kind,'account');assert.equal(history[0].actor_kind,'guest')
 assert.deepEqual(history[1].answers,original.answers)
 for(const evidence of history[1].evidence) assert.equal((await guest(db,'download',{id:row.id,attachment_id:evidence.id})).attachment_id,evidence.id)
 }finally{await db.close()}
})
test('daily and weekly occurrence cutoffs respect DST, year/leap boundaries and ignore all stored deadlines',async()=>{
 const {db}=await setup();try{
 const row=(await start(db)).submission
 for(const [cadence,date,expected] of [
  ['daily','2026-03-08','2026-03-09T07:00:00Z'],['daily','2026-11-01','2026-11-02T08:00:00Z'],
  ['weekly','2026-03-02','2026-03-09T07:00:00Z'],['weekly','2026-10-26','2026-11-02T08:00:00Z'],
  ['weekly','2026-12-28','2027-01-04T08:00:00Z'],['daily','2028-02-29','2028-03-01T08:00:00Z'],
 ]) {
  for(const stored of [null,'2000-01-01T00:00:00Z','2099-01-01T00:00:00Z']) {
   const fixture={...row,period_date:date,submitted_at:'2026-11-12T12:00:00Z',edit_deadline_at:stored,template_snapshot:{...row.template_snapshot,cadence}}
   const [result]=await root(db,"select checklist_private.deadline(jsonb_populate_record(null::public.checklist_submissions,$1::jsonb)) d",[JSON.stringify(fixture)])
   assert.equal(new Date(result.d).toISOString(),new Date(expected).toISOString())
   const [bounds]=await root(db,"select $1::timestamptz-interval '1 microsecond'<$2::timestamptz as before, $1::timestamptz<$2::timestamptz as at",[expected,result.d])
   assert.equal(bounds.before,true);assert.equal(bounds.at,false)
   fixture.submitted_at=null;fixture.status='draft'
   assert.equal((await root(db,"select checklist_private.deadline(jsonb_populate_record(null::public.checklist_submissions,$1::jsonb)) d",[JSON.stringify(fixture)]))[0].d,null)
  }
 }
 // Calendar arithmetic, rather than fixed 24h/168h intervals, handles both DST transitions.
 for(const [date,cadence,hours] of [['2026-03-08','daily',23],['2026-11-01','daily',25],['2026-03-02','weekly',167],['2026-10-26','weekly',169]]) {
  const fixture={...row,period_date:date,submitted_at:'2026-11-12T12:00:00Z',template_snapshot:{...row.template_snapshot,cadence}}
  const [r]=await root(db,"select extract(epoch from (checklist_private.deadline(jsonb_populate_record(null::public.checklist_submissions,$1::jsonb))-($2::date::timestamp at time zone 'America/Los_Angeles')))/3600 h",[JSON.stringify(fixture),date])
  assert.equal(Number(r.h),hours)
 }
 }finally{await db.close()}
})
test('deadline follow-on migration preserves existing rows/evidence/audit and function grants',async()=>{
 const {db}=await setup({deadlines:false});try{
 await configure(db);let row=(await start(db)).submission;await ready(db,row);row=(await saveNew(db,row,true)).submission
 const snapshot=async()=>{await db.exec('reset role');return (await db.query(`select jsonb_build_object(
 'rows',(select jsonb_agg(to_jsonb(x)) from public.checklist_submissions x),
 'versions',(select jsonb_agg(to_jsonb(x)) from checklist_private.versions x),
 'working',(select jsonb_agg(to_jsonb(x)) from checklist_private.working_copies x),
 'attachments',(select jsonb_agg(to_jsonb(x)) from public.checklist_attachments x),
 'objects',(select jsonb_agg(to_jsonb(x)) from storage.objects x),
 'audit',(select jsonb_agg(to_jsonb(x)) from public.edit_audit_log x),
 'grants',(select jsonb_agg(jsonb_build_array(oid,proacl,prosecdef,proconfig) order by oid) from pg_proc where oid in ('checklist_private.deadline(public.checklist_submissions)'::regprocedure,'checklist_private.access_action(uuid,text,text,jsonb)'::regprocedure))) s`)).rows[0].s}
 const before=await snapshot()
 await db.exec(readFileSync(new URL('../../app/supabase/migrations/20261112184148_checklist_occurrence_deadlines.sql',import.meta.url),'utf8'))
 assert.deepEqual(await snapshot(),before)
 }finally{await db.close()}
})
