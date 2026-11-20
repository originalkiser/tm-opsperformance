// Local fixture with fictional records and simulated cameras; never initializes a production client.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync,readFileSync,readdirSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
const root=resolve(import.meta.dirname,'../..'),app=join(root,'app'),require=createRequire(join(app,'package.json'))
const {build}=require('esbuild'),{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const output=mkdtempSync(join(tmpdir(),'tm-checklist-photo-browser-'))
const fixture=`
import React from 'react';import{createRoot}from'react-dom/client';import ChecklistForm from './src/components/ChecklistForm.jsx';
const audit=location.search.includes('audit'),item={id:'one',number:1,section:'Fictional inspection',text:'Inspect components',type:'completion',options:['Completed','Not Completed'],failure_values:['Not Completed'],photo_required:true,critical:true,na_allowed:true};
const row={id:'fictional-submission',created_by:'fictional-user',location_id:'fictional-site',template_key:audit?'monthly_site_assessment':'weekly_pm',period_date:'2026-11-16',revision:1,updated_at:'2026-11-16T00:00:00Z',status:'draft',answers:{one:{value:'Completed'}},manager_name:'Fictional Inspector',template_snapshot:{name:'Fictional Checklist',timezone:'America/New_York',definition:[item]}};
window.fixture={calls:[],state:{row,evidence:[],capabilities:{can_edit:true,can_upload:true,can_discard:false}},duplicate:false};
const copy=()=>structuredClone(window.fixture.state),transport={guest:!audit,recoveryKey:'local',async load(){return copy()},async save(row,values){window.fixture.calls.push({action:'save',submit:values.submit});window.fixture.state.row={...row,revision:row.revision+1,answers:values.answers,manager_name:values.name};return copy()},async upload(row,file,item,kind){window.fixture.calls.push({action:'upload',kind,type:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});if(window.fixture.duplicate)throw new Error('This photo was already used for this location. Take a new photo of the current inspection.');window.fixture.state.evidence.push({id:'photo',kind,item_id:item});return copy()}};
createRoot(document.getElementById('root')).render(<ChecklistForm initial={row} initialCapabilities={window.fixture.state.capabilities} transport={transport} user={{id:'fictional-user'}} onClose={()=>{}} onSaved={()=>{}}/>);`
await build({stdin:{contents:fixture,resolveDir:app,loader:'jsx'},bundle:true,jsx:'automatic',format:'esm',outfile:join(output,'fixture.js'),plugins:[{name:'no-production',setup(build){build.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'fictional'}));build.onLoad({filter:/.*/,namespace:'fictional'},()=>({contents:'export const supabase = new Proxy({}, {get(){throw Error("Production client forbidden")}})',loader:'js'}))}}]})
const css=readdirSync(join(app,'dist/assets')).find(name=>name.endsWith('.css'))
writeFileSync(join(output,'fixture.css'),readFileSync(join(app,'dist/assets',css),'utf8').replace(/@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g,''))
writeFileSync(join(output,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>')
const server=createServer((req,res)=>{const file=['/fixture.js','/fixture.css'].includes(req.url)?req.url.slice(1):'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(output,file)))})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
 const errors=[]
 for(const [name,width,ua]of [['iphone',390,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'],['android',360,'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36']]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,userAgent:ua})
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin);await page.getByRole('button',{name:'Open camera',exact:true}).waitFor()
  assert.equal(await page.locator('input[type=file]').count(),1);assert.equal(await page.locator('input[type=file]').getAttribute('capture'),null)
  await page.getByRole('radio',{name:'N/A',exact:true}).check()
  await page.getByRole('button',{name:'Submit',exact:true}).click()
  await page.getByText(/A brief explanation is required/).first().waitFor()
  await page.getByLabel('Explanation / N/A reason').fill('Fictional equipment is not present; required evidence retained.')
  await page.getByRole('button',{name:'Open camera',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
  await page.screenshot({path:join(output,`${name}-camera.png`)})
  await page.getByRole('button',{name:'Cancel camera',exact:true}).click();assert.equal(await page.locator('video').count(),0)
  await page.getByRole('button',{name:'Open camera',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
  await page.getByRole('button',{name:'Take photo',exact:true}).click()
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.action==='upload'))
  assert.equal(await page.evaluate(()=>window.fixture.calls.find(c=>c.action==='upload').type),'image/jpeg')
  assert.equal(await page.locator('video').count(),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.reload()
  await page.getByLabel('Choose photo from library one').setInputFiles({name:'fictional.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N8AAAAASUVORK5CYII=','base64')})
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.action==='upload'))
  assert.equal(await page.evaluate(()=>window.fixture.calls.find(c=>c.action==='upload').type),'image/png')
  assert.deepEqual(await page.evaluate(()=>window.fixture.calls.find(c=>c.action==='upload').bytes),Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N8AAAAASUVORK5CYII=','base64')))
  await page.reload();await page.evaluate(()=>{window.fixture.duplicate=true})
  await page.getByLabel('Choose photo from library one').setInputFiles({name:'repeat.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N8AAAAASUVORK5CYII=','base64')})
  await page.getByText(/This photo was already used/).first().waitFor()
  await page.reload();await page.evaluate(()=>{window.fixture.duplicate=true})
  await page.getByRole('button',{name:'Open camera',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
  await page.getByRole('button',{name:'Take photo',exact:true}).click();await page.getByText(/This photo was already used/).first().waitFor()
  assert.match(await page.locator('[role=alert]').last().innerText(),/Take a new photo/)
  await page.goto(`${origin}/?audit`);await page.getByLabel('Upload photo one').waitFor()
  assert.equal(await page.locator('input[type=file]').count(),1);assert.equal(await page.locator('input[type=file]').getAttribute('capture'),null)
  assert.equal(await page.getByRole('button',{name:'Open camera',exact:true}).count(),0)
  await page.screenshot({path:join(output,`${name}-audit-library.png`)})
  await context.close()
 }
 for(const unavailable of [false,true]){
  const context=await browser.newContext();await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
  await context.addInitScript(({unavailable})=>{if(unavailable)Object.defineProperty(navigator,'mediaDevices',{value:undefined});else navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}},{unavailable})
  const page=await context.newPage();await page.goto(origin);await page.getByRole('button',{name:'Open camera',exact:true}).click()
  await page.getByText(/incomplete draft/).waitFor();assert.equal(await page.locator('input[type=file]').count(),1);assert.equal(await page.locator('input[type=file]').getAttribute('capture'),null)
  await page.getByRole('button',{name:'Save Draft',exact:true}).click();await page.waitForFunction(()=>window.fixture.calls.some(c=>c.action==='save'&&!c.submit));await context.close()
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,engine:'Chromium with simulated camera; mobile viewports/UA only, not physical iOS/Android verification',output}))
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
