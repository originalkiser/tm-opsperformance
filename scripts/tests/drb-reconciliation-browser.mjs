// Isolated headless Chrome. Fictional fixtures only; every hosted request blocked.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require=createRequire(new URL('../../app/package.json',import.meta.url))
const JSZip=require('jszip')
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const errors=[]
async function open(mode='reviewer'){
 const p=await browser.newPage({viewport:{width:1280,height:900}})
 p.on('pageerror',e=>errors.push(e.message))
 await p.addInitScript(({mode})=>{
  window.mode=mode;window.calls=[];window.conflict=false
  window.profile={id:'fictional',role:mode==='store'?'store':'admin'}
  window.site={id:'s',site_code:'1508',name:'Fictional Site',opportunities_formula:'simple'}
  window.employee={id:'e',location_id:'s',name:'Fictional Employee',is_active:true}
  window.ledger={sales:[{id:1,location_id:'s',sale_id:'100',log_date:'2026-11-10',item:'Membership',revision:0,decision:'pending',activity:'unknown',identity_confirmed:false,reason:'',employee_id:null,employee_name:null,has_original:true,has_reviewed:true,observations:[{id:1,kind:'original',employee_identifier:'1234567890',customer_name:'Fictional Customer',customer_phone:'5550100000',source_note:'Review prior membership evidence',commission:5},{id:2,kind:'reviewed',employee_identifier:'7890',customer_name:'Fictional Customer',customer_phone:'5550100000',source_note:'Review prior membership evidence',commission:5}]}],mappings:[],audit:[]}
  window.fakeRpc=async(name,{action,payload,...args}={})=>{
   window.calls.push({name,action,payload})
   if(name==='approved_employee_name_mappings')return{data:[]}
   if(mode!=='reviewer')return{error:{code:'42501'}}
   if(action==='status')return{data:{reviewer:true}}
   if(action==='read')return{data:structuredClone(window.ledger)}
   if(action==='customer_matches')return{data:{matches:[{id:2,sale_id:'101',log_date:'2026-11-01',name_match:true,phone_match:false,activity:'unknown',decision:'pending'}],truncated:false}}
   if(action==='import')return{data:{repeat:false,batch_id:1}}
   if(action==='propose_mapping'){window.ledger.mappings.push({...payload,id:1,revision:0,status:'proposed'});return{data:window.ledger.mappings[0]}}
   if(action==='decide_mapping'){Object.assign(window.ledger.mappings[0],payload,{revision:1});return{data:window.ledger.mappings[0]}}
   if(action==='review_sale'){
    if(window.conflict)return{error:{code:'P0001'}}
    Object.assign(window.ledger.sales[0],payload,{revision:window.ledger.sales[0].revision+1});return{data:window.ledger.sales[0]}
   }
   throw Error('Unexpected fixture RPC')
  }
 },{mode})
 await p.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort()
  if(u.pathname.endsWith('/src/contexts/AuthContext.jsx'))return route.fulfill({contentType:'application/javascript',body:'export const useAuth=()=>({profile:window.profile,managerPreview:false})'})
  if(u.pathname.endsWith('/src/components/NavBar.jsx'))return route.fulfill({contentType:'application/javascript',body:'export default function NavBar(){return null}'})
  if(u.pathname.endsWith('/src/lib/supabase.js'))return route.fulfill({contentType:'application/javascript',body:`export const supabase={rpc:window.fakeRpc,from:table=>{const q={select:()=>q,order:()=>q,eq:()=>q,in:()=>q,gte:()=>q,lte:()=>q,range:()=>q,then:f=>{const data=table==='locations'?[window.site]:table==='employees'?[window.employee]:[];return Promise.resolve({data,count:data.length}).then(f)}};return q}}`})
  return route.continue()
 })
 await p.goto(process.env.DRB_BROWSER_URL||'http://127.0.0.1:5194/tm-opsperformance/tests/browser/drb-reconciliation.html')
 return p
}
try{
 const p=await open()
 await p.getByLabel('Start',{exact:true}).fill('2026-11-08');await p.getByLabel('End',{exact:true}).fill('2026-11-14')
 await p.getByRole('button',{name:'Load comparison',exact:true}).click()
 await p.getByText('Employee comparison',{exact:true}).waitFor()
 assert.equal(await p.getByRole('columnheader',{name:'Verified Commission-Eligible Sales',exact:true}).count(),2)
 await p.getByLabel('Mapping location').selectOption('s');await p.getByLabel('Exact 10-digit identifier').fill('1234567890');await p.getByLabel('Roster employee').selectOption('e');await p.getByLabel('Verification reason',{exact:true}).fill('Verified roster crosswalk')
 await p.getByRole('button',{name:'Propose for selected dates'}).click();await p.getByLabel('Mapping 1 decision reason').fill('Reviewed identifier against roster')
 await p.getByRole('button',{name:'Approve',exact:true}).click()
 await p.locator('summary').filter({hasText:'Sale 100'}).click()
 assert.equal(await p.getByText('Review prior membership evidence',{exact:true}).count(),2)
 await p.getByRole('button',{name:'Review possible repeat customers'}).click();await p.getByRole('heading',{name:'Possible repeat customers'}).waitFor()
 await p.getByLabel('Activity',{exact:true}).selectOption('replacement');await p.getByLabel('Decision',{exact:true}).selectOption('excluded');await p.getByLabel("I verified this transaction's identity and source evidence.").check();await p.getByLabel('Review reason (required)').fill('Replacing an active membership')
 await p.getByRole('button',{name:'Save review',exact:true}).click()
 await p.locator('summary').filter({hasText:'Sale 100'}).waitFor()
 assert.match(await p.locator('summary').filter({hasText:'Sale 100'}).innerText(),/excluded/)
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:900})
  for(const dark of [false,true]){await p.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:`/tmp/tm-drb-${width}-${dark?'dark':'light'}.png`})}
 }
 // Values-only fictional XLSX through the real reader/parser.
 const z=new JSZip();z.file('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" r:id="rId1"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 const cells=rows=>rows.map(row=>'<row>'+row.map(v=>'<c t="inlineStr"><is><t>'+v+'</t></is></c>').join('')+'</row>').join('')
 z.file('xl/worksheets/sheet1.xml','<worksheet><sheetData>'+cells([['SITENUMBER','LOGDATE','SALEID','ITEM_NAME','CUST_ALTPHONE','COMMISSION'],['1508','2026-11-10','102','Membership','1234567890','5']])+'</sheetData></worksheet>')
 await p.getByLabel('DRB export',{exact:true}).setInputFiles({name:'fictional.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await z.generateAsync({type:'nodebuffer'})})
 await p.getByRole('button',{name:'Validate and preview'}).click();await p.getByText(/1 transactions · 1 locations/).waitFor();await p.getByRole('button',{name:'Save import',exact:true}).click();await p.getByText(/Import saved/).waitFor()
 assert.equal(await p.evaluate(()=>window.calls.some(c=>['import','review_sale','decide_mapping','propose_mapping'].includes(c.action))),true)
 await p.close()
 for(const mode of ['admin','store']){const page=await open(mode);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Load comparison'}).count(),0);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='read')),false);await page.close()}
 assert.deepEqual(errors,[])
 console.log('PASS: private access, import preview/save, UUID proposal/approval, exclusions, customer review, comparison, desktop/mobile Light/Dark; hosted traffic blocked.')
}finally{await browser.close()}
