// Actual in-memory PostgreSQL with fictional users/storage only; never production.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {setup,root,actor,start,ready,upload,saveNew,allAnswers,admin,store,uuid,guest,configure} from './helpers/checklistPhotoFixture.mjs'
import { newChecklistQuestion } from '../../app/src/utils/checklistTemplateEditor.js'
const old=readFileSync(new URL('../../app/supabase/migrations/20261118145030_super_admin_checklist_editor.sql',import.meta.url),'utf8')
const migration=readFileSync(new URL('../../app/supabase/migrations/20261120205632_checklist_na_configuration.sql',import.meta.url),'utf8')
const ordinary=uuid(70)
async function fixture(){
 const {db,today}=await setup()
 await db.exec('reset role;alter table public.user_profiles add column email text;alter table public.user_profiles add column settings jsonb default \'{}\';')
 await db.query("insert into public.user_profiles(id,role,is_active,name) values($1,'admin',true,'Fictional ordinary Admin')",[ordinary])
 await db.exec(old)
 const before=(await db.query("select md5(string_agg(coalesce(proacl::text,''),'|' order by oid)) hash from pg_proc where pronamespace in ('configuration_private'::regnamespace,'checklist_private'::regnamespace)")).rows[0].hash
 await db.exec(migration)
 assert.equal((await db.query("select md5(string_agg(coalesce(proacl::text,''),'|' order by oid)) hash from pg_proc where pronamespace in ('configuration_private'::regnamespace,'checklist_private'::regnamespace)")).rows[0].hash,before)
 await db.query('insert into configuration_private.super_admins(user_id) values($1)',[admin])
 await actor(db,admin)
 return {db,today}
}
async function editor(db,action,state=null,definition=null,extra={}){
 return (await db.query('select public.checklist_template_editor($1,$2,$3,$4,$5::jsonb,$6,$7) result',[action,extra.key||'midday',state?.draft?.revision??0,state?.published.version??null,definition?JSON.stringify(definition):null,'Fictional N/A change',extra.restore??null])).rows[0].result
}
async function publish(db,state,definition){state=await editor(db,'save',state,definition);await editor(db,'preview',state);return editor(db,'publish',state)}
test('only Super Admins can configure N/A; private helpers and legacy immediate publisher cannot bypass permissions',async()=>{
 const {db}=await fixture();try{
  for(const who of [ordinary,store]){await actor(db,who);await assert.rejects(editor(db,'read'),/Super Admin/);await assert.rejects(db.query("select configuration_private.validate_template('midday','[]')"),/permission denied/);await assert.rejects(db.query("select public.configure_checklist_pilot('template','{}')"),/Super Admin/)}
  await actor(db,'','anon');await assert.rejects(editor(db,'read'),/permission denied/)
  await actor(db,admin);await assert.rejects(db.query("select public.configure_checklist_pilot('template','{}')"),/immediate publishing is disabled/)
  await root(db,"update public.user_profiles set is_active=false where id=$1",[admin]);await assert.rejects(editor(db,'read'),/Super Admin/)
 }finally{await db.close()}
})
test('N/A draft/preview/publish changes only future snapshots; reasons and two valid photos remain mandatory',async()=>{
 const {db,today}=await fixture();try{
  const oldDraft=(await start(db)).submission
  await actor(db,admin)
  let state=await editor(db,'read'),definition=structuredClone(state.published.definition),first=definition[0]
  first.na_allowed=true;first.critical=true;first.photo_required=true;first.photo_min_count=2
  const original=JSON.stringify(oldDraft.template_snapshot)
  const draft=await editor(db,'save',state,definition)
  assert.equal(draft.published.definition[0].na_allowed,false);assert.equal(draft.draft.definition[0].na_allowed,true)
  await assert.rejects(editor(db,'publish',draft),/Preview/)
  const preview=await editor(db,'preview',draft);assert.equal(preview.definition[0].na_allowed,true)
  state=await editor(db,'publish',draft)
  assert.equal(state.published.version,draft.published.version+1)
  assert.equal(JSON.stringify((await root(db,'select template_snapshot from public.checklist_submissions where id=$1',[oldDraft.id]))[0].template_snapshot),original)
  const badOld=allAnswers(oldDraft);badOld[first.id]={value:'N/A',explanation:'Not applicable'}
  await assert.rejects(saveNew(db,oldDraft,false,store,null,badOld),/Invalid answer/)
  const yesterday=(await root(db,'select ($1::date-1)::text d',[today]))[0].d
  const row=(await start(db,'midday',store,null,yesterday)).submission
  await ready(db,row)
  const answers=allAnswers(row);answers[first.id]={value:'N/A',explanation:''}
  await assert.rejects(saveNew(db,row,true,store,null,answers),/Explanation required/)
  answers[first.id].explanation='Fictional reason why not applicable'
  await assert.rejects(saveNew(db,row,true,store,null,answers),/needs 2, has 1/)
  await upload(db,row,first.id,'photo')
  const submitted=(await saveNew(db,row,true,store,null,answers)).submission
  assert.equal(submitted.status,'submitted');assert.equal(submitted.answers[first.id].value,'N/A')
  await actor(db,admin);definition=structuredClone(state.published.definition);definition[0].na_allowed=false
  state=await publish(db,state,definition)
  assert.equal(state.published.definition[0].na_allowed,false)
  assert.equal((await root(db,'select template_snapshot from public.checklist_submissions where id=$1',[row.id]))[0].template_snapshot.definition[0].na_allowed,true)
  state=await editor(db,'restore',state,null,{restore:draft.published.version})
  await editor(db,'preview',state);state=await editor(db,'publish',state)
  assert.equal(state.published.definition[0].na_allowed,false)
 }finally{await db.close()}
})
test('new choice questions support N/A; forged response/signature/conditional flags and nonbooleans stay rejected',async()=>{
 const {db}=await fixture();try{
  let state=await editor(db,'read'),definition=structuredClone(state.published.definition)
  const q={...newChecklistQuestion('yesno',definition.at(-1).section),na_allowed:true};definition.push(q)
  state=await publish(db,state,definition);assert.equal(state.published.definition.at(-1).na_allowed,true)
  for(const patch of [{na_allowed:'true'},{options:['Yes','No','N/A']},{failure_values:[]},{signature_required:false},{condition:{item_id:'foreign',value:'No'}}]){
   const bad=structuredClone(state.published.definition);Object.assign(bad[0],patch)
   await assert.rejects(editor(db,'save',state,bad),/Protected|flags|boolean/)
  }
  const bad=structuredClone(state.published.definition);bad.push({...newChecklistQuestion('text',bad.at(-1).section),na_allowed:true})
  await assert.rejects(editor(db,'save',state,bad),/flags/)
  await assert.rejects(db.exec(migration),/differs from the reviewed baseline/);await db.exec('rollback')
 }finally{await db.close()}
})
test('QR uses the same published N/A and reason rules and cannot access Management Audits',async()=>{
 const {db}=await fixture();try{
  let state=await editor(db,'read'),definition=structuredClone(state.published.definition);definition[0].na_allowed=true
  state=await publish(db,state,definition)
  await configure(db)
  const row=(await guest(db,'start',{template_key:'midday'})).submission,answers=allAnswers(row)
  answers[definition[0].id]={value:'N/A',explanation:''}
  await assert.rejects(guest(db,'save',{id:row.id,revision:row.revision,answers,manager_name:'Fictional',submit:true}),/Explanation required/)
  answers[definition[0].id].explanation='Fictional QR reason'
  assert.equal((await guest(db,'save',{id:row.id,revision:row.revision,answers,manager_name:'Fictional',submit:false})).submission.answers[definition[0].id].value,'N/A')
  await assert.rejects(guest(db,'start',{template_key:'monthly_site_assessment'}),/Authenticated checklist/)
 }finally{await db.close()}
})


test('N/A on an existing Weekly PM signature question cannot skip its item or final signature',async()=>{
 const {db}=await fixture();try{
  const extra={key:'weekly_pm'}
  let state=await editor(db,'read',null,null,extra),definition=structuredClone(state.published.definition)
  const target=definition.find(i=>i.signature_required&&!i.condition);assert.ok(target)
  target.na_allowed=true
  state=await editor(db,'save',state,definition,extra);await editor(db,'preview',state,null,extra);state=await editor(db,'publish',state,null,extra)
  const row=(await start(db,'weekly_pm')).submission,answers=allAnswers(row)
  answers[target.id]={value:'N/A',explanation:'Fictional equipment not present; signatures retained'}
  for(const item of row.template_snapshot.definition){if(item.photo_required)await upload(db,row,item.id,'photo');if(item.signature_required&&item.id!==target.id)await upload(db,row,item.id,'signature')}
  await upload(db,row,null,'signature')
  await assert.rejects(saveNew(db,row,true,store,null,answers),/Item signature required/)
  await upload(db,row,target.id,'signature')
  assert.equal((await saveNew(db,row,true,store,null,answers)).submission.status,'submitted')
 }finally{await db.close()}
})
