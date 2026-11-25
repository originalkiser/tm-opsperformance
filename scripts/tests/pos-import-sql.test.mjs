import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = new URL('../../app/supabase/migrations/20261125150136_daily_pos_import.sql', import.meta.url)
const admin = '00000000-0000-4000-8000-000000000001'
const store = '00000000-0000-4000-8000-000000000002'
const inactive = '00000000-0000-4000-8000-000000000003'
const groupA = '00000000-0000-4000-8000-000000000004'
const groupB = '00000000-0000-4000-8000-000000000005'
const day = '2026-11-23'
const data = {
  metrics: { total: 30000, member: 20000, retail: 10000, payments: 30000, cards: 29000, house: 0, other: 0,
    cash: 1000, reportedCash: 1000, balance: 0, washes: 45, governmentWashes: 2, policeWashes: 3, opportunities: 40, redemptions: 30, overrides: null,
    memberships: 5, basicSold: 2, goodSold: 0, betterSold: 1, bestSold: 2, recharges: 3, terminations: 0, premiumSold: 3, unclassifiedSold: 0, premiumRetail: 4, eligibleRetail: 6, premiumRedeemed: 15, unclassifiedRedeemed: 0 },
  sources: {}, warnings: [], financialWarnings: [], provisionalFinancial: false,
}
const row = (locationId, sourceId, document = data, expectedRevision = 0, reason = null) =>
  ({ locationId, sourceId, document, expectedRevision, reason })

test('isolated PostgreSQL enforces Admin-only atomic storage, duplicate handling and guarded revision history', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE)
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      create table public.locations(id uuid primary key, site_code text unique, exclude_from_reporting boolean);
      create table public.user_profiles(id uuid primary key, role text, is_active boolean, deleted_at timestamptz);
      create table public.budget_daily_entries(id integer primary key, amount numeric);
      insert into public.budget_daily_entries values(1, 123.45);
      insert into public.locations values('${groupA}','1518-Greenwood',false),('${groupB}','1519-Greenville',false);
      insert into public.user_profiles values('${admin}','admin',true,null),('${store}','store',true,null),('${inactive}','admin',false,null);
    `)
    await db.exec(await readFile(sql, 'utf8'))
    const grant = actor => db.exec(`set role authenticated; set request.jwt.claim.sub='${actor}'`)
    const commit = async (hash, rows, date = day, name = 'fixture.xlsx') => (await db.query(
      'select public.pos_daily_commit($1,$2,$3,$4,$5,$6) as result',
      [name, hash.repeat(64), 'daily-pos-v2.0.0', 'DRB', date, JSON.stringify(rows)])).rows[0].result
    const report = async (from = day, to = day) => (await db.query('select * from public.pos_daily_report($1,$2,0)', [from,to])).rows
    const history = async () => (await db.query('select public.pos_daily_history($1,$2) as result', [groupA,day])).rows[0].result
    const first = row(groupA,'1518-Greenwood'), second = row(groupB,'1519-Greenville')
    await db.exec('set role anon')
    await assert.rejects(report(), { code: '42501' })
    await grant(store)
    await assert.rejects(report(), { code: '42501' })
    await assert.rejects(commit('a',[first]), { code: '42501' })
    await grant(inactive)
    await assert.rejects(history(), { code: '42501' })
    await grant(admin)
    await assert.rejects(db.query('select * from pos_import_private.revisions'), { code: '42501' })
    await assert.rejects(commit('a',[first,row(groupB,'1518-Greenwood')]), /eligible location/)
    assert.deepEqual(await report(), [])
    for (const metrics of [{ opportunities: 45 }, { governmentWashes: -1 },
      { governmentWashes: 44 }, { policeWashes: null }, { governmentWashes: 0.5 }]) {
      await assert.rejects(commit('a',[row(groupA,'1518-Greenwood',{ ...data, metrics: { ...data.metrics, ...metrics } })]),
        /wash opportunities do not reconcile|Invalid POS metric range/)
    }
    const allGovernment = { ...data, metrics: { ...data.metrics, governmentWashes: 45, policeWashes: 0, opportunities: 0 } }
    assert.equal((await commit('e',[row(groupA,'1518-Greenwood',allGovernment)],'2026-11-21')).imported,1)

    assert.equal((await commit('a',[first, second])).imported, 2)
    assert.equal((await commit('a',[first, second])).fileDuplicate, true)
    assert.equal((await commit('b',[first])).duplicates, 1)
    assert.equal((await commit('c',[first], '2026-11-22')).imported, 1)
    assert.equal((await report('2026-11-22',day)).length, 3)
    const corrected = { ...data, metrics: { ...data.metrics, total: 30100, payments: 30100, cards: 29100, retail: 10100 } }
    await assert.rejects(commit('d',[row(groupA,'1518-Greenwood',corrected)]), /approval or current revision/)
    await assert.rejects(commit('d',[row(groupA,'1518-Greenwood',corrected,7,'Approved')]), /approval or current revision/)
    const incomplete = { ...corrected, metrics: { ...corrected.metrics, premiumRedeemed: null } }
    await assert.rejects(commit('d',[row(groupA,'1518-Greenwood',incomplete,1,'Approved')]), /Incomplete correction/)
    const invalid = { ...corrected, metrics: { ...corrected.metrics, retail: 10101 } }
    await assert.rejects(commit('d',[row(groupA,'1518-Greenwood',invalid,1,'Approved')]), /must reconcile/)
    assert.equal((await commit('d',[row(groupA,'1518-Greenwood',corrected,1,'Approved')])).replaced, 1)
    assert.deepEqual((await history()).map(r => [r.revision,r.document.metrics.total,r.replacement_reason]),
      [[2,30100,'Approved'],[1,30000,null]])
    assert.equal((await report()).length, 2)
    await db.exec('reset role')
    assert.deepEqual((await db.query('select amount::text from public.budget_daily_entries')).rows, [{ amount: '123.45' }])
    assert.equal((await db.query('select count(*)::int as n from pos_import_private.batches')).rows[0].n, 4)

    await db.exec('truncate pos_import_private.current_records,pos_import_private.revisions,pos_import_private.batches')
    const fixtures = [
      ['DRB', ['1508-Mesquite','1511-Allen','1516-Plano','1518-Greenwood','1519-Greenville','1520-Cleveland',
        '1521-Port Arthur','1522-Groves','1524-Beaumont','1525-Breaux Bridge','1526-Mansura','1527-Carencro','1530-Batesville']],
      ['Micrologic', ['TCWWR','TCWBR','PECWF','TCWBLO','TCWEJB','TCWCB','TCWFM']],
    ]
    const micSites = ['1529','1528','1517','1531','1532','1515','1512']
    const sources = {}
    for (const [system, identifiers] of fixtures) {
      sources[system] = []
      for (const [index, source] of identifiers.entries()) {
        const code = system === 'DRB' ? source.slice(0,4) : micSites[index]
        const inserted = await db.query(`insert into public.locations values(gen_random_uuid(),$1,false)
          on conflict(site_code) do update set exclude_from_reporting=false returning id`, [system === 'DRB' ? source : code])
        sources[system].push(row(inserted.rows[0].id, source, system === 'DRB' ? data : {
          ...data, metrics: { ...data.metrics, overrides: 0, governmentWashes: null, policeWashes: null, opportunities: 15 },
        }))
      }
    }
    await grant(admin)
    for (let dayIndex = 24; dayIndex > 0; dayIndex--) for (const [system] of fixtures) {
      const date = '2026-11-' + String(dayIndex).padStart(2,'0')
      const identifier = (dayIndex * 2 + Number(system === 'Micrologic')).toString(16).padStart(64,'0')
      const saved = await db.query('select public.pos_daily_commit($1,$2,$3,$4,$5,$6) as result',
        ['fixture.xlsx',identifier,'daily-pos-v2.0.0',system,date,JSON.stringify(sources[system])])
      assert.equal(saved.rows[0].result.imported,sources[system].length)
    }
    let covered = 0
    for (let offset = 0; ; offset += 100) {
      const page = (await db.query('select * from public.pos_daily_report($1,$2,$3)', ['2026-11-01','2026-11-24',offset])).rows
      covered += page.length
      if (page.length < 100) break
    }
    assert.equal(covered,480)
  } finally { await db.close() }
})
