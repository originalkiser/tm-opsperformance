// Fictional local UI only: no production client, account or record access.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync,readFileSync,readdirSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
const root=resolve(import.meta.dirname,'../..'),app=join(root,'app'),require=createRequire(join(app,'package.json'))
const {build}=require('esbuild'),{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const output=mkdtempSync(join(tmpdir(),'tm-submission-review-'))
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import Review from './src/components/ChecklistSubmissionReview.jsx';
const locations=[{id:'a',site_code:'1001',name:'Fictional North Long Location Name'},{id:'b',site_code:'1002',name:'Fictional South'}];
const records=Array.from({length:15},(_,i)=>({id:'record'+i,location_id:i%2?'b':'a',template_snapshot:{name:'Weekly Preventive Maintenance',timezone:'America/New_York'},status:i%3?'submitted':'draft',period_date:'2026-11-16',manager_name:i%3?'Fictional Inspector':'',updated_at:'2026-11-17T12:00:00Z'}));
window.opened=[];const open=r=>{window.opened.push(r.id)};
createRoot(document.getElementById('root')).render(<main className="p-4 space-y-4 max-w-5xl mx-auto text-slate-900 dark:text-tm-dark-text"><h1>Checklist submission review</h1><Review label="Operational checklist submissions" records={records} locations={locations} onOpen={open}/><h2>Management audit submission review</h2><Review label="Management audit submissions" records={[{...records[0],id:'audit',template_snapshot:{...records[0].template_snapshot,name:'Monthly Site Assessment'}}]} locations={locations} onOpen={open}/></main>);`
await build({stdin:{contents:fixture,resolveDir:app,loader:'jsx'},bundle:true,jsx:'automatic',format:'esm',outfile:join(output,'fixture.js')})
const css=readdirSync(join(app,'dist/assets')).find(name=>name.endsWith('.css'))
writeFileSync(join(output,'fixture.css'),readFileSync(join(app,'dist/assets',css),'utf8').replace(/@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g,''))
writeFileSync(join(output,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>')
const server=createServer((req,res)=>{const file=['/fixture.js','/fixture.css'].includes(req.url)?req.url.slice(1):'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(output,file)))})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true})
 for(const [name,width,dark]of [['desktop-light',1280,false],['mobile-dark',360,true]]){
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin);if(dark)await page.evaluate(()=>document.documentElement.classList.add('dark'))
  const ops=page.getByRole('region',{name:'Operational checklist submissions',exact:true}),audits=page.getByRole('region',{name:'Management audit submissions',exact:true})
  const rows=ops.locator('button[aria-expanded]');await rows.first().waitFor();assert.equal(await rows.count(),2)
  assert.equal(await ops.locator('li').count(),0);assert.equal(await audits.locator('li').count(),0)
  assert.match(await rows.first().innerText(),/8 records · 5 submitted/)
  await page.screenshot({path:join(output,`${name}-collapsed.png`)})
  // Entire summary, including counts, is the button. Keyboard and arrow share the action.
  await rows.first().getByText('8 records · 5 submitted').click();assert.equal(await ops.locator('li').count(),8)
  assert.equal(await audits.locator('li').count(),0)
  await ops.getByRole('button',{name:/Review submitted/}).first().click();assert.deepEqual(await page.evaluate(()=>window.opened),['record2'])
  await rows.first().focus();await page.keyboard.press('Enter');assert.equal(await ops.locator('li').count(),0)
  await ops.getByRole('button',{name:'Expand All',exact:true}).click();assert.equal(await ops.locator('li').count(),15)
  assert.equal(await audits.locator('li').count(),0)
  await audits.getByRole('button',{name:'Expand All',exact:true}).click();assert.equal(await audits.locator('li').count(),1)
  assert.match(await audits.innerText(),/Monthly Site Assessment/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:join(output,`${name}-expanded.png`)})
  await ops.getByRole('button',{name:'Collapse All',exact:true}).click();assert.equal(await ops.locator('li').count(),0)
  assert.equal(await audits.locator('li').count(),1);assert.deepEqual(errors,[])
  await context.close();console.log(name+': collapsed counts, row/keyboard expansion, independent sections, review action, ordering and responsive layout PASS')
 }
 console.log('Screenshots: '+output)
}finally{await browser?.close();server.close()}
