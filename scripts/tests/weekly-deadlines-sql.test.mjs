// Disposable PostgreSQL and fictional identities only. No network/hosted calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {setup,root,actor,api,start,ready,saveNew,configure,guest,site,away,admin,store} from './helpers/checklistPhotoFixture.mjs'
const file=n=>readFileSync(new URL(`../../app/supabase/migrations/${n}`,import.meta.url),'utf8')
const migration=file('20261118182305_weekly_submission_deadlines.sql')
async function fixture({activate=true,clock='2026-11-30T20:00:00Z'}={}) {
 const {db}=await setup();await db.exec('reset role')
 await db.exec("alter table user_profiles add column email text;alter table user_profiles add column settings jsonb default '{}';alter table locations add column name text;alter table locations add column market text")
 await db.exec(file('20261118145030_super_admin_checklist_editor.sql'))
 await db.query('insert into configuration_private.super_admins(user_id) values($1)',[admin])
 await db.exec(file('20261111200615_checklist_compliance_report.sql'))
 // Deterministic fixture clock ONLY; no test clock or client clock GUC exists in the migration.
 await db.exec(`create function checklist_private.test_now() returns timestamptz language sql stable as $$select coalesce(nullif(current_setting('tmops.test_now',true),'')::timestamptz,clock_timestamp())$$`)
 await db.query("select set_config('tmops.test_now','2026-11-18T18:00:00Z',false)")
 await db.exec(migration.replaceAll('clock_timestamp()','checklist_private.test_now()'))
 if(activate) await db.exec('update checklist_private.weekly_deadline_policy set activated_at=checklist_private.test_now() where singleton')
 const funcs=(await db.query(`select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='checklist_private' and p.proname in ('access_action','reply','guard_evidence_insert','compliance_summary','authenticated_weekly_periods')`)).rows
 for(const {def} of funcs) await db.exec(def.replaceAll('clock_timestamp()','checklist_private.test_now()'))
 const summaries=(await db.query("select pg_get_functiondef('checklist_private.compliance_summary(date,date)'::regprocedure) def")).rows[0].def
 await db.exec(summaries.replace(/\bnow\(\)/g,'checklist_private.test_now()'))
 const options=(await db.query("select pg_get_functiondef('checklist_private.authenticated_weekly_periods(uuid,date)'::regprocedure) def")).rows[0].def
 await db.exec(options.replace(/\bnow\(\)/g,'checklist_private.test_now()'))
 await time(db,clock);return db
}
async function time(db,value){await root(db,"select set_config('tmops.test_now',$1,false)",[value])}
async function report(db,start='2026-11-23',end='2026-11-29'){await actor(db,admin);return (await db.query('select public.get_checklist_compliance($1,$2,1) j',[start,end])).rows[0].j}

test('inactive until release; one-time activation, next full local week, historical behavior and denied API provisioning',async()=>{
 const db=await fixture({activate:false});try{
  assert.equal((await root(db,"select checklist_private.weekly_due('weekly','2026-11-23','America/Los_Angeles') d"))[0].d,null)
  await actor(db,store);await assert.rejects(db.query('select * from checklist_private.weekly_deadline_policy'),/permission denied/)
  await time(db,'2026-11-18T18:00:00Z');await db.exec('reset role');await db.exec('update checklist_private.weekly_deadline_policy set activated_at=checklist_private.test_now() where singleton');await time(db,'2026-11-30T20:00:00Z');await db.exec('reset role')
  await assert.rejects(db.exec('update checklist_private.weekly_deadline_policy set activated_at=clock_timestamp() where singleton'),/one-time/)
  await assert.rejects(db.exec('delete from checklist_private.weekly_deadline_policy'),/one-time/)
  assert.equal((await db.query("select checklist_private.weekly_policy_start('America/Los_Angeles')::text d")).rows[0].d,'2026-11-23')
  assert.equal((await db.query("select checklist_private.weekly_due('weekly','2026-11-16','America/Los_Angeles') d")).rows[0].d,null)
  const historical=await start(db,'weekly',store,null,'2026-11-16');await ready(db,historical.submission)
  const submitted=await saveNew(db,historical.submission,true);assert.equal(submitted.capabilities.weekly_timing,null)
  assert.equal(new Date(submitted.capabilities.edit_deadline_at).toISOString(),'2026-11-23T08:00:00.000Z')
  assert.equal((await report(db,'2026-11-16','2026-11-22')).weekly_periods.length,0)
 }finally{await db.close()}
})

test('local calendar deadlines cover DST, UTC boundaries, both weekly keys and unchanged Daily/Audits',async()=>{
 const db=await fixture();try{
  for(const [week,tz,expected] of [['2027-03-08','America/Los_Angeles','2027-03-16T07:00:00.000Z'],['2027-11-01','America/Los_Angeles','2027-11-09T08:00:00.000Z'],['2026-11-23','America/New_York','2026-12-01T05:00:00.000Z'],['2026-11-23','America/Phoenix','2026-12-01T07:00:00.000Z']]){
   for(const key of ['weekly','weekly_pm']) assert.equal(new Date((await root(db,'select checklist_private.weekly_due($1,$2,$3) d',[key,week,tz]))[0].d).toISOString(),expected)
  }
  for(const key of ['opening','midday','closing','monthly_site_assessment','quarterly_safety_audit']) assert.equal((await root(db,'select checklist_private.weekly_due($1,$2,$3) d',[key,'2026-11-23','America/Los_Angeles']))[0].d,null)
  const firstMonday=(await root(db,"select checklist_private.weekly_options('America/Los_Angeles','2026-11-23T20:00:00Z') j"))[0].j
  assert.deepEqual(firstMonday.map(p=>p.period_date),['2026-11-16','2026-11-23']);assert.equal(firstMonday[0].legacy_carryover,true)
  for(const [stamp,phase] of [['2026-12-01T07:59:59.999Z','in_progress'],['2026-12-01T08:00:00Z','overdue']]) assert.equal((await root(db,"select checklist_private.weekly_timing('weekly','2026-11-23','America/Los_Angeles','draft',null,$1)->>'phase' p",[stamp]))[0].p,phase)
 }finally{await db.close()}
})

test('QR Monday carryover, late new starts, original week, immutable late status, correction and compliance enforcement',async()=>{
 const db=await fixture();try{
  await configure(db)
  let ctx=await guest(db,'context');assert.deepEqual(ctx.weekly_periods.map(p=>p.period_date),['2026-11-23','2026-11-30'])
  const first=(await guest(db,'start',{template_key:'weekly',period_date:'2026-11-23'})).submission
  const second=(await guest(db,'start',{template_key:'weekly_pm',period_date:'2026-11-23'})).submission
  await assert.rejects(guest(db,'start',{template_key:'weekly',period_date:'2026-11-16'}),/current checklist period/)
  await ready(db,first,null,'a'.repeat(64));await ready(db,second,null,'a'.repeat(64))
  await time(db,'2026-12-01T07:59:59.999Z')
  const ontime=await saveNew(db,first,true,null,'a'.repeat(64));assert.equal(ontime.submission.period_date,'2026-11-23');assert.equal(ontime.capabilities.weekly_timing.phase,'submitted_on_time')
  await guest(db,'begin_edit',{id:first.id,revision:ontime.submission.revision})
  await time(db,'2026-12-01T08:00:00Z')
  const late=await saveNew(db,second,true,null,'a'.repeat(64));assert.equal(late.submission.period_date,'2026-11-23');assert.equal(late.capabilities.weekly_timing.phase,'completed_late');assert.equal(late.capabilities.can_begin_edit,false)
  await assert.rejects(guest(db,'begin_edit',{id:second.id,revision:late.submission.revision}),/window is closed/)
  const official=await api(db,'read',{id:second.id},admin);assert.equal(official.submission.submitted_at,late.submission.submitted_at)
  let r=await report(db);let period=r.weekly_periods.find(p=>p.location_id===site);assert.equal(period.score,0)
  await assert.rejects(db.query('select public.get_checklist_compliance($1,$2)',['2026-11-23','2026-11-29']),/Refresh TM Ops/)
  await time(db,'2026-12-05T20:00:00Z');r=await report(db);assert.equal(r.submissions.find(s=>s.template_key==='weekly_pm').weekly_timing.phase,'completed_late');assert.equal(r.weekly_periods.find(p=>p.location_id===site).score,0)
  // Another site: two on-time completions yield 100; no timezone/owner cross-over.
  await time(db,'2026-11-30T20:00:00Z')
  for(const key of ['weekly','weekly_pm']) {const row=(await api(db,'start',{location_id:away,template_key:key,period_date:'2026-11-23'},admin)).submission;await ready(db,row,admin);await saveNew(db,row,true,admin)}
  const complete=await report(db);assert.equal(complete.weekly_periods.find(p=>p.location_id===away).score,100)
 }finally{await db.close()}
})

test('corrections retain first submission timing and signatures, and pending correction uploads expire at Tuesday midnight',async()=>{
 const db=await fixture({clock:'2026-12-01T07:50:00Z'});try{
  let row=(await start(db,'weekly',store,null,'2026-11-23')).submission;await ready(db,row)
  let saved=await saveNew(db,row,true);const firstAt=saved.submission.submitted_at
  let correction=await api(db,'begin_edit',{id:row.id,revision:saved.submission.revision});assert.equal(correction.capabilities.can_edit,true)
  await ready(db,correction.submission);saved=await saveNew(db,correction.submission,true)
  assert.equal(saved.submission.submitted_at,firstAt);assert.equal(saved.capabilities.weekly_timing.phase,'submitted_on_time')
  correction=await api(db,'begin_edit',{id:row.id,revision:saved.submission.revision})
  await time(db,'2026-12-01T07:59:59.999Z')
  const intent=await api(db,'upload_begin',{id:row.id,working_copy_id:correction.submission.working_copy_id,kind:'signature',item_id:null,extension:'png'})
  assert.equal(new Date((await root(db,'select expires_at from checklist_private.upload_intents where id=$1',[intent.upload_id]))[0].expires_at).toISOString(),'2026-12-01T08:00:00.000Z')
  await time(db,'2026-12-01T08:00:00Z')
  await db.exec('reset role')
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata) values('manager-checklist-evidence',$1,'{}')",[intent.object_path]),/expired|editable|window|revoked/i)
  await assert.rejects(api(db,'save',{id:row.id,working_copy_id:correction.submission.working_copy_id,revision:correction.submission.revision,answers:{},manager_name:'Fictional',submit:false}),/no longer editable/)
  const review=await api(db,'read',{id:row.id},admin);assert.equal(review.submission.submitted_at,firstAt);assert.equal(review.capabilities.can_begin_edit,false)
 }finally{await db.close()}
})

test('Tuesday late initial drafts remain editable and QR can start a missed new-policy week; scopes and audit QR exclusion remain',async()=>{
 const db=await fixture({clock:'2026-12-01T09:00:00Z'});try{
  await configure(db)
  const late=(await guest(db,'start',{template_key:'weekly',period_date:'2026-11-23'})).submission
  assert.equal(late.weekly_timing.phase,'overdue')
  const saved=await saveNew(db,late,false,null,'a'.repeat(64));assert.equal(saved.capabilities.can_edit,true);assert.equal(saved.submission.period_date,'2026-11-23')
  await assert.rejects(guest(db,'start',{template_key:'monthly_site_assessment',period_date:'2026-11-01'}),/Authenticated checklist/)
  await assert.rejects(guest(db,'start',{template_key:'opening',period_date:'2026-11-30'}),/current checklist period/)
  await actor(db,store)
  const periods=(await db.query('select public.checklist_weekly_periods($1,$2) j',[site,'2026-12-01'])).rows[0].j
  assert.deepEqual(periods.map(p=>p.period_date),['2026-11-23','2026-11-30']);assert.equal(periods[0].checklists.weekly.phase,'overdue')
  await actor(db,'','anon');await assert.rejects(db.query('select public.checklist_weekly_periods($1,$2)',[site,'2026-12-01']),/permission denied/)
  assert.equal((await root(db,'select count(*)::int n from configuration_private.super_admins'))[0].n,1)
 }finally{await db.close()}
})

test('install and activation do not rewrite existing templates, accounts, snapshots, evidence, working copies or history',async()=>{
 const {db}=await setup();try{
  const row=(await start(db,'weekly',store,null,'2026-11-16')).submission;await ready(db,row);const submitted=await saveNew(db,row,true);await api(db,'begin_edit',{id:row.id,revision:submitted.submission.revision})
  await db.exec('reset role')
  const tables=['public.user_profiles','public.manager_locations','public.checklist_templates','public.checklist_submissions','public.checklist_attachments','checklist_private.working_copies','checklist_private.versions','public.edit_audit_log','checklist_private.photo_fingerprints','checklist_private.photo_claims','checklist_private.photo_rollout','checklist_private.upload_intents','storage.buckets','storage.objects']
  const snapshot=async()=>Promise.all(tables.map(async t=>(await db.query(`select coalesce(jsonb_agg(x order by x::text),'[]') j from (select to_jsonb(t) x from ${t} t) rows`)).rows[0].j))
  const before=await snapshot();await db.exec(migration);await db.exec('update checklist_private.weekly_deadline_policy set activated_at=clock_timestamp() where singleton');assert.deepEqual(await snapshot(),before)
  const guards=(await db.query("select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')) denied from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='checklist_private' and p.proname like 'weekly_%') or (n.nspname='public' and p.proname='checklist_weekly_periods')")).rows[0]
  assert.equal(guards.denied,true)
 }finally{await db.close()}
})

test('release near Monday midnight selects the first full week separately in each site timezone',async()=>{
 const db=await fixture({activate:false});try{
  await time(db,'2026-11-23T05:30:00Z');await db.exec('reset role')
  await db.exec('update checklist_private.weekly_deadline_policy set activated_at=checklist_private.test_now() where singleton')
  const rows=(await db.query("select checklist_private.weekly_policy_start('America/New_York')::text east,checklist_private.weekly_policy_start('America/Los_Angeles')::text west")).rows[0]
  assert.equal(rows.east,'2026-11-30');assert.equal(rows.west,'2026-11-23')
  await assert.rejects(db.query('select public.get_checklist_compliance($1,$2,0)',['2026-11-23','2026-11-29']),/Refresh TM Ops/)
 }finally{await db.close()}
})

test('older never-started QR weeks remain available late without exposing pre-policy starts',async()=>{
 const db=await fixture({clock:'2026-12-14T20:00:00Z'});try{
  await configure(db)
  const c=await guest(db,'context');const old=c.weekly_periods.find(p=>p.period_date==='2026-11-23')
  assert.equal(old.older,true);assert.equal(old.recent,false);assert.equal(old.weekly_timing.phase,'overdue')
  assert.equal(c.weekly_periods.some(p=>p.period_date==='2026-11-16'),false)
  const row=(await guest(db,'start',{template_key:'weekly',period_date:'2026-11-23'})).submission
  await ready(db,row,null,'a'.repeat(64));const late=await saveNew(db,row,true,null,'a'.repeat(64))
  assert.equal(late.submission.period_date,'2026-11-23');assert.equal(late.capabilities.weekly_timing.phase,'completed_late')
  const reloaded=await guest(db,'context');assert.equal(reloaded.submissions.find(r=>r.id===row.id).weekly_timing.phase,'completed_late')
 }finally{await db.close()}
})
