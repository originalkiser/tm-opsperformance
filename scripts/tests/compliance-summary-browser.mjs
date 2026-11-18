// Isolated actual report UI. Fictional fixtures only; hosted traffic is blocked.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const errors = []
async function open(mode = 'admin') {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  p.on('pageerror', e => errors.push(e.message))
  await p.addInitScript(mode => {
    window.mode = mode; window.calls = []; window.fixedNow = '2026-12-01T18:00:00Z'
    const OriginalDate = Date
    window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [window.fixedNow])) } static now() { return new OriginalDate(window.fixedNow).getTime() } }
    window.sites = Array.from({ length: mode === 'store' ? 1 : 20 }, (_, i) => ({ id: String(i + 1), site_code: String(1001 + i), name: `Fictional site ${i + 1}`, market: i < 10 ? 'North' : 'South', timezone: 'America/Chicago', local_today: '2026-12-01' }))
    window.report = args => {
      const monday = value => { const d = new Date(value + 'T12:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
      const timing = (date, phase) => { const d = new Date(date + 'T12:00Z'); d.setUTCDate(d.getUTCDate() + 7); const due_date = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); return { phase, due_date, due_at: d.toISOString().slice(0, 10) + 'T06:00:00Z' } }
      const submissions = []
      const add = (id, key, date, phase) => submissions.push({ location_id: id, template_key: key, period_date: date, status: 'submitted', is_pilot: false, ...(phase ? { weekly_timing: timing(date, phase) } : {}) })
      for (const key of ['opening', 'midday', 'closing']) add('1', key, '2026-11-30')
      add('1', 'opening', '2026-12-01')
      for (const key of ['weekly', 'weekly_pm']) { add('1', key, '2026-11-16'); add('2', key, '2026-11-23', 'submitted_on_time') }
      add('1', 'weekly', '2026-11-23', 'submitted_on_time'); add('1', 'weekly_pm', '2026-11-23', 'completed_late')
      const weekly_periods = []
      for (const site of window.sites) for (let d = new Date(monday(args.p_start) + 'T12:00Z'); d.toISOString().slice(0, 10) <= args.p_end; d.setUTCDate(d.getUTCDate() + 7)) {
        const date = d.toISOString().slice(0, 10)
        if (date >= '2026-11-23') weekly_periods.push({ location_id: site.id, period_date: date, score: date === '2026-11-23' && site.id === '2' ? 100 : 0, weekly_timing: timing(date, date === '2026-11-23' ? 'overdue' : 'not_started') })
      }
      return { generated_at: window.fixedNow, range_start: args.p_start, range_end: args.p_end, locations: window.sites,
        submissions: submissions.filter(r => window.sites.some(s => s.id === r.location_id) && r.period_date >= (r.template_key.startsWith('weekly') ? monday(args.p_start) : args.p_start) && r.period_date <= args.p_end), weekly_periods }
    }
  }, mode)
  await p.route('**/*', async route => {
    const u = new URL(route.request().url()); if (u.hostname !== '127.0.0.1') return route.abort()
    if (u.pathname.endsWith('/src/contexts/AuthContext.jsx')) return route.fulfill({ contentType: 'application/javascript', body: `export const useDisplayAuth=()=>({user:{id:'fictional'},profile:{role:window.mode==='admin'?'admin':'store',is_active:window.mode!=='inactive',location_id:'1'},locations:window.sites,managerPreview:false});` })
    if (u.pathname.endsWith('/src/components/NavBar.jsx')) return route.fulfill({ contentType: 'application/javascript', body: 'export default function NavBar(){return null}' })
    if (u.pathname.endsWith('/src/lib/supabase.js')) return route.fulfill({ contentType: 'application/javascript', body: `export const supabase={rpc:async(name,args)=>{window.calls.push({name,args});if(name!=='get_checklist_compliance')throw Error('Unexpected RPC');return {data:window.report(args)}}};` })
    return route.continue()
  })
  await p.goto('http://127.0.0.1:5190/tm-opsperformance/tests/browser/compliance-summary.html')
  return p
}
try {
  const p = await open()
  const summaries = p.locator('[data-location-summary]')
  await summaries.first().waitFor()
  assert.equal(await summaries.count(), 20)
  assert.equal(await p.getByRole('article').count(), 0)
  assert.match(await summaries.first().innerText(), /50%/)
  await summaries.first().getByRole('button').click()
  assert.equal(await p.getByRole('article').count(), 2)
  assert.match(await p.getByRole('article').last().innerText(), /Pending.*0% so far/)
  await p.getByRole('button', { name: 'Expand All', exact: true }).click()
  assert.equal(await p.getByRole('article').count(), 40)
  await p.getByRole('button', { name: 'Collapse All', exact: true }).click()
  const download = p.waitForEvent('download')
  await p.getByRole('button', { name: 'Export detailed rows (CSV)', exact: true }).click()
  const csv = await readFile(await (await download).path(), 'utf8')
  assert.equal(csv.split('\r\n').length, 41)
  await p.getByRole('button', { name: 'LW · Last week', exact: true }).click()
  await p.waitForFunction(() => window.calls.at(-1).args.p_start === '2026-11-23')
  await summaries.first().waitFor()
  assert.equal(await p.getByRole('article').count(), 0)
  await p.getByRole('button', { name: 'Weekly', exact: true }).click()
  await summaries.first().waitFor()
  assert.match(await summaries.first().innerText(), /Completed Late/)
  assert.match(await summaries.nth(1).innerText(), /100%/)
  await summaries.first().getByRole('button').click()
  assert.match(await p.getByRole('article').first().innerText(), /Preventive Maintenance: Completed Late/)
  await p.getByText('Dates, filters and reporting rules', { exact: true }).click()
  await p.getByLabel('Week containing', { exact: true }).fill('2026-11-16')
  await p.waitForFunction(() => window.calls.at(-1).args.p_start === '2026-11-16')
  await summaries.first().waitFor()
  assert.match(await summaries.first().innerText(), /100%/)
  await p.getByRole('button', { name: 'MTD · Month to date', exact: true }).click()
  await p.waitForFunction(() => window.calls.at(-1).args.p_start === '2026-12-01')
  await summaries.first().waitFor()
  assert.match(await summaries.first().innerText(), /Pending/)
  await p.getByRole('button', { name: 'Daily', exact: true }).click()
  await summaries.first().waitFor()
  await p.getByLabel('Market', { exact: true }).selectOption('South')
  assert.equal(await summaries.count(), 10)
  await p.getByLabel('Market', { exact: true }).selectOption('')
  await p.getByRole('button', { name: 'WTD · Week to date', exact: true }).click()
  await summaries.first().waitFor()
  await p.getByLabel('Completion status', { exact: true }).selectOption('complete')
  assert.equal(await summaries.count(), 1)
  assert.match(await summaries.first().innerText(), /50%/)
  await p.getByLabel('Completion status', { exact: true }).selectOption('all')
  await p.getByText('Dates, filters and reporting rules', { exact: true }).click()
  for (const dark of [false, true]) {
    await p.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await p.screenshot({ path: `/tmp/tm-compliance-summary-desktop-${dark ? 'dark' : 'light'}.png`, fullPage: true })
  }
  await p.setViewportSize({ width: 390, height: 844 })
  for (const dark of [false, true]) {
    await p.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await p.screenshot({ path: `/tmp/tm-compliance-summary-mobile-${dark ? 'dark' : 'light'}.png`, fullPage: true })
    await summaries.first().getByRole('button').click()
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await p.getByRole('button', { name: 'Collapse All', exact: true }).click()
  }
  assert.equal(await p.evaluate(() => window.calls.every(c => c.name === 'get_checklist_compliance' && c.args.p_weekly_contract === 1)), true)
  await p.close()
  const store = await open('store'); await store.locator('[data-location-summary]').waitFor(); assert.equal(await store.locator('[data-location-summary]').count(), 1); await store.close()
  const inactive = await open('inactive'); await inactive.getByRole('alert').waitFor(); assert.equal(await inactive.evaluate(() => window.calls.length), 0); await inactive.close()
  assert.deepEqual(errors, [])
  console.log('PASS: 20 collapsed Admin summaries, Store scope, inactive denial, shortcuts/manual dates, unchanged math, expansion, status/market filters, detailed CSV and mobile light/dark.')
} finally { await browser.close() }
