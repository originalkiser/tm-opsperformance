// Isolated headless browsers; fictional snapshots/evidence; hosted traffic blocked.
import assert from 'node:assert/strict'
import { weeklyPmTemplate } from '../../app/src/utils/weeklyPmTemplate.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
const browserPaths = [process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
const base = process.env.CHECKLIST_PRINT_URL || 'http://127.0.0.1:5198/tm-opsperformance/tests/browser/checklist-print.html'
const definition = [...weeklyPmTemplate.definition, { id:'optional', section:'Optional notes', text:'Optional review notes', type:'text', required:false, failure_values:[], options:[] }]
const answers = Object.fromEntries(definition.filter(i => !i.condition && i.id !== 'optional').map(i => [i.id, { value:i.options.find(v => !i.failure_values.includes(v)), explanation:'' }]))
answers[definition[0].id] = { value: definition[0].failure_values[0], explanation: 'Saved failure comment\nSecond comment line' }
const evidence = [0, 12].map((index, i) => ({ id:`photo${i}`, item_id:definition[index].id, kind:'photo', created_at:'2026-11-17T03:00:00Z',object_path:'PRIVATE_STORAGE_PATH' }))
for(const item of definition.filter(i=>i.signature_required))evidence.push({id:`sig-${item.id}`,kind:'signature',item_id:item.id,created_at:'2026-11-17T03:00:00Z'})
evidence.push({id:'sig',kind:'signature',item_id:null,created_at:'2026-11-17T03:00:00Z'})
delete answers[definition[1].id] // Historical incomplete response must be visibly identified.
const official = { id:'fictional',status:'submitted',revision:7,template_key:'weekly_pm',period_date:'2026-11-09',submitted_at:'2026-11-17T03:00:00Z',updated_at:'2026-11-17T03:00:00Z',manager_name:'Recorded Fictional Auditor',actor_kind:'account',answers,template_snapshot:{...weeklyPmTemplate,definition,version:2,timezone:'America/Chicago'} }
for (const [browserIndex, executablePath] of browserPaths.entries()) {
 const browser = await chromium.launch({ headless:true, executablePath })
 const errors=[]
 async function open(mode='normal', options={}) {
  const context=await browser.newContext({viewport:{width:options.mobile?390:1280,height:900},isMobile:!!options.mobile,hasTouch:!!options.mobile})
  const page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message))
  const correction=mode==='correction'
  const row={...official,...options.row,...(correction?{working_copy_id:'work',base_revision:7,revision:1,manager_name:'UNSUBMITTED NAME',answers:{}}:{})}
  await page.addInitScript(value=>{window.fixture=value;window.calls=[];window.allowPrint=false;window.printCalls=0}, { mode,guest:!!options.guest,record:{row,evidence:correction?[{id:'wrong',kind:'photo'}]:evidence},version:{...official,evidence} })
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  await page.goto(base)
  return page
 }
 async function prepare(page) {
  await page.getByRole('button',{name:'Print / Save PDF',exact:true}).click()
  await page.locator('iframe').waitFor({state:'attached'})
  await page.evaluate(()=>{const f=document.querySelector('iframe');f.contentWindow.print=()=>{window.printCalls++;window.printHtml=f.contentDocument.documentElement.outerHTML};window.allowPrint=true})
  await page.waitForFunction(()=>window.printCalls===1)
  const html=await page.evaluate(()=>window.printHtml)
  assert.match(html,/Official submitted revision 7/);assert.match(html,/Saved failure comment/)
  assert.match(html,/FAILED INSPECTION ITEM/);assert.match(html,/INCOMPLETE/);assert.match(html,/Not provided \(optional\)/)
  assert.doesNotMatch(html,/UNSAVED|UNSUBMITTED|PRIVATE_STORAGE_PATH|Application navigation|<textarea|<button|<nav/)
  assert.equal(await page.evaluate(()=>[...document.querySelector('iframe').contentDocument.images].every(i=>i.complete&&i.naturalWidth>0)),true)
  assert.ok((await page.evaluate(()=>window.calls)).every(a=>['read','history','download'].includes(a)))
  return html
 }
 try {
  const page=await open('correction'),html=await prepare(page)
  assert.equal(await page.evaluate(()=>window.calls.includes('history')),true)
  // Same-origin copy of the actual document, retaining fictional blob images.
  const preview=await page.context().newPage();await preview.goto(base);await preview.setContent(html)
  await preview.emulateMedia({media:'print'})
  await preview.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())))
  await preview.pdf({path:`/tmp/tm-checklist-print-${browserIndex}.pdf`,format:'Letter',printBackground:true,preferCSSPageSize:true})
  await preview.screenshot({path:`/tmp/tm-checklist-print-${browserIndex}.png`,fullPage:true})
  assert.equal(await preview.locator('section.item').count(),definition.length)
  await preview.close();
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.dispatchEvent(new Event('afterprint')))
  assert.equal(await page.locator('iframe').count(),0)
  await page.close()
  const mobile=await open('normal',{mobile:true});await prepare(mobile);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.close()
  for(const mode of ['denied','broken','revoked','changed']) {
   const p=await open(mode);await p.getByRole('button',{name:'Print / Save PDF',exact:true}).click()
   await p.evaluate(()=>{window.allowPrint=true})
   await p.getByRole('alert').waitFor();assert.equal(await p.evaluate(()=>window.printCalls),0)
   assert.equal(await p.locator('iframe').count(),0);await p.close()
  }
  for(const row of [{status:'draft'},{preview_only:true}]){const p=await open('normal',{row});assert.equal(await p.getByRole('button',{name:'Print / Save PDF'}).count(),0);await p.close()}
  for(const key of ['opening','midday','closing','weekly','weekly_pm','monthly_site_assessment','quarterly_safety_audit']) {
   const p=await open('normal',{row:{template_key:key}});await prepare(p);await p.close()
  }
  const guest=await open('normal',{guest:true});await prepare(guest);await guest.close()
  const audit=await open('normal',{guest:true,row:{template_key:'monthly_site_assessment'}});assert.equal(await audit.getByRole('button',{name:'Print / Save PDF'}).count(),0);await audit.close()
  assert.deepEqual(errors,[])
  console.log(`PASS ${browserIndex===0?'Chrome':'Edge'}: official snapshots, multi-page PM, photos/signatures, empty optionals, conditional follow-ups, mobile, seven types, QR restrictions, revoked/failed evidence, changed revision; no writes or hosted traffic.`)
 } finally { await browser.close() }
}
