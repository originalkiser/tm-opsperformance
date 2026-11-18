// Release regression tests. Isolated PostgreSQL; fictional identities only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setup, root, actor, api, start, upload, saveNew, admin, away } from './helpers/checklistPhotoFixture.mjs'
const migration=readFileSync(new URL('../../app/supabase/migrations/20261118145030_super_admin_checklist_editor.sql',import.meta.url),'utf8')
test('already-used checklist save plans enforce new photo counts after validator rename',async()=>{
 const {db}=await setup();try{
  const original=(await start(db)).submission
  await saveNew(db,original,false) // Warm the pre-install access/save/validator plans.
  await db.exec('reset role');await db.exec(migration)
  await root(db,'insert into configuration_private.super_admins(user_id) values($1)',[admin]);await actor(db,admin)
  let state=(await db.query("select public.checklist_template_editor('read','midday') result")).rows[0].result
  const definition=structuredClone(state.published.definition)
  definition[0].photo_min_count=2;definition[0].photo_required=true
  state=(await db.query("select public.checklist_template_editor('save','midday',0,$1,$2::jsonb) result",[state.published.version,JSON.stringify(definition)])).rows[0].result
  await db.query("select public.checklist_template_editor('preview','midday',$1,$2)",[state.draft.revision,state.published.version])
  await db.query("select public.checklist_template_editor('publish','midday',$1,$2,null,'Fictional release test')",[state.draft.revision,state.published.version])
  const row=(await api(db,'start',{location_id:away,template_key:'midday'},admin)).submission
  await upload(db,row,null,'signature',admin)
  await upload(db,row,definition[0].id,'photo',admin)
  await assert.rejects(saveNew(db,row,true,admin),/needs 2, has 1/)
 }finally{await db.close()}
})
