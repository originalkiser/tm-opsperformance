// Real in-memory PostgreSQL, fictional accounts/evidence only; no Supabase connection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {setup,root,actor,start,ready,upload,saveNew,allAnswers,admin,store,uuid,guest,configure} from './helpers/checklistPhotoFixture.mjs'
const sql = name => readFileSync(new URL('../../app/supabase/migrations/'+name,import.meta.url),'utf8')
const migration=sql('20261120213643_checklist_question_removal.sql'),ordinary=uuid(70)
async function fixture(){
 const {db,today}=await setup()
 await db.exec("reset role;alter table public.user_profiles add column email text;alter table public.user_profiles add column settings jsonb default '{}';")
 await db.query("insert into public.user_profiles(id,role,is_active,name) values($1,'admin',true,'Fictional ordinary Admin')",[ordinary])
 await db.exec(sql('20261118145030_super_admin_checklist_editor.sql'))
 await db.exec(sql('20261120205632_checklist_na_configuration.sql'))
 const fingerprint=async()=> (await db.query("select md5(string_agg(coalesce(proacl::text,'')||prosecdef::text||coalesce(proconfig::text,''),'|' order by oid)) h from pg_proc where pronamespace in ('configuration_private'::regnamespace,'checklist_private'::regnamespace)")).rows[0].h
 const before=await fingerprint();await db.exec(migration);assert.equal(await fingerprint(),before)
 await db.query('insert into configuration_private.super_admins(user_id) values($1)',[admin]);await actor(db,admin)
 return {db,today}
}
async function editor(db,action,state=null,definition=null,key='midday',restore=null){return (await db.query('select public.checklist_template_editor($1,$2,$3,$4,$5::jsonb,$6,$7) result',[action,key,state?.draft?.revision??0,state?.published.version??null,definition?JSON.stringify(definition):null,'Fictional removal review',restore])).rows[0].result}
const has = (definition,id) => definition.some(i=>i.id===id)
test('removal requires Super Admin; all write paths, private/direct helpers and legacy publisher fail closed',async()=>{
 const {db}=await fixture();try{
  const state=await editor(db,'read'),definition=state.published.definition.slice(1)
  for(const who of [ordinary,store]){
   await actor(db,who)
   for(const action of ['save','preview','publish','restore'])await assert.rejects(editor(db,action,state,definition,'midday',1),/Super Admin/)
   await assert.rejects(db.query("select configuration_private.validate_template('midday',$1::jsonb)",[JSON.stringify(definition)]),/permission denied/)
   await assert.rejects(db.query("select public.configure_checklist_pilot('template','{}')"),/Super Admin/)
  }
  await actor(db,'','anon');await assert.rejects(editor(db,'save',state,definition),/permission denied/)
  await actor(db,admin);await assert.rejects(db.query("select public.configure_checklist_pilot('template','{}')"),/immediate publishing is disabled/)
  await root(db,'update public.user_profiles set is_active=false where id=$1',[admin]);await assert.rejects(editor(db,'save',state,definition),/Super Admin/)
 }finally{await db.close()}
})
test('draft removal, preview, publish, history and restore preserve original snapshots and evidence',async()=>{
 const {db,today}=await fixture();try{
  const draftDay=(await root(db,'select ($1::date-3)::text d',[today]))[0].d
  const oldDraft=(await start(db,'midday',store,null,draftDay)).submission
  const day=(await root(db,'select ($1::date-1)::text d',[today]))[0].d
  const completed=(await start(db,'midday',store,null,day)).submission
  await ready(db,completed);await saveNew(db,completed,true)
  const before=await root(db,'select row_to_json(s) value from public.checklist_submissions s order by id')
  const files=await root(db,'select row_to_json(a) value from public.checklist_attachments a order by id')
  await actor(db,admin);let state=await editor(db,'read');const version=state.published.version,id=state.published.definition[0].id
  const original=structuredClone(state.published.definition),definition=original.slice(1)
  const stale=structuredClone(state);state=await editor(db,'save',state,definition)
  assert.equal(has(state.published.definition,id),true);assert.equal(has(state.draft.definition,id),false)
  await assert.rejects(editor(db,'save',stale,definition),/changed elsewhere/)
  await assert.rejects(editor(db,'publish',state),/Preview/)
  const preview=await editor(db,'preview',state);assert.equal(has(preview.definition,id),false)
  state=await editor(db,'publish',state);assert.equal(state.published.version,version+1)
  assert.deepEqual((await root(db,'select definition from configuration_private.template_versions where template_key=$1 and version=$2',['midday',version]))[0].definition,original)
  assert.deepEqual(await root(db,'select row_to_json(s) value from public.checklist_submissions s order by id'),before)
  assert.deepEqual(await root(db,'select row_to_json(a) value from public.checklist_attachments a order by id'),files)
  const nextDay=(await root(db,'select ($1::date-2)::text d',[today]))[0].d
  const fresh=(await start(db,'midday',store,null,nextDay)).submission
  assert.equal(has(fresh.template_snapshot.definition,id),false);assert.equal(has(oldDraft.template_snapshot.definition,id),true)
  await configure(db);const qr=(await guest(db,'start',{template_key:'midday'})).submission;assert.equal(has(qr.template_snapshot.definition,id),false)
  await actor(db,admin);const revisions=await editor(db,'revisions');assert.ok(revisions.revisions.some(r=>r.action==='save'&&!has(r.definition,id)));assert.ok(revisions.revisions.some(r=>r.action==='publish'))
  state=await editor(db,'restore',state,null,'midday',version);assert.equal(has(state.draft.definition,id),true);assert.equal(has(state.published.definition,id),false)
  await editor(db,'preview',state);state=await editor(db,'publish',state);assert.equal(state.published.version,version+2);assert.equal(has(state.published.definition,id),true)
  assert.equal(has((await root(db,'select template_snapshot from public.checklist_submissions where id=$1',[fresh.id]))[0].template_snapshot.definition,id),false)
 }finally{await db.close()}
})
test('required signatures, conditional children/parents and whole-chain removal are rejected on every validation path',async()=>{
 const {db}=await fixture();try{
  for(const key of ['weekly_pm','monthly_site_assessment','quarterly_safety_audit']){
   const state=await editor(db,'read',null,null,key),def=state.published.definition
   const child=def.find(i=>i.condition),sig=def.find(i=>i.signature_required);assert.ok(child)
   for(const ids of [[child.id],[child.condition.item_id],[child.id,child.condition.item_id],...(sig?[[sig.id]]:[])]){
    await assert.rejects(editor(db,'save',state,def.filter(i=>!ids.includes(i.id)),key),/Cannot remove/)
   }
  }
  const state=await editor(db,'read',null,null,'weekly'),def=state.published.definition.filter(i=>i.id!=='weekly-9')
  await assert.rejects(editor(db,'save',state,def,'weekly'),/system-dependent/)
  // Simulate an already-saved incompatible draft: preview/publish revalidate too.
  await root(db,"insert into configuration_private.template_drafts(template_key,base_version,revision,definition,editing,updated_by,preview_revision) values('weekly',$1,1,$2,true,$3,1)",[state.published.version,JSON.stringify(def),admin])
  await actor(db,admin);const forged=await editor(db,'read',null,null,'weekly')
  for(const action of ['preview','publish'])await assert.rejects(editor(db,action,forged,null,'weekly'),/system-dependent/)
 }finally{await db.close()}
})
test('empty templates and forged changes stay rejected; remaining IDs/flags and numbering stay valid',async()=>{
 const {db}=await fixture();try{
  let state=await editor(db,'read');const def=structuredClone(state.published.definition)
  await assert.rejects(editor(db,'save',state,[]),/question or size limits/)
  const forged=structuredClone(def.slice(1));forged[0].signature_required=false
  await assert.rejects(editor(db,'save',state,forged),/Protected/)
  const changed=def.slice(1);changed[0].na_allowed=true;changed[0].photo_required=true;changed[0].photo_min_count=2
  state=await editor(db,'save',state,changed)
  assert.deepEqual(state.draft.definition.map(i=>i.id),changed.map(i=>i.id));assert.equal(state.draft.definition[0].number,1)
  assert.equal(state.draft.definition[0].na_allowed,true);assert.equal(state.draft.definition[0].photo_min_count,2)
  await db.exec('reset role');await assert.rejects(db.exec(migration),/differs from the reviewed baseline/);await db.exec('rollback')
 }finally{await db.close()}
})
