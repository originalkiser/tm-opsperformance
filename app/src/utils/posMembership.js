import { readWorkbookSheets } from './drbWorkbook.js'
import { fileDigest } from './posImportStorage.js'

const micSites = { TCWWR:'1529', TCWBR:'1528', PECWF:'1517', TCWBLO:'1531', TCWEJB:'1532', TCWCB:'1515', TCWFM:'1512' }
const sections = { 'New Signups':'new', Reactivations:'regular', 'Grace Reactivations':'grace', Cancellations:'cancel', Declines:'decline' }
const clean = value => String(value ?? '').trim()
export const posUsername = value => clean(value).toLowerCase()
export const kioskUsername = value => /^kiosk[123]?$/.test(posUsername(value))
const memberTier = (system, product) => {
  const item = posUsername(product)
  if (system === 'DRB') {
    if (item === 'unl police special') return 'non-tier'
    if (item === 'unl. military sld') return 'best'
    return /^unl\. (basic|good|better|best)(?: w\$| int)? sld$/.exec(item)?.[1] ?? null
  }
  if (['zbetter blue vet unlimited bogo','employee best uwc'].includes(item)) return 'best'
  return /^(basic|good|better|best)(?: wash unlimited(?: sign up(?: -promo)?)?| - rinsed - 50% off 3 months updated)$/.exec(item)?.[1] ?? null
}
function date(value) {
  const text = clean(value)
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(text)
  const month = m && 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ').indexOf(m[1])+1
  const iso = m && month ? `${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}` : text
  return /^\d{4}-\d\d-\d\d$/.test(iso) && Number.isFinite(Date.parse(iso)) &&
    new Date(iso).toISOString().slice(0,10) === iso ? iso : null
}
const cents = value => {
  const raw = clean(value).replace(/[$,]/g,'').replace(/^\((.*)\)$/,'-$1')
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return null
  const result = Math.round(Number(raw)*100)
  return Number.isSafeInteger(result) ? result : null
}
export function classifyDrbIdentifier(value) {
  const raw = clean(value)
  const safe = /^(?:[0-9]+|\([0-9]{2,4}\)[ .-]*[0-9]+)(?:[ .-]+[0-9]+)*$/.test(raw)
  const digits = raw.length<=32 && safe ? raw.replace(/[^0-9]/g,'') : ''
  return { raw, digits, activity: /^[0-9]{9,10}$/.test(digits) ? 'new' : /^[0-9]{4}$/.test(digits) ? 'regular' : 'unresolved' }
}
export function parseMembershipSheet(rows, start, end) {
  if (date(start) !== start || date(end) !== end || start > end) throw new Error('Choose a valid business-date range.')
  const events=[], snapshot=new Map(), found=new Set()
  let comparison=null,outside=0
  const record = item => {
    if (!item.date || !item.site || !item.ticket || !item.product) throw new Error('A transaction is missing a valid site, business date, ticket or product.')
    if (item.date<start || item.date>end) { outside++; return }
    const key=item.site+'/'+item.ticket
    if (found.has(key)) throw new Error('Duplicate location and ticket in this workbook. Review the source before saving.')
    found.add(key)
    events.push(item)
  }
  if (rows[0]?.[0]==='SITENUMBER') {
    const header=rows[0]
    const required=['SITENUMBER','LOGDATE','SALEID','ITEM_NAME','CUST_ALTPHONE','COMMISSION','Legal Name']
    if(required.some(k=>header.filter(h=>h===k).length!==1))throw new Error('DRB source columns are missing or ambiguous.')
    for(const row of rows.slice(1)){
      if(!row.some(clean)||row.slice(1).every(v=>!clean(v))&&!/^\d{4}$/.test(clean(row[0])))continue
      const get=k=>clean(row[header.indexOf(k)])
      const site=get('SITENUMBER'),ticket=get('SALEID'),product=get('ITEM_NAME')
      if(!/^\d{4}$/.test(site)||!/^\d{1,30}$/.test(ticket))throw new Error('Unexpected DRB location or sale ID.')
      const id=classifyDrbIdentifier(get('CUST_ALTPHONE'))
      record({site,date:date(get('LOGDATE')),ticket,product,tier:memberTier('DRB',product),activity:id.activity,
        identifier:id.digits?id.raw:null,legalName:id.activity==='new'?get('Legal Name')||null:null,
        commission:cents(get('COMMISSION')),greeter:null,cashier:null,eligible:id.activity==='new'})
    }
    return {system:'DRB',events,snapshots:[],outside}
  }
  if(rows[1]?.[0]==='Sales Commissions'){
    const header=rows.find(r=>r[0]==='Name'&&r[1]==='Qty (#)')
    const total=rows.find(r=>r[0]?.startsWith('GRAND TOTALS:'))
    if(!header||!total)throw new Error('Micrologic commission totals are missing.')
    comparison={quantity:Number(total[header.indexOf('Qty (#)')]),sales:cents(total[header.indexOf('$ Sales (Total)')]),
      commission:cents(total[header.indexOf('$ Comm (Total)')])}
    return {system:'Micrologic',events,snapshots:[],comparison,outside}
  }
  if(rows[1]?.[0]!=='Unlimited Detailed Report')throw new Error('Unsupported membership workbook.')
  let activity,header
  for(const row of rows){
    const section=/^(.*?) — \d+ records$/.exec(clean(row[0]))
    if(section){activity=sections[section[1]];header=null;continue}
    if(!activity)continue
    if(row[0]==='Date'){
      const required=['Date','Store Number','Plan Type',...(activity==='cancel'||activity==='decline'?[]:['Ticket Number','Cashier','Greeter'])]
      if(required.some(key=>row.filter(value=>value===key).length!==1))throw new Error('Micrologic activity columns are missing or ambiguous.')
      header=row;continue
    }
    if(!row.some(clean))continue
    if(!header)throw new Error('Micrologic activity columns are missing.')
    const get=k=>clean(row[header.indexOf(k)])
    const day=date(get('Date')),site=micSites[get('Store Number').toUpperCase()],product=get('Plan Type')
    if(!day||!site||!product)throw new Error('Unknown Micrologic location, date or product.')
    if(day<start||day>end){outside++;continue}
    if(activity==='cancel'||activity==='decline'){
      const key=JSON.stringify([site,day,activity,product])
      const entry=snapshot.get(key)??{site,date:day,activity,product,count:0}
      entry.count++
      snapshot.set(key,entry)
    }else{
      const greeter=get('Greeter')||null
      record({site,date:day,activity,product,tier:memberTier('Micrologic',product),ticket:get('Ticket Number'),
        greeter,cashier:get('Cashier')||null,identifier:null,legalName:null,commission:null,
        eligible:activity==='new'&&!!greeter&&!kioskUsername(greeter)&&!/^employee\b/.test(posUsername(product))})
    }
  }
  return {system:'Micrologic',events,snapshots:[...snapshot.values()],outside}
}
export async function parseMembershipFile(file,start,end){
  if(!file||!/\.xlsx$/i.test(file.name)||file.size>10_000_000)throw new Error('Choose an original XLSX workbook up to 10 MB.')
  const bytes=await file.arrayBuffer()
  const [sheet]=await readWorkbookSheets(bytes)
  return {...parseMembershipSheet(sheet.rows,start,end),sha:await fileDigest(bytes),start,end}
}
export function membershipTotals(events,snapshots=[]){
  const totals={new:0,regular:0,grace:0,cancel:0,decline:0,unresolved:0,candidates:0,kiosk:0,blank:0,tiers:{}}
  for(const row of events){
    totals[row.activity]++
    if(row.eligible)totals.candidates++
    if(row.activity==='new'&&row.greeter&&kioskUsername(row.greeter))totals.kiosk++
    if(row.activity==='new'&&row.identifier==null&&!row.greeter)totals.blank++
    if(row.activity==='new'){const k=row.tier??'unknown';totals.tiers[k]=(totals.tiers[k]??0)+1}
  }
  for(const row of snapshots)totals[row.activity]+=row.count
  return totals
}
export function membershipCoverage(days){
 const verified=days.filter(d=>d.imported&&d.gsr!=null&&d.gsr===d.observed).length
 const unresolved=days.reduce((n,d)=>n+d.unresolved,0)
 return {verified,expected:days.length,unresolved,provisional:verified!==days.length||unresolved>0}
}
export function topMembershipSeller(rows){
  const eligible=rows.filter(x=>x.credited>0)
  if(!eligible.length)return null
  const max=Math.max(...eligible.map(x=>x.credited))
  return {names:eligible.filter(x=>x.credited===max).map(x=>x.name).sort(),count:max}
}
export async function membershipRpc(client,name,payload){
  const {data,error}=await client.rpc('pos_membership_'+name,payload)
  if(error)throw new Error(error.message)
  return data
}
