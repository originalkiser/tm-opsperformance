// Run against isolated PostgreSQL with PGLITE_MODULE set to the installed PGlite entry point.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../../app/supabase/migrations/20261123001213_weekly_labor_planner.sql', import.meta.url)
const mine = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const employee = '00000000-0000-4000-8000-000000000003'
const week = '2026-11-22'
const siteArgs = [mine, week]
const otherArgs = [other, week]

test('weekly planner RPCs enforce site scope, revision, cap approval and snapshot retention', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE)
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      create table locations(id uuid primary key, timezone text, operating_hours_override jsonb);
      create table user_profiles(id uuid primary key, role text, location_id uuid, is_active boolean, deleted_at timestamptz);
      create table employees(id uuid primary key, location_id uuid, is_active boolean);
      create table app_settings(key text primary key,value jsonb);
      create table budget_targets(location_id uuid, target_month date, labor_hours_non_salary numeric,
        labor_hours_with_salary numeric, full_service_labor_percentage numeric, primary key(location_id,target_month));
      insert into locations values ('${mine}','America/Chicago',null), ('${other}','America/New_York',null);
      insert into user_profiles values ('${mine}','store','${mine}',true,null), ('${other}','admin',null,true,null),
        ('${employee}','admin',null,false,null);
      insert into employees values ('${employee}','${other}',true);
      insert into app_settings values ('operating_hours','{"active":"winter"}'), ('private_config','{"value":"hidden"}');
      insert into budget_targets values ('${mine}','2026-11-01',150,195,null), ('${other}','2026-11-01',0,0,0.2);
    `)
    await db.exec(await readFile(migration, 'utf8'))
    const who = id => db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}';`)
    const fetch = async args => (await db.query('select public.weekly_labor_planner($1,$2) result', args)).rows[0].result
    const approve = args => db.query('select public.approve_weekly_labor_cap($1,$2,$3)', args)
    const save = async (args, revision, plan) => (await db.query('select public.save_weekly_labor_plan($1,$2,$3,$4) revision',
      [...args, revision, JSON.stringify(plan)])).rows[0].revision
    await db.exec('set role anon')
    await assert.rejects(fetch(siteArgs), { code: '42501' })
    await who(employee)
    await assert.rejects(fetch(siteArgs), { code: '42501' })
    await who(mine)
    const site = await fetch(siteArgs)
    assert.deepEqual(site.network, { active: 'winter' })
    assert.equal(site.target.labor_hours_with_salary, 195)
    assert.equal(site.draft, null)
    await assert.rejects(fetch(otherArgs), { code: '42501' })
    await assert.rejects(approve([...otherArgs, 180]), { code: '42501' })
    await assert.rejects(approve([...siteArgs, 180]), { code: '42501' })
    await assert.rejects(db.query('select * from labor_planner_private.drafts'), { code: '42501' })
    const hours = { monSat: { open: '08:00', close: '19:00' }, sun: { open: '08:00', close: '18:00' } }
    const plan = {
      inputs: { hours, timezone: 'America/Chicago', traffic: {}, trafficEnd: week,
        settings: { prep: 30, middayStart: 660, middayEnd: 900, peak: 40 },
        budget: { method: 'hours', hourly: 150, combined: 195, percentage: null } },
      shifts: [],
    }
    await assert.rejects(save(otherArgs, 0, plan), { code: '42501' })
    await assert.rejects(save(siteArgs, 0, { ...plan, shifts: [{ day: 1, role: 'GM', employeeId: employee }] }), { code: '42501' })
    assert.equal(await save(siteArgs, 0, plan), 1)
    await assert.rejects(save(siteArgs, 0, plan), { code: '40001' })
    assert.deepEqual((await fetch(siteArgs)).draft, { plan, revision: 1 })
    await db.exec(`reset role; update app_settings set value = '{"active":"standard"}' where key = 'operating_hours';
      update budget_targets set labor_hours_with_salary = 200 where location_id = '${mine}';`)
    await who(other)
    assert.equal((await fetch(siteArgs)).draft.plan.inputs.hours.monSat.close, '19:00')
    assert.equal(await save(siteArgs, 1, plan), 2)
    await assert.rejects(save(siteArgs, 1, plan), { code: '40001' })
    assert.equal((await fetch(otherArgs)).cap, null)
    await approve([...otherArgs, 180])
    assert.equal((await fetch(otherArgs)).cap, 180)
    const fullService = { ...plan, inputs: { ...plan.inputs,
      budget: { method: 'percentage', hourly: null, combined: 180, percentage: 0.2 } } }
    await assert.rejects(save(otherArgs, 0, { ...fullService, inputs: { ...fullService.inputs,
      budget: { ...fullService.inputs.budget, combined: 181 } } }), /Labor targets changed or are invalid/)
    assert.equal(await save(otherArgs, 0, fullService), 1)
    assert.equal((await fetch(otherArgs)).draft.plan.inputs.budget.combined, 180)
  } finally {
    await db.close()
  }
})
