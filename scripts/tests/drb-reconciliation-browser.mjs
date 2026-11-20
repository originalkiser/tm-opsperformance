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
  const sale=(id,raw,classification)=>({id,location_id:'s',sale_id:String(99+id),log_date:'2026-11-10',item:'Membership',identifier_classification:classification,employee_key:classification==='unresolved'?null:'0012',commission_status:classification==='excluded'?'excluded':'pending',review_complete:false,employee_id:null,employee_name:null,observations:[{id,kind:'weekly',employee_identifier:raw,identifier_classification:classification,commission:5}]})
  window.ledger={sales:[sale(1,'200000012','retained'),sale(2,'0012','excluded'),sale(3,'unusual','unresolved')],batches:[{id:1,revision:0,start_date:'2026-11-08',end_date:'2026-11-14',review_completed_at:null}],mappings:[],audit:[]}
  window.fakeRpc=async(name,{action,payload,...args}={})=>{
   window.calls.push({name,action,payload})
   if(name==='approved_employee_name_mappings')return{data:[]}
   if(mode!=='reviewer')return{error:{code:'42501'}}
   if(action==='status')return{data:{reviewer:true}}
   if(action==='read')return{data:structuredClone(window.ledger)}
   if(action==='import')return{data:{repeat:false,batch_id:1}}
   if(action==='propose_mapping'){window.ledger.mappings.push({...payload,id:1,revision:0,status:'proposed'});return{data:window.ledger.mappings[0]}}
   if(action==='decide_mapping'){Object.assign(window.ledger.mappings[0],payload,{revision:1});for(const sale of window.ledger.sales.slice(0,2)){sale.employee_id='e';sale.employee_name=window.employee.name}return{data:window.ledger.mappings[0]}}
   if(action==='complete_review'){
    if(window.conflict)return{error:{code:'P0001',message:'Imported period changed; reload before confirming review'}}
    Object.assign(window.ledger.batches[0],{revision:1,review_completed_at:'2026-11-20T14:00:00Z'})
    for(const sale of window.ledger.sales){sale.review_complete=true;if(sale.identifier_classification==='retained'&&sale.employee_id)sale.commission_status='eligible'}
    return{data:window.ledger.batches[0]}
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
 await p.getByLabel('Mapping location').selectOption('s');await p.getByLabel('ADP Badge Number (exact)').fill('0200000012');await p.getByLabel('ADP roster evidence/reference').fill('Fictional authoritative ADP roster');await p.getByLabel('Roster employee').selectOption('e');await p.getByLabel('Verification reason',{exact:true}).fill('Verified roster crosswalk')
 await p.getByRole('button',{name:'Propose for selected dates'}).click();await p.getByLabel('Mapping 1 decision reason').fill('Reviewed identifier against roster')
 await p.getByRole('button',{name:'Approve',exact:true}).click()
 assert.equal(await p.getByRole('button',{name:'Review Complete',exact:true}).isDisabled(),true)
 assert.match(await p.locator('summary').filter({hasText:'Sale 100'}).innerText(),/unresolved/)
 assert.match(await p.locator('summary').filter({hasText:'Sale 101'}).innerText(),/excluded/)
 await p.getByLabel('Sara has completed review of this export for this reporting period.').check()
 await p.getByRole('button',{name:'Review Complete',exact:true}).click()
 await p.getByText(/Review Complete ·/).waitFor()
 assert.match(await p.locator('summary').filter({hasText:'Sale 100'}).innerText(),/eligible/)
 assert.match(await p.locator('summary').filter({hasText:'Sale 101'}).innerText(),/excluded/)
 assert.match(await p.locator('summary').filter({hasText:'Sale 102'}).innerText(),/unresolved/)
 assert.equal(await p.getByRole('button',{name:'Review possible repeat customers'}).count(),0)
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:900})
  for(const dark of [false,true]){await p.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:`/tmp/tm-drb-${width}-${dark?'dark':'light'}.png`})}
 }
 // Values-only fictional XLSX through the real reader/parser.
 const z=new JSZip();z.file('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" r:id="rId1"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 const cells=rows=>rows.map(row=>'<row>'+row.map(v=>'<c t="inlineStr"><is><t>'+v+'</t></is></c>').join('')+'</row>').join('')
 z.file('xl/worksheets/sheet1.xml','<worksheet><sheetData>'+cells([['SITENUMBER','LOGDATE','SALEID','ITEM_NAME','CUST_ALTPHONE','COMMISSION','CUST_NAME','CUST_MAINPHONE'],['1508','2026-11-10','102','Membership','200000012','5','CUSTOMER MUST NOT UPLOAD','5550100000','PRIVATE CUSTOMER NOTE']])+'</sheetData></worksheet>')
 await p.getByLabel('DRB export',{exact:true}).setInputFiles({name:'fictional.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await z.generateAsync({type:'nodebuffer'})})
 await p.getByRole('button',{name:'Validate and preview'}).click();await p.getByText(/1 transactions · 1 locations/).waitFor();await p.getByRole('button',{name:'Save import',exact:true}).click();await p.getByText(/Import saved/).waitFor()
 assert.equal(await p.evaluate(()=>window.calls.filter(c=>c.action==='import').every(c=>c.payload.kind==='weekly')),true)
 assert.equal(await p.evaluate(()=>window.calls.some(c=>['import','complete_review','decide_mapping','propose_mapping'].includes(c.action))),true)
 assert.equal(await p.evaluate(()=>JSON.stringify(window.calls).includes('CUSTOMER MUST NOT UPLOAD')||JSON.stringify(window.calls).includes('5550100000')||JSON.stringify(window.calls).includes('PRIVATE CUSTOMER NOTE')),false)
 await p.close()
 for(const mode of ['admin','store']){const page=await open(mode);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Load comparison'}).count(),0);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='read')),false);await page.close()}
 assert.deepEqual(errors,[])
 console.log('PASS: private access, import preview/save, ADP crosswalk, authorized period completion, eligible/excluded/unresolved outcomes, no customer upload, comparison, desktop/mobile Light/Dark; hosted traffic blocked.')
}finally{await browser.close()}
