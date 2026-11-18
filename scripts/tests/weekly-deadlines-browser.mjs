// Local isolated browser; all non-local requests are blocked. Fictional data only.
import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const errors=[]
async function page(mode){
 const p=await browser.newPage({viewport:{width:1280,height:900}})
 p.on('pageerror',e=>errors.push(e.message))
 await p.addInitScript(mode=>{
  window.fixtureMode=mode;window.calls=[];window.fixedNow='2026-11-30T20:00:00Z'
  const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[window.fixedNow]))}static now(){return new OriginalDate(window.fixedNow).getTime()}}
  window.site={id:'fictional-site',site_code:'1000 Fictional',timezone:'America/Los_Angeles',name:'Fictional'}
  window.fixtureTemplates=['opening','midday','closing','weekly','weekly_pm'].map(key=>({key,name:{opening:'Opening Checklist',midday:'Mid-Day Checklist',closing:'Closing Checklist',weekly:'Weekly Manager Administrative Checklist',weekly_pm:'Weekly Preventive Maintenance Checklist'}[key],cadence:key.startsWith('weekly')?'weekly':'daily',version:1,definition:[]}))
  window.periods=[{period_date:'2026-11-16',period_end:'2026-11-22',previous:false,older:true,recent:false,weekly_timing:{due_at:'2026-11-24T08:00:00Z',due_date:'2026-11-23',phase:'overdue'},checklists:{}},{period_date:'2026-11-23',period_end:'2026-11-29',previous:true,weekly_timing:{due_at:'2026-12-01T08:00:00Z',due_date:'2026-11-30',phase:'not_started'},checklists:{}},{period_date:'2026-11-30',period_end:'2026-12-06',previous:false,weekly_timing:{due_at:'2026-12-08T08:00:00Z',due_date:'2026-12-07',phase:'not_started'},checklists:{}}]
  window.createRow=(key,period)=>({id:'fictional-row',template_key:key,location_id:window.site.id,period_date:period,status:'draft',revision:0,created_by:'fictional-user',updated_at:window.fixedNow,answers:{},manager_name:'',template_snapshot:{...window.fixtureTemplates.find(t=>t.key===key),timezone:window.site.timezone},weekly_timing:{...window.periods.find(p=>p.period_date===period).weekly_timing,phase:'in_progress'}})
 },mode)
 await p.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort()
  if(u.pathname.endsWith('/src/contexts/AuthContext.jsx'))return route.fulfill({contentType:'application/javascript',body:`export const useDisplayAuth=()=>({user:{id:'fictional-user'},profile:{role:'admin',is_active:true},locations:[window.site],managerPreview:false});export const useAuth=useDisplayAuth;`})
  if(u.pathname.endsWith('/src/components/NavBar.jsx'))return route.fulfill({contentType:'application/javascript',body:`export default function NavBar(){return null}`})
  if(u.pathname.endsWith('/src/lib/supabase.js'))return route.fulfill({contentType:'application/javascript',body:`
   export const supabasePublicKey='fictional-public';
   const context=()=>({location:window.site,templates:window.fixtureTemplates,submissions:[],weekly_periods:window.periods,server_now:window.fixedNow});
   export const supabase={auth:{async getSession(){return {data:{session:{access_token:'fictional'}}}}},
    from(name){const q={select(){return q},in(){return q},gte(){return q},lte(){return q},eq(){return q},order(){return q},then(done){return Promise.resolve({data:name==='checklist_templates'?window.fixtureTemplates:[]}).then(done)}};return q},
    async rpc(name,p){window.calls.push({name,p});if(name==='configuration_capabilities')return {data:{can_edit_templates:false}};if(name==='checklist_weekly_periods')return {data:window.periods};if(name==='save_checklist')return {data:window.createRow(p.p_template,p.p_date)};throw Error('Unexpected RPC '+name)}
   };
   window.fetch=async(url,init)=>{if(!String(url).includes('checklist-access'))throw Error('Unexpected hosted request');const b=JSON.parse(init.body);window.calls.push({name:'access',p:b});let result;
    if(b.action==='context')result=context();else if(b.action==='qr_status')result={grant:null};else if(b.action==='start'||b.action==='read'){
     const row=b.action==='start'?window.createRow(b.template_key,b.period_date):window.currentRow;window.currentRow=row;result={submission:row,capabilities:{can_edit:true,can_upload:true,can_discard:false,server_now:window.fixedNow,weekly_timing:row.weekly_timing},evidence:[]};
    }else throw Error('Unexpected mutation '+b.action);return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}})
   };
  `})
  return route.continue()
 })
 const token=mode==='guest'?'#/guest-checklists?token='+'a'.repeat(64):''
 await p.goto('http://127.0.0.1:5189/tm-opsperformance/tests/browser/weekly-deadlines.html'+token)
 return p
}
try{
 for(const mode of ['admin','guest']){
  const p=await page(mode)
  await p.getByRole('heading',{name:'Weekly Preventive Maintenance Checklist',exact:true}).first().waitFor()
  assert.equal(await p.getByText('Due Monday, 2026-11-30 at 11:59 p.m. (America/Los_Angeles)',{exact:true}).count(),2)
  assert.equal(await p.getByText('Due Monday, 2026-12-07 at 11:59 p.m. (America/Los_Angeles)',{exact:true}).count(),2)
  const cards=mode==='admin'?p.getByRole('group',{name:'Weekly checklists'}).locator('section.tm-checklist-card'):p.locator('section[data-cadence="weekly"] article')
  assert.equal(await cards.count(),4)
  const previous=cards.filter({hasText:'Weekly Manager Administrative Checklist'}).filter({hasText:'Previous reporting week'})
  await previous.getByRole('button',{name:'Start checklist'}).click()
  await p.getByRole('heading',{name:'Weekly Manager Administrative Checklist · 2026-11-23',exact:true}).waitFor()
  const calls=await p.evaluate(()=>window.calls);const start=calls.find(c=>mode==='admin'?c.name==='save_checklist':c.name==='access'&&c.p.action==='start')
  assert.equal(mode==='admin'?start.p.p_date:start.p.period_date,'2026-11-23')
  await p.setViewportSize({width:390,height:844});await p.evaluate(()=>document.documentElement.classList.add('dark'))
  await p.screenshot({path:'/tmp/tm-weekly-'+mode+'-mobile.png',fullPage:true})
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(mode==='guest'){await p.getByRole('button',{name:'Close',exact:true}).click();await p.getByLabel('Older reporting week',{exact:true}).selectOption('2026-11-16');const older=p.locator('article').filter({hasText:'Weekly Preventive Maintenance Checklist'}).filter({hasText:'Older reporting week'});await older.getByRole('button',{name:'Start checklist'}).click();await p.getByRole('heading',{name:'Weekly Preventive Maintenance Checklist · 2026-11-16',exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.calls.filter(c=>c.name==='access'&&c.p.action==='start').at(-1).p.period_date),'2026-11-16')}
  await p.close()
 }
 assert.deepEqual(errors,[])
 console.log('PASS: Admin and QR Monday cards, explicit prior/current periods, site-local due labels, correct prior/older-week starts, form due dates and mobile/dark layouts; fictional local data only.')
}finally{await browser.close()}
