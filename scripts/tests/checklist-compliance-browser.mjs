// Fictional, network-isolated UI acceptance. Build app first; no Supabase account or secrets.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/tests/checklist-compliance-browser.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
const root = resolve(import.meta.dirname, '../..'), app = join(root, 'app')
const require = createRequire(join(app, 'package.json')), { build } = require('esbuild')
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const output = mkdtempSync(join(tmpdir(), 'tm-compliance-browser-'))
const fixture = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import ChecklistCompliance from './src/pages/ChecklistCompliance.jsx';
window.fixtureCalls=[]; window.fixtureFail=false;
createRoot(document.getElementById('root')).render(<HashRouter><Routes>
<Route path="/" element={<ChecklistCompliance/>}/>
<Route path="/checklists" element={<main><h1>Fictional Manager Checklists</h1><Link to="/">Report</Link></main>}/>
</Routes></HashRouter>);`
const auth = `export function useAuth(){return {user:{id:'fictional-admin'},profile:{role:'admin',is_active:true},locations:[{id:'a',site_code:'1001',timezone:'America/New_York'}]}}`
const client = `export const supabase={async rpc(name,args){
window.fixtureCalls.push({name,args});
if(window.fixtureFail)return {error:{message:'Fictional network failure'}};
const locations=[{id:'a',site_code:'1001',name:'Fictional North',market:'North',timezone:'America/New_York',local_today:'2026-11-11'},{id:'b',site_code:'1002',name:'Fictional South',market:'South',timezone:'America/Los_Angeles',local_today:'2026-11-11'}];
const submissions=[...['opening','midday','closing'].map(template_key=>({location_id:'a',template_key,period_date:'2026-11-11',status:'submitted',is_pilot:false})),...['weekly','weekly_pm'].map(template_key=>({location_id:'a',template_key,period_date:'2026-11-09',status:'submitted',is_pilot:false})),{location_id:'b',template_key:'midday',period_date:'2026-11-11',status:'draft',is_pilot:true},{location_id:'b',template_key:'weekly',period_date:'2026-11-09',status:'draft',is_pilot:false}].filter(row=>row.period_date<=args.p_end&&(row.template_key.startsWith('weekly')||row.period_date>=args.p_start));
return {data:{generated_at:'2026-11-11T15:00:00Z',range_start:args.p_start,range_end:args.p_end,locations,submissions}};}}`
await build({ stdin: { contents: fixture, resolveDir: app, loader: 'jsx' }, bundle: true, jsx: 'automatic', format: 'esm', outfile: join(output, 'fixture.js'), loader: { '.js': 'jsx' }, plugins: [{ name: 'isolated-test-services', setup(build) {
  build.onResolve({ filter: /contexts\/AuthContext|lib\/supabase|components\/NavBar/ }, args => ({ path: args.path, namespace: 'fixture' }))
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('AuthContext') ? auth : args.path.includes('supabase') ? client : 'export default function NavBar(){return null}', loader: 'js' }))
} }] })
const css = readdirSync(join(app, 'dist/assets')).find(file => file.endsWith('.css'))
writeFileSync(join(output, 'fixture.css'), readFileSync(join(app, 'dist/assets', css)))
writeFileSync(join(output, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional checklist compliance QA</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
const server = createServer((req,res)=>{
  const name = ['/fixture.js','/fixture.css'].includes(req.url) ? req.url.slice(1) : 'index.html'
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
  res.end(readFileSync(join(output, name)))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
if (process.env.CHECKLIST_SERVE_ONLY === '1') { console.log(JSON.stringify({ origin, output })); await new Promise(() => {}) }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox'] })
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
 await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
 await context.addInitScript(() => { const OriginalDate = Date; window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-11-11T15:00:00Z'])) } static now() { return new OriginalDate('2026-11-11T15:00:00Z').getTime() } } })
 const page = await context.newPage(), errors = []
 page.on('pageerror', error => errors.push(error.message))
 await page.goto(origin); await page.getByRole('table').waitFor()
 assert.equal(await page.locator('tbody tr').count(), 2)
 assert.equal(await page.getByRole('cell', { name: '100%', exact: true }).count(), 1)
 assert.equal(await page.getByRole('cell', { name: '0%', exact: true }).count(), 1)
 await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true })
 await page.getByLabel('Completion status').selectOption('progress'); assert.equal(await page.locator('tbody tr').count(), 1)
 const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export visible rows (CSV)' }).click()
 const exportFile = await download; assert.match(exportFile.suggestedFilename(), /^checklist-daily-/)
 await exportFile.saveAs(join(output, 'export.csv')); const csvText = readFileSync(join(output, 'export.csv'), 'utf8')
 assert.match(csvText, /Fictional South/); assert.doesNotMatch(csvText, /Fictional North/)
 await page.getByLabel('Completion status').selectOption('all')
 await page.getByRole('button', { name: 'Weekly', exact: true }).click(); await page.getByRole('columnheader', { name: 'Preventive Maintenance' }).waitFor()
 assert.equal(await page.getByRole('cell', { name: '100%', exact: true }).count(), 1)
 await page.getByLabel('Market', { exact: true }).selectOption('North'); assert.equal(await page.locator('tbody tr').count(), 1)
 await page.getByLabel('Market', { exact: true }).selectOption('')
 await page.setViewportSize({ width: 390, height: 844 })
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-level horizontal overflow')
 await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true })
 await page.evaluate(() => document.documentElement.classList.add('dark'))
 await page.screenshot({ path: join(output, 'mobile-dark.png'), fullPage: true })
 await page.getByRole('link', { name: 'Back to Manager Checklists' }).click(); await page.getByRole('heading', { name: 'Fictional Manager Checklists' }).waitFor()
 await page.goBack(); await page.getByRole('table').waitFor()
 await page.goForward(); await page.getByRole('heading', { name: 'Fictional Manager Checklists' }).waitFor()
 await page.goBack(); await page.getByRole('table').waitFor()
 await page.evaluate(() => { window.fixtureFail = true })
 await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('alert').waitFor()
 assert.equal(await page.getByRole('table').count(), 0)
 assert.equal(await page.getByRole('button', { name: 'Export visible rows (CSV)' }).isDisabled(), true)
 await page.evaluate(() => { window.fixtureFail = false })
 await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('table').waitFor()
 await page.getByLabel('Start date', { exact: true }).fill('2027-01-01'); await page.getByRole('alert').waitFor()
 assert.equal(await page.getByRole('table').count(), 0)
 assert.deepEqual(errors, [])
 console.log(JSON.stringify({ passed: true, output, checks: ['daily/weekly scoring', 'missing/in-progress', 'market/status filters', 'CSV visible rows', '390px containment', 'dark mode screenshots', 'Back/Forward', 'failed read hides scores/export', 'retry', 'invalid range'], pageErrors: errors }))
} finally { await browser.close(); server.close() }
