import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const errors=[]
async function open({view='table',width=1280,readonly=false}={}){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(({view,readonly})=>{
  history.replaceState({idx:1},'',location.pathname+'#previous');history.pushState({idx:2},'',location.pathname);
  localStorage.setItem('tm_daily_view_mode',view);localStorage.setItem('tm_selected_location','a');localStorage.setItem('tm_selected_date','2026-11-20');localStorage.setItem('tm_active_tab','daily');localStorage.setItem('tm_date_range',JSON.stringify({preset:'custom',start:'2026-11-01',end:'2026-11-30'}))
  const site=id=>({id,name:'Fictional '+id,site_code:'100'+id,timezone:'America/Chicago',opportunities_formula:'simple'})
  window.auth={profile:{id:'actor',role:readonly?'store':'admin',is_active:true,location_id:'a'},locations:readonly?[site('a')]:[site('a'),site('b')],managerPreview:readonly,previewSiteId:'a',updateProfileSettings:async()=>{}}
  const row=(id,time,tw,mw)=>({id,location_id:'a',log_date:'2026-11-20',time_slot:time,split_index:0,employee_name:id==='old'?'Earlier Employee':'Later Employee',employee_id:'stable-'+id,google_reviews:2,total_washes:tw,member_washes:mw,basic:2,good:1,better:1,best:2,reactivations:0,net_members:0})
  window.db=[row('old','11:00:00',45,14),row('new','12:00:00',57,34)];window.writes=[];window.signedOut=false
  window.client={from(table){let action,body,filters=[];const q={
   select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},or(){return q},order(){return q},gte(){return q},lte(){return q},in(){return q},limit(){return q},
   update(p){action='update';body=p;return q},insert(p){action='insert';body=p;return q},delete(){action='delete';return q},
   range(){return Promise.resolve({data:table==='employees'?window.auth.locations.flatMap(l=>['Earlier Employee','Later Employee'].map((name,i)=>({id:l.id+i,location_id:l.id,name,is_active:true}))).filter(r=>filters.every(([k,v])=>r[k]===v)):[],count:2})},
   maybeSingle(){if(table!=='daily_logs')return Promise.resolve({data:null});let row=window.db.find(r=>filters.every(([k,v])=>r[k]===v));if(action){window.writes.push({action,body:structuredClone(body)});if(action==='insert'){row={...body};window.db.push(row)}else if(action==='delete')window.db=window.db.filter(r=>r!==row);else if(row)Object.assign(row,body)}return Promise.resolve({data:row?structuredClone(row):null})},
   then(resolve){return Promise.resolve({data:table==='daily_logs'?structuredClone(window.db.filter(r=>filters.every(([k,v])=>r[k]===v))):[],count:0}).then(resolve)},
  };return q}}
 },{view,readonly})
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort()
  if(u.pathname.endsWith('/src/contexts/AuthContext.jsx'))return route.fulfill({contentType:'application/javascript',body:'export const useDisplayAuth=()=>window.auth;export const useAuth=useDisplayAuth'})
  if(u.pathname.endsWith('/src/lib/supabase.js'))return route.fulfill({contentType:'application/javascript',body:'export const supabase=window.client;export const supabasePublicKey="fictional"'})
  if(['/NavBar.jsx','/DailyLogRevenueGoal.jsx','/MonthlyRollup.jsx','/DailySnapshot.jsx','/BudgetTrackingSection.jsx','/OwnershipLogSection.jsx','/EmployeeSummary.jsx','/LocationRepair.jsx'].some(s=>u.pathname.endsWith(s)))return route.fulfill({contentType:'application/javascript',body:'export default function Fixture(){return null}'})
  return route.continue()
 })
 await page.goto('http://127.0.0.1:5199/tm-opsperformance/tests/browser/daily-log-cumulative.html')
 await page.getByRole('alert',{name:'Cumulative Daily Log warnings'}).waitFor()
 return {page,context}
}
try {
 const {page:p,context}=await open()
 const warning=p.getByRole('alert',{name:'Cumulative Daily Log warnings'})
 assert.match(await warning.innerText(),/Previous 11:00 AM: Total 45, Member 14; current: Total 57, Member 34/)
 for(const field of ['total_washes','member_washes'])assert.equal(await p.locator(`#daily-log-table-4-${field}`).getAttribute('aria-invalid'),'true')
 await p.locator('#daily-log-table-4-best').fill('3');await p.locator('#daily-log-table-4-best').blur()
 await p.getByText(/Save attempted with cumulative warnings/).waitFor()
 assert.equal(await p.evaluate(()=>window.db.find(r=>r.id==='new').best),3)
 const before=await p.locator('input[type=date]').last().inputValue()
 p.once('dialog',d=>d.dismiss());await p.locator('input[type=date]').last().fill('2026-11-19')
 assert.equal(await p.locator('input[type=date]').last().inputValue(),before)
 const selectors=p.locator('.tm-entry-controls select');assert.ok(await selectors.count())
 p.once('dialog',d=>d.dismiss());await selectors.first().selectOption('b')
 assert.equal(await selectors.first().inputValue(),'a')
 await p.locator('#daily-log-table-4-best').fill('4')
 p.once('dialog',d=>d.dismiss());await p.getByRole('button',{name:'Snapshot',exact:true}).click()
 assert.equal(await p.locator('[data-entry-tab]').getAttribute('data-entry-tab'),'daily')
 assert.equal(await p.locator('#daily-log-table-4-best').inputValue(),'4')
 p.once('dialog',d=>d.dismiss());await p.goBack();await p.waitForURL(url=>!url.hash)
 assert.equal(await p.locator('#daily-log-table-4-best').inputValue(),'4')
 p.once('dialog',d=>d.dismiss());await p.getByRole('link',{name:'Fictional Reports'}).click()
 assert.match(p.url(),/daily-log-cumulative/)
 p.once('dialog',d=>d.dismiss());await p.getByRole('button',{name:'Sign Out',exact:true}).click();assert.equal(await p.evaluate(()=>window.signedOut),false)
 await p.locator('#daily-log-table-4-member_washes').fill('26')
 await warning.waitFor({state:'detached'})
 assert.equal(await p.locator('#daily-log-table-4-total_washes').getAttribute('aria-invalid'),'false')
 // Earlier correction must immediately revalidate the later checkpoint.
 await p.locator('#daily-log-table-3-member_washes').fill('10');await warning.waitFor()
 assert.match(await warning.innerText(),/previous|Previous/)
 await p.locator('#daily-log-table-3-member_washes').fill('14');await warning.waitFor({state:'detached'})
 // Both directions of the existing Undo keep entered values and recompute warnings.
 await p.locator('#daily-log-table-4-member_washes').fill('34');await p.locator('#daily-log-table-4-member_washes').press('ControlOrMeta+z');await warning.waitFor({state:'detached'})
 await p.locator('#daily-log-table-4-member_washes').fill('34');await warning.waitFor()
 await p.getByRole('button',{name:'Review 12:00 PM'}).click();assert.equal(await p.locator('#daily-log-table-4-total_washes').evaluate(e=>e===document.activeElement),true)
 for(const dark of [false,true]){await p.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);await p.screenshot({path:`/tmp/tm-cumulative-table-${dark?'dark':'light'}.png`,fullPage:true,animations:'disabled'})}
 // Split checkpoint stored at array end is validated in chronological position.
 await p.locator('tr').filter({has:p.locator('#daily-log-table-3-total_washes')}).getByRole('button',{name:'+',exact:true}).click()
 const split=p.locator('input[id^="daily-log-table-"][aria-label="Total Washes at 11:00 AM split 1"]')
 await split.fill('50');await p.getByLabel('Member Washes at 11:00 AM split 1',{exact:true}).fill('30')
 assert.equal(await split.getAttribute('aria-invalid'),'true')
 assert.match(await warning.innerText(),/11:00 AM \(split 1\)/)
 assert.equal(await p.evaluate(()=>window.db.length),2) // New split still waiting for autosave, not a deletion.
 await context.close()
 const mobile=await open({view:'card',width:390}),m=mobile.page
 await m.locator('select').last().selectOption('12:00:00')
 assert.equal(await m.locator('#daily-log-card-4-member_washes').getAttribute('aria-invalid'),'true')
 for(const dark of [false,true]){await m.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);await m.screenshot({path:`/tmp/tm-cumulative-card-${dark?'dark':'light'}.png`,fullPage:true,animations:'disabled'});assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}
 await m.locator('#daily-log-card-4-member_washes').fill('26');await m.getByRole('alert',{name:'Cumulative Daily Log warnings'}).waitFor({state:'detached'})
 await m.getByRole('button',{name:/Switch to Table View/}).click();assert.equal(await m.locator('#daily-log-table-4-member_washes').inputValue(),'26')
 await mobile.context.close()
 const ro=await open({readonly:true});assert.equal(await ro.page.locator('input[aria-invalid=true]').first().isDisabled(),true);await ro.context.close()
 assert.deepEqual(errors,[])
 console.log('PASS: table/card, exact cumulative example, saved warnings, correction/earlier revalidation, Undo, split order, date/site/tab/back/link/sign-out cancellation, readonly, mobile Light/Dark; fictional writes only, hosted traffic blocked.')
} finally {await browser.close()}
