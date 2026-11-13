// Fictional, local-only mobile QA. No production client, credentials or network.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/tests/checklist-mobile-browser.mjs
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
const output = mkdtempSync(join(tmpdir(), 'tm-checklist-mobile-browser-'))
const fixture = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import ChecklistForm from './src/components/ChecklistForm.jsx';
const scenario=new URLSearchParams(location.search).get('scenario');
const items=Array.from({length:20},(_,index)=>({id:'item-'+(index+1),number:index+1,section:'Fictional checks',text:'Fictional inspection question '+(index+1),type:'text',options:[],failure_values:[],photo_required:scenario==='photo'&&index===9,signature_required:scenario==='item-signature'&&index===9}));
const row={id:'fictional-submission',location_id:'fictional-site',created_by:'fictional-user',template_key:'opening',period_date:'2026-11-13',status:'draft',revision:3,updated_at:'2026-11-13T18:00:00Z',manager_name:'Fictional Manager',answers:Object.fromEntries(items.map(item=>[item.id,{value:scenario==='question'&&item.number===10?'':'Saved response'}])),template_snapshot:{name:'Fictional mobile checklist',timezone:'America/Chicago',definition:items}};
const evidence=scenario==='final-signature'?[]:[{id:'fictional-signature',kind:'signature',item_id:null}];
window.fixture={calls:[],conflict:false,fail:false,state:{row,evidence,capabilities:{can_edit:true,can_upload:true,can_discard:false}}};
const transport={guest:scenario!=='account',recoveryKey:'fictional-mobile-tab',async load(){window.fixture.calls.push('read');return structuredClone(window.fixture.state)},async save(row,values){window.fixture.calls.push({action:'save',revision:row.revision});if(window.fixture.conflict)throw Object.assign(new Error('Checklist changed elsewhere. Reload before saving.'),{status:409});if(window.fixture.fail)throw new Error('Fictional connection interruption');window.fixture.state.row={...row,answers:values.answers,manager_name:values.name,revision:row.revision+1};return structuredClone(window.fixture.state)},async upload(){return structuredClone(window.fixture.state)}};
createRoot(document.getElementById('root')).render(<main className="max-w-5xl mx-auto p-4"><ChecklistForm initial={row} initialEvidence={evidence} initialCapabilities={window.fixture.state.capabilities} transport={transport} user={{id:'fictional-user'}} locationLabel="Fictional site" onSaved={()=>{}} onClose={()=>{}}/></main>);`
await build({ stdin: { contents: fixture, resolveDir: app, loader: 'jsx' }, bundle: true, jsx: 'automatic', format: 'esm', outfile: join(output, 'fixture.js'), loader: { '.js': 'jsx' }, plugins: [{ name: 'no-production-client', setup(build) {
  build.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'fixture' }))
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const supabase = new Proxy({}, {get(){throw Error("Production client forbidden in local fixture")}})', loader: 'js' }))
} }] })
const css = readdirSync(join(app, 'dist/assets')).find(file => file.endsWith('.css'))
writeFileSync(join(output, 'fixture.css'), readFileSync(join(app, 'dist/assets', css), 'utf8').replace(/@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, ''))
writeFileSync(join(output, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional mobile checklist QA</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
const server = createServer((req, res) => {
  const name = ['/fixture.js', '/fixture.css'].includes(req.url) ? req.url.slice(1) : 'index.html'
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
  res.end(readFileSync(join(output, name)))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, timeout: 15000 })
  const errors = [], blocked = []
  for (const width of [360, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true })
    await context.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); blocked.push(route.request().url()); return route.abort() })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const footer = page.locator('[aria-label="Checklist save and submit"]')
    for (const scenario of ['question', 'photo', 'item-signature', 'final-signature']) {
      await page.goto(`${origin}/?scenario=${scenario}`)
      await page.getByRole('button', { name: 'Submit', exact: true }).waitFor()
      assert.equal(await footer.evaluate(element => getComputedStyle(element).position), 'sticky')
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      const target = scenario === 'question' ? page.locator('div[tabindex="-1"]').filter({ has: page.getByLabel('Written response item-10') }).first() : scenario === 'photo' ? page.locator('[aria-label="Photo evidence item-10"]') : scenario === 'item-signature' ? page.locator('[aria-label="Required signature item-10"]') : page.locator('[aria-label="Final auditor signature"]')
      await target.evaluate(element => { if (document.activeElement !== element) throw Error('First invalid target was not focused') })
      const box = await target.boundingBox()
      assert.ok(box.y >= 0 && box.y < 844, `${scenario} target in mobile viewport`)
      assert.match(await footer.innerText(), scenario === 'question' ? /question 10.*Choose a response/s : scenario === 'photo' ? /Required photo missing/ : scenario === 'item-signature' ? /Required signature missing/ : /Draw and save your signature/)
      assert.equal(await page.getByLabel('Written response item-1', { exact: true }).inputValue(), 'Saved response')
      assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.action === 'save').length), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: join(output, `${width}-${scenario}.png`) })
    }
    for (const scenario of ['guest', 'account']) {
      await page.goto(`${origin}/?scenario=${scenario}`)
      await page.getByLabel('Written response item-1', { exact: true }).fill('Keep this local response')
      await page.evaluate(() => { window.fixture.conflict = true; window.fixture.state.row = { ...window.fixture.state.row, revision: 9, answers: { ...window.fixture.state.row.answers, 'item-1': { value: 'Newer server response' } } } })
      await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
      assert.match(await footer.innerText(), /A newer saved version exists/)
      await page.screenshot({ path: join(output, `${width}-${scenario}-conflict.png`) })
      page.once('dialog', async dialog => { assert.match(dialog.message(), /Unsaved answers and signature drawings on this device may be lost/); await dialog.dismiss() })
      await page.getByRole('button', { name: 'Reload Latest Saved Version', exact: true }).click()
      assert.equal(await page.getByLabel('Written response item-1', { exact: true }).inputValue(), 'Keep this local response')
      page.once('dialog', dialog => dialog.accept())
      await page.getByRole('button', { name: 'Reload Latest Saved Version', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[aria-label="Written response item-1"]').value === 'Newer server response')
      assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.action === 'save').length), 1)
    }
    await page.goto(`${origin}/?scenario=signature`)
    const canvas = page.getByLabel('Manager handwritten signature')
    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 40, { steps: 8 }); await page.mouse.up()
    assert.equal(await page.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true)
    assert.match(await page.locator('[aria-label="Final auditor signature"]').innerText(), /Save this drawn signature before submitting/)
    await page.screenshot({ path: join(output, `${width}-unsaved-signature.png`) })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
  console.log(JSON.stringify({ passed: true, widths: [360, 390], scenariosPerWidth: 7, output, externalRequests: 0 }))
} finally { await browser?.close(); server.close() }
