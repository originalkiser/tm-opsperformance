// In-memory Postgres and fictional accounts only. Never contacts production.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setup, actor, root, uuid, admin, store } from './helpers/checklistPhotoFixture.mjs'
import { budgetLabelFields } from '../../app/src/utils/budgetLabels.js'
const superMigration = readFileSync(new URL('../../app/supabase/migrations/20261118145030_super_admin_checklist_editor.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../app/supabase/migrations/20261119134744_budget_tracker_labels.sql', import.meta.url), 'utf8')
const ordinary = uuid(70), second = uuid(71)
async function fixture() {
  const { db } = await setup()
  await db.exec('reset role')
  await db.exec(`alter table public.user_profiles add column email text; alter table public.user_profiles add column settings jsonb default '{}'; insert into public.user_profiles(id,role,is_active,name) values('${ordinary}','admin',true,'Fictional ordinary Admin'),('${second}','admin',true,'Fictional second Super Admin')`)
  await db.exec(superMigration)
  const before = await db.query("select md5(string_agg(p.prosrc,'' order by p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','checklist_private')")
  await db.exec(migration)
  assert.deepEqual((await db.query("select md5(string_agg(p.prosrc,'' order by p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','checklist_private') and p.proname not in ('budget_tracker_labels','budget_tracker_label_editor')")).rows, before.rows)
  await actor(db, admin)
  return db
}
async function seed(db) { await root(db, 'insert into configuration_private.super_admins(user_id) values($1),($2)', [admin, second]); await actor(db, admin) }
async function editor(db, action, key = null, revision = null, label = null, helper = null) {
  return (await db.query('select public.budget_tracker_label_editor($1,$2,$3,$4,$5) result', [action, key, revision, label, helper])).rows[0].result
}
async function read(db) { return (await db.query('select public.budget_tracker_labels() result')).rows[0].result }

test('installation seeds only the fixed wording catalog, grants nobody, and preserves existing functions/data', async () => {
  const db = await fixture()
  try {
    assert.equal((await root(db, 'select count(*)::integer n from configuration_private.super_admins'))[0].n, 0)
    assert.deepEqual(await read(db), budgetLabelFields.map(({ id, label, helper }) => ({ id, label, helper })))
    assert.equal((await root(db, 'select value::text from public.actuals'))[0].value, '123.456')
    assert.equal((await root(db, 'select goal::text from public.budget_targets'))[0].goal, '987.654')
    assert.equal((await root(db, 'select count(*)::integer n from public.checklist_templates'))[0].n, 7)
    assert.equal((await root(db, 'select count(*)::integer n from configuration_private.budget_label_history'))[0].n, 0)
  } finally { await db.close() }
})

test('ordinary Admin/Store can read effective labels but cannot read editor/history, write, bypass RLS or grant themselves access', async () => {
  const db = await fixture()
  try {
    await seed(db)
    for (const id of [ordinary, store]) {
      await actor(db, id)
      assert.equal((await read(db)).length, 21)
      for (const action of ['read', 'save', 'restore']) await assert.rejects(editor(db, action, 'yesterday-washes', 0, 'Bypass', ''), /Super Admin/)
      for (const table of ['budget_labels', 'budget_label_history']) {
        await assert.rejects(db.query(`select * from configuration_private.${table}`), /permission denied/)
        await assert.rejects(db.query(`delete from configuration_private.${table}`), /permission denied/)
      }
      await assert.rejects(db.query("update configuration_private.budget_labels set label='Bypass'"), /permission denied/)
      await assert.rejects(db.query('insert into configuration_private.super_admins(user_id) values($1)', [id]), /permission denied/)
    }
    for (const role of ['anon', 'service_role']) {
      await actor(db, '', role)
      await assert.rejects(read(db), /permission denied/)
      await assert.rejects(editor(db, 'read'), /permission denied/)
    }
    await actor(db, '')
    await assert.rejects(read(db), /Active Budget Tracker/)
    await assert.rejects(editor(db, 'read'), /Super Admin/)
  } finally { await db.close() }
})

test('only the two existing capability holders save/restore; immutable private history retains actor, time and exact previous/new text', async () => {
  const db = await fixture()
  try {
    await seed(db)
    let state = await editor(db, 'save', 'yesterday-washes', 0, '  Daily wash total  ', 'Record the prior business day.\nInclude all washes.')
    let item = state.items.find(i => i.id === 'yesterday-washes')
    assert.equal(item.label, 'Daily wash total'); assert.equal(item.revision, 1)
    assert.equal(state.history[0].previous_label, 'Yesterday Washes')
    assert.equal(state.history[0].new_label, 'Daily wash total')
    assert.equal(state.history[0].actor_name, 'Test Admin')
    assert.ok(Number.isFinite(Date.parse(state.history[0].changed_at)))
    assert.equal('actor' in state.history[0], false)
    assert.equal((await root(db, 'select actor from configuration_private.budget_label_history'))[0].actor, admin)
    await actor(db, store)
    assert.equal((await read(db)).find(i => i.id === item.id).label, 'Daily wash total')
    await actor(db, second)
    state = await editor(db, 'restore', item.id, item.revision)
    item = state.items.find(i => i.id === item.id)
    assert.equal(item.label, 'Yesterday Washes'); assert.equal(item.helper, ''); assert.equal(item.revision, 2)
    assert.equal(state.history[0].action, 'restore'); assert.equal(state.history[0].actor_name, 'Fictional second Super Admin')
    assert.equal(state.history[0].previous_label, 'Daily wash total'); assert.equal(state.history[0].new_label, 'Yesterday Washes')
    await assert.rejects(db.query("update configuration_private.budget_label_history set actor_name='forged'"), /permission denied/)
    await assert.rejects(db.query('delete from configuration_private.budget_label_history'), /permission denied/)
    await editor(db, 'restore', item.id, 2)
    assert.equal((await root(db, 'select count(*)::integer n from configuration_private.budget_label_history'))[0].n, 2, 'no-op restores are not changes')
  } finally { await db.close() }
})

test('rejects arbitrary keys, field identities, malformed text and stale revisions without partial changes', async () => {
  const db = await fixture()
  try {
    await seed(db)
    for (const key of ['__proto__', 'role', 'mtd_membership_actual', 'formula', "yesterday-washes';delete from public.actuals;--"]) await assert.rejects(editor(db, 'save', key, 0, 'X', ''), /approved Budget Tracker field/)
    for (const [label, helper] of [['', ''], ['a'.repeat(101), ''], ['Two\nlines', ''], ['Good', 'a'.repeat(401)], ['Good', '\u0001'], [null, ''], ['Good', null]]) await assert.rejects(editor(db, 'save', 'yesterday-washes', 0, label, helper), /Enter a label/)
    await assert.rejects(editor(db, 'grant', 'yesterday-washes'), /Unsupported/)
    await assert.rejects(editor(db, 'save', 'yesterday-washes', null, 'X', ''), /changed elsewhere/)
    await editor(db, 'save', 'yesterday-washes', 0, 'First edit', '')
    await actor(db, second)
    await assert.rejects(editor(db, 'save', 'yesterday-washes', 0, 'Stale edit', ''), /changed elsewhere/)
    assert.equal((await read(db)).find(i => i.id === 'yesterday-washes').label, 'First edit')
    assert.equal((await root(db, 'select count(*)::integer n from configuration_private.budget_label_history'))[0].n, 1)
    assert.equal((await root(db, 'select value::text from public.actuals'))[0].value, '123.456')
    assert.equal((await root(db, 'select count(*)::integer n from configuration_private.super_admins'))[0].n, 2)
  } finally { await db.close() }
})

test('revocation is enforced immediately and private/public function permissions stay minimal', async () => {
  const db = await fixture()
  try {
    await seed(db)
    await root(db, 'delete from configuration_private.super_admins where user_id=$1', [admin])
    await assert.rejects(editor(db, 'read'), /Super Admin/)
    await actor(db, second)
    await root(db, 'update public.user_profiles set is_active=false where id=$1', [second])
    await assert.rejects(editor(db, 'read'), /Super Admin/)
    await assert.rejects(read(db), /Active Budget Tracker/)
    const state = await root(db, "select bool_and(relrowsecurity) rls from pg_class where oid in ('configuration_private.budget_labels'::regclass,'configuration_private.budget_label_history'::regclass)")
    assert.equal(state[0].rls, true)
    const functions = await root(db, "select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('read_budget_labels','budget_label_editor','budget_tracker_labels','budget_tracker_label_editor')")
    assert.equal(functions.length, 4)
    assert.ok(functions.every(f => f.proconfig.includes('search_path=""')))
    assert.ok(functions.filter(f => f.nspname === 'public').every(f => !f.prosecdef))
  } finally { await db.close() }
})
