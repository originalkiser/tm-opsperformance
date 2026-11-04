// Run with PGLITE_MODULE pointing to an external pinned @electric-sql/pglite
// installation. Only this in-memory PostgreSQL instance receives SQL writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const root = new URL('../../', import.meta.url)
const migration = readFileSync(new URL('app/supabase/migrations/20261103203908_november_daily_revenue_goals.sql', root), 'utf8')
const rollback = readFileSync(new URL('docs/sql/november-budget-schema-ROLLBACK-REVIEW-ONLY.sql', root), 'utf8')
const existing = ['1512','1515','1521','1522','1524','1525','1526','1527','1528','1529']
const missing = ['1508','1511','1516','1517','1518','1519','1520','1530','1531','1532']
const sites = [...existing, ...missing].sort()
const id = site => `00000000-0000-0000-0000-00000000${site}`
function fixture(baselines = {}) {
  const output = spawnSync('python3', [new URL('november_sql_fixture.py', import.meta.url).pathname, JSON.stringify(baselines)], { encoding: 'utf8' })
  assert.equal(output.status, 0, output.stderr)
  return JSON.parse(output.stdout)
}
const approved = sql => sql.replace("tm_ops.november_import_approved = 'false'", "tm_ops.november_import_approved = 'true'").replace(/rollback;\s*$/, 'commit;')
async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select case when current_setting('test.viewer',true)='admin'
        then '10000000-0000-0000-0000-000000000001'::uuid
        else '10000000-0000-0000-0000-000000000002'::uuid end
    $$;
    grant usage on schema auth to authenticated;
    create table public.locations(id uuid primary key,site_code text,
      show_budget_tracking boolean default true,exclude_from_reporting boolean default false);
    create table public.user_profiles(id uuid primary key,role text,is_active boolean,deleted_at timestamptz);
    insert into public.user_profiles values
      ('10000000-0000-0000-0000-000000000001','admin',true,null),
      ('10000000-0000-0000-0000-000000000002','store',true,null);
    alter table public.user_profiles enable row level security;
    create policy own_profile on public.user_profiles for select to authenticated using(id=auth.uid());
    grant select on public.user_profiles,public.locations to authenticated;
    create function public.user_can_edit_location(loc uuid) returns boolean language sql stable as $$
      select current_setting('test.viewer',true)='admin'
        or loc=nullif(current_setting('test.location',true),'')::uuid
    $$;
    create table public.budget_targets(
      id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
      target_month date not null, updated_at timestamptz default now(), revenue_goal numeric not null default 0,
      starting_members integer, membership_daily_growth numeric not null default 2,
      membership_goal integer not null default 0, desired_rating numeric not null default 4.85,
      labor_hours_non_salary numeric not null default 0,labor_hours_with_salary numeric not null default 0,
      unique(location_id,target_month));
    create table public.edit_audit_log(table_name text,location_id uuid,period date,changed_by_name text,
      summary text,old_values jsonb,new_values jsonb);
    create table public.budget_daily_entries(location_id uuid,entry_date date,mtd_revenue_actual numeric,
      unique(location_id,entry_date));
    alter table public.budget_targets enable row level security;
    alter table public.budget_daily_entries enable row level security;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    insert into public.locations(id,site_code) values ${sites.map(s => `('${id(s)}','${s}-Fictional')`).join(',')};
    insert into public.budget_targets(location_id,target_month,revenue_goal,starting_members,membership_goal)
      values ${existing.map(s => `('${id(s)}','2026-11-01',999,100,160)`).join(',')};
    insert into public.budget_targets(location_id,target_month,revenue_goal,starting_members,membership_goal)
      values ('${id('1508')}','2026-10-01',333,200,262);
    insert into public.budget_daily_entries values ('${id('1508')}','2026-11-03',123.45);
  `)
  await db.exec(migration)
  return db
}

test('migration preserves exact decimals and enforces unique keys, FK, finite values and companywide read-only client access', async () => {
  const db = await database()
  try {
    const helper = await db.query("select pg_get_functiondef('public.user_can_edit_location(uuid)'::regprocedure) as definition")
    await assert.rejects(db.exec('update public.budget_targets set full_service_labor_percentage=1.1'))
    await db.exec(`insert into public.budget_daily_revenue_goals values ('${id('1508')}','2026-11-01',1.1234567890123456789,.1234567890123456789,1),('${id('1511')}','2026-11-01',2,1,1)`)
    assert.equal((await db.query('select total_revenue_goal::text as amount from public.budget_daily_revenue_goals order by location_id')).rows[0].amount, '1.1234567890123456789')
    for (const values of [`'${id('1508')}','2026-11-01',1,0,1`, "'99999999-0000-0000-0000-000000000000','2026-11-01',1,0,1", `'${id('1508')}','2026-11-02',-1,0,0`, `'${id('1508')}','2026-11-02','NaN',0,0`]) {
      await assert.rejects(db.exec(`insert into public.budget_daily_revenue_goals values (${values})`))
    }
    await db.exec(`set role authenticated; set test.location='${id('1508')}';`)
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 2)
    await assert.rejects(db.exec('delete from public.budget_daily_revenue_goals'))
    await assert.rejects(db.exec('truncate public.budget_daily_revenue_goals'))
    await db.exec("set test.viewer='admin'")
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 2)
    await assert.rejects(db.exec(`insert into public.budget_daily_revenue_goals values ('${id('1508')}','2026-11-02',1,0,1)`))
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from public.budget_daily_revenue_goals'))
    await db.exec('reset role')
    assert.deepEqual((await db.query("select pg_get_functiondef('public.user_can_edit_location(uuid)'::regprocedure) as definition")).rows, helper.rows)
    await assert.rejects(db.exec(rollback), /Budget data exists/)
    await db.exec('rollback')
  } finally { await db.close() }
})

test('import blocks by default, previews 10 updates/10 deferrals, preserves actuals and other months, and is safe to repeat without duplicates', async () => {
  const db = await database(), generated = fixture()
  try {
    assert.equal(generated.plan.monthly_updates, 10)
    assert.equal(generated.plan.monthly_inserts, 0)
    assert.equal(generated.plan.monthly_deferred.length, 10)
    const preview = await db.exec(generated.preview_sql)
    assert.equal(preview.flatMap(r => r.rows || []).filter(r => r.action?.startsWith('DEFER')).length, 10)
    await assert.rejects(db.exec(generated.sql), /Separate production import approval/)
    await db.exec('rollback')
    await db.exec(approved(generated.sql))
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 600)
    assert.equal((await db.query('select sum(total_revenue_goal)::text as total from public.budget_daily_revenue_goals')).rows[0].total, '600.000600')
    assert.equal((await db.query("select count(*)::int as n from public.budget_targets where target_month='2026-11-01' and starting_members=100 and membership_goal=160")).rows[0].n, 10)
    assert.equal((await db.query("select revenue_goal::text as amount from public.budget_targets where target_month='2026-10-01'")).rows[0].amount, '333')
    assert.equal((await db.query('select mtd_revenue_actual::text as amount from public.budget_daily_entries')).rows[0].amount, '123.45')
    assert.equal((await db.query('select count(*)::int as n from public.edit_audit_log')).rows[0].n, 10)
    await db.exec(approved(generated.sql))
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 600)
    assert.equal((await db.query('select count(*)::int as n from public.edit_audit_log')).rows[0].n, 10)
  } finally { await db.close() }
})

test('only verified missing baselines permit inserts; percentage hours remain placeholders; inventory drift aborts atomically', async () => {
  const db = await database()
  try {
    const generated = fixture({ '1508': { starting_members: 0, verified: true, evidence: 'Fictional verified zero opening count' } })
    assert.equal(generated.plan.monthly_inserts, 1)
    await db.exec(approved(generated.sql))
    const row = (await db.query(`select starting_members,membership_goal,full_service_labor_percentage::text as pct,labor_hours_non_salary::text as hours from public.budget_targets where location_id='${id('1508')}' and target_month='2026-11-01'`)).rows[0]
    assert.deepEqual(row, { starting_members: 0, membership_goal: 60, pct: '0.2', hours: '0' })
    await assert.rejects(db.exec(approved(generated.sql)), /existence differs/)
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 600)
  } finally { await db.close() }
})

test('empty schema rollback removes only additions', async () => {
  const db = await database()
  try {
    await db.exec(rollback)
    assert.equal((await db.query("select to_regclass('public.budget_daily_revenue_goals')::text as object")).rows[0].object, null)
    assert.equal((await db.query('select count(*)::int as n from public.budget_targets')).rows[0].n, 11)
  } finally { await db.close() }
})

test('duplicate source dates abort before any persistent budget change', async () => {
  const db = await database()
  try {
    const broken = fixture().sql.replace("'2026-11-01','1.000001'", "'2026-11-02','1.000001'")
    await assert.rejects(db.exec(approved(broken)), /coverage\/mapping\/control changed/)
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 0)
    assert.equal((await db.query("select count(*)::int as n from public.budget_targets where target_month='2026-11-01' and revenue_goal=999")).rows[0].n, 10)
  } finally { await db.close() }
})

test('all twenty verified baselines complete 600 daily goals and 20 monthly targets in one transaction', async () => {
  const db = await database()
  try {
    const baselines = Object.fromEntries(sites.map(site => [site, {
      starting_members: existing.includes(site) ? 100 : 200,
      verified: true, evidence: 'Fictional authoritative November opening count',
    }]))
    const generated = fixture(baselines)
    assert.equal(generated.plan.monthly_inserts, 10)
    assert.deepEqual(generated.plan.monthly_deferred, [])
    await db.exec(approved(generated.sql))
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 600)
    assert.equal((await db.query("select count(*)::int as n from public.budget_targets where target_month='2026-11-01'")).rows[0].n, 20)
    assert.equal((await db.query("select count(*)::int as n from public.budget_targets where target_month='2026-11-01' and membership_daily_growth=2 and membership_goal=starting_members+60")).rows[0].n, 20)
    assert.equal((await db.query('select count(*)::int as n from public.edit_audit_log')).rows[0].n, 20)
    assert.equal((await db.query('select mtd_revenue_actual::text as amount from public.budget_daily_entries')).rows[0].amount, '123.45')
  } finally { await db.close() }
})

test('official membership balances overwrite any differing current values while preserving unrelated fields', async () => {
  const db = await database()
  try {
    const generated = fixture({ '1512': { starting_members: 999, verified: true, evidence: 'Official fictional ending count' } })
    await db.exec(`update public.budget_targets set starting_members=101,membership_daily_growth=3,membership_goal=555,desired_rating=4.2 where location_id='${id('1512')}' and target_month='2026-11-01'`)
    const preview = await db.exec(generated.preview_sql)
    assert.ok(preview.flatMap(r=>r.rows||[]).some(r=>r.site==='1512' && r.current_state_check.startsWith('MATCHES') && r.membership_values_change))
    await db.exec(approved(generated.sql))
    const row = (await db.query(`select starting_members,membership_daily_growth::text as growth,membership_goal,desired_rating::text as rating from public.budget_targets where location_id='${id('1512')}' and target_month='2026-11-01'`)).rows[0]
    assert.deepEqual(row,{starting_members:999,growth:'2',membership_goal:1059,rating:'4.2'})
    const before = (await db.query(`select old_values from public.edit_audit_log where location_id='${id('1512')}'`)).rows[0].old_values
    assert.equal(before.starting_members,101)
    assert.equal(before.membership_daily_growth,3)
    assert.equal(before.membership_goal,555)
    assert.equal((await db.query('select mtd_revenue_actual::text as amount from public.budget_daily_entries')).rows[0].amount,'123.45')
  } finally { await db.close() }
})

test('authoritative balances and ten inserts complete in one transaction with exact membership controls', async () => {
  const db = await database()
  try {
    const corrections = ['1521','1522','1524','1525','1526','1527']
    const baselines = Object.fromEntries(sites.map(site => [site, {
      starting_members: existing.includes(site) ? 100 : 200,
      verified: true, evidence: 'Fictional official ending counts',
    }]))
    corrections.forEach((site, index) => Object.assign(baselines[site], {
      starting_members: 101 + index,
    }))
    const generated = fixture(baselines)
    assert.equal(generated.plan.membership_authoritative_sites.length,20)
    assert.equal(generated.plan.membership_starting_total, 3021)
    assert.equal(generated.plan.membership_eom_total, 4221)
    const preview = await db.exec(generated.preview_sql)
    const rows = preview.flatMap(r => r.rows || [])
    assert.equal(rows.filter(r => r.action === 'UPDATE authoritative November targets' && r.membership_values_change).length, 6)
    assert.ok(rows.every(r => r.current_state_check.startsWith('MATCHES')))
    await db.exec(approved(generated.sql))
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 600)
    assert.deepEqual((await db.query("select count(*)::int as sites, sum(starting_members)::int as starting, sum(membership_goal)::int as eom from public.budget_targets where target_month='2026-11-01'")).rows[0], { sites: 20, starting: 3021, eom: 4221 })
    assert.equal((await db.query("select count(*)::int as n from public.edit_audit_log where old_values->>'starting_members' is distinct from new_values->>'starting_members' and old_values is not null")).rows[0].n, 6)
    assert.equal((await db.query("select revenue_goal::text as amount from public.budget_targets where target_month='2026-10-01'")).rows[0].amount, '333')
    assert.equal((await db.query('select mtd_revenue_actual::text as amount from public.budget_daily_entries')).rows[0].amount, '123.45')
  } finally { await db.close() }
})

test('unexpected monthly row inventory changes stop before budget writes', async () => {
  const db = await database()
  try {
    const generated = fixture()
    await db.exec(`insert into public.budget_targets(location_id,target_month,starting_members,membership_goal) values ('${id('1508')}','2026-11-01',10,70)`)
    const preview = await db.exec(generated.preview_sql)
    assert.ok(preview.flatMap(r=>r.rows||[]).some(r=>r.site==='1508' && r.current_state_check.startsWith('STOP:')))
    await assert.rejects(db.exec(approved(generated.sql)), /existence differs/)
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n,0)
    assert.equal((await db.query('select count(*)::int as n from public.edit_audit_log')).rows[0].n,0)
  } finally { await db.close() }
})

test('network-control failure rolls back the full daily and monthly import', async () => {
  const db = await database()
  try {
    const baselines = Object.fromEntries(sites.map(site => [site, { starting_members: existing.includes(site)?100:200,
      verified: true, evidence: 'Fictional official ending counts' }]))
    const generated = fixture(baselines)
    const broken = approved(generated.sql).replaceAll("'3000'::bigint", "'3001'::bigint")
    await assert.rejects(db.exec(broken), /Membership network controls failed/)
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n, 0)
    assert.equal((await db.query("select count(*)::int as n from public.budget_targets where target_month='2026-11-01'")).rows[0].n, 10)
    assert.equal((await db.query('select count(*)::int as n from public.edit_audit_log')).rows[0].n, 0)
  } finally { await db.close() }
})

test('an unexpected unrelated-field change rolls the complete import back', async () => {
  const db = await database()
  try {
    await db.exec(`create function public.fixture_unrelated_change() returns trigger language plpgsql as $$begin new.desired_rating=0;return new;end$$;
      create trigger fixture_unrelated_change before update on public.budget_targets for each row execute function public.fixture_unrelated_change()`)
    await assert.rejects(db.exec(approved(fixture().sql)), /preserved unrelated-field verification failed/)
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n,0)
    assert.equal((await db.query("select count(*)::int as n from public.budget_targets where target_month='2026-11-01' and revenue_goal=999 and desired_rating=4.85")).rows[0].n,10)
    assert.equal((await db.query('select count(*)::int as n from public.edit_audit_log')).rows[0].n,0)
  } finally { await db.close() }
})

test('ambiguous site-number mapping stops before any budget write', async () => {
  const db = await database()
  try {
    await db.exec("insert into public.locations(id,site_code) values ('99999999-0000-0000-0000-000000000000','1508-Duplicate')")
    await assert.rejects(db.exec(approved(fixture().sql)), /coverage\/mapping\/control changed/)
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from public.budget_daily_revenue_goals')).rows[0].n,0)
  } finally { await db.close() }
})
