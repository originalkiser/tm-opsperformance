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
const genericMicrologicTicket = (system, ticket) => system === 'Micrologic' && ticket.toLowerCase() === 'wasignup'
export function membershipEventKey(system, { site, date, ticket }) {
  return JSON.stringify(genericMicrologicTicket(system,ticket) ? [site,ticket.toLowerCase(),date] : [site,ticket])
}
const describeEvent = (event,row) => `${event.site} · ${event.date} · ticket ${event.ticket} · ${event.activity}` +
  (row ? ` · Excel row ${row}` : '')
function parseCommissionDetails(rows, start, end) {
  const [period, sourceSite] = clean(rows[2]?.[0]).split('·').map(clean)
  const [from, through = from] = period.split(/\s+[–—-]\s+/).map(date)
  const site = micSites[sourceSite]
  if (!site) return null
  if (from !== start || through !== end) throw new Error('Choose the exact date range printed on the commission report.')
  if (!/·\s*All Goods\/Services\s*·.*·\s*Pays: All\s*$/i.test(clean(rows[3]?.[0])))
    throw new Error('Use an unfiltered goods/services and payment export.')
  const headerIndex = rows.findIndex(row => row[0] === 'Name' && row.includes('Qty (#)'))
  if (headerIndex < 0) throw new Error('The commission details quantity column is missing.')
  const qtyColumn = rows[headerIndex].indexOf('Qty (#)')
  let username, category, signupTotal = 0, grand = false
  const details = []
  for (const row of rows.slice(headerIndex + 1)) {
    const label = clean(row[0])
    if (label.startsWith('User:')) {
      if (category === 'UNLIMITED SIGNUP') throw new Error('A signup subtotal is missing.')
      username = posUsername(label.slice(5)); category = null
    } else if (label.startsWith('Category:')) {
      if (category === 'UNLIMITED SIGNUP') throw new Error('A signup subtotal is missing.')
      category = clean(label.slice(9)).toUpperCase(); signupTotal = 0
    } else if (label.startsWith('Category Total')) {
      if (category === 'UNLIMITED SIGNUP' &&
          (!label.toUpperCase().endsWith('UNLIMITED SIGNUP') || !clean(row[qtyColumn]) || Number(row[qtyColumn]) !== signupTotal)) {
        throw new Error('Commission signup details do not match their category subtotal.')
      }
      category = null
    } else if (label.startsWith('User Total') || /^GRAND TOTALS:/i.test(label)) {
      if (category === 'UNLIMITED SIGNUP') throw new Error('A signup subtotal is missing.')
      if (/^GRAND TOTALS:/i.test(label)) grand = true
      username = null
    } else if (category === 'UNLIMITED SIGNUP' && (label || clean(row[qtyColumn]))) {
      const quantity = Number(row[qtyColumn])
      if (!username || !/^[0-9]+$/.test(clean(row[qtyColumn])) || !Number.isSafeInteger(quantity) || quantity < 1)
        throw new Error('Commission signup detail has an invalid user or quantity.')
      details.push({ username, product: label, quantity }); signupTotal += quantity
    }
  }
  if (category === 'UNLIMITED SIGNUP' || !grand) throw new Error('The commission report is incomplete.')
  return { site, activeOnly: /·\s*Active users only\s*·/i.test(clean(rows[3]?.[0])), details }
}

export function parseMembershipSheet(rows, start, end) {
  if (date(start) !== start || date(end) !== end || start > end) throw new Error('Choose a valid business-date range.')
  const events=[], snapshot=new Map(), found=new Map(), overlaps=[]
  let comparison=null,outside=0
  const record = (system,item,source) => {
    if (!item.date || !item.site || !item.ticket || (!item.product && !(system==='Micrologic' && item.activity==='regular'))) throw new Error('A transaction is missing a valid site, business date, ticket or product.')
    if (item.date<start || item.date>end) { outside++; return }
    const key=membershipEventKey(system,item), prior=found.get(key)
    if (prior) {
      // Raw fields, including customer columns, are compared only here in memory.
      // Do not place them in the preview, error, or persistence payload.
      const sameRow = source && prior.source && source.fields === prior.source.fields
      const signupAndGrace = [prior.activity,item.activity].includes('new') && [prior.activity,item.activity].includes('grace')
      if (system !== 'Micrologic' || !sameRow || (!signupAndGrace && prior.activity !== item.activity)) {
        throw new Error(`Duplicate location and ticket conflict: ${describeEvent(prior,prior.source?.row)} and ${describeEvent(item,source?.row)}. Review the source before saving.`)
      }
      const selected = prior.activity === 'grace' ? events[prior.index] : item
      events[prior.index]=selected
      found.set(key,{...selected,source,index:prior.index})
      overlaps.push({site:item.site,date:item.date,ticket:item.ticket,activity:selected.activity})
      return
    }
    found.set(key,{...item,source,index:events.length})
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
      record('DRB',{site,date:date(get('LOGDATE')),ticket,product,tier:memberTier('DRB',product),activity:id.activity,
        identifier:id.digits?id.raw:null,legalName:id.activity==='new'?get('Legal Name')||null:null,
        commission:cents(get('COMMISSION')),greeter:null,cashier:null,eligible:id.activity==='new'})
    }
    return {system:'DRB',events,snapshots:[],outside}
  }
  if(rows[1]?.[0]==='Sales Commissions'){
    const header=rows.find(r=>r[0]==='Name'&&r[1]==='Qty (#)')
    const total=rows.find(r=>r[0]?.startsWith('GRAND TOTALS:'))
    if(!header||!total)throw new Error('Micrologic commission totals are missing.')
    if (/Type: Summary w\. Details(?:\s*·|$)/i.test(clean(rows[3]?.[0]))) {
      const commissions = parseCommissionDetails(rows, start, end)
      if (commissions) return { system:'Micrologic', events:[], snapshots:[], commissions, outside }
    }
    comparison={quantity:Number(total[header.indexOf('Qty (#)')]),sales:cents(total[header.indexOf('$ Sales (Total)')]),
      commission:cents(total[header.indexOf('$ Comm (Total)')])}
    return {system:'Micrologic',events,snapshots:[],comparison,outside}
  }
  if(rows[1]?.[0]!=='Unlimited Detailed Report')throw new Error('Unsupported membership workbook.')
  let activity,header
  for(const [index,row] of rows.entries()){
    const section=/^(.*?) — \d+ records$/.exec(clean(row[0]))
    if(section){activity=sections[section[1]];header=null;continue}
    if(!activity)continue
    if(row[0]==='Date'){
      const required=['Date','Store Number','Plan Type',...(activity==='cancel'||activity==='decline'?[]:['Ticket Number','Cashier','Greeter','Barcode','Name'])]
      if(required.some(key=>row.filter(value=>value===key).length!==1))throw new Error('Micrologic activity columns are missing or ambiguous.')
      header=row;continue
    }
    if(!row.some(clean))continue
    if(!header)throw new Error('Micrologic activity columns are missing.')
    const get=k=>clean(row[header.indexOf(k)])
    const day=date(get('Date')),site=micSites[get('Store Number').toUpperCase()],product=get('Plan Type')
    if(!day||!site||(!product&&activity!=='regular'))throw new Error('Unknown Micrologic location, date or product.')
    if(day<start||day>end){outside++;continue}
    if(activity==='cancel'||activity==='decline'){
      const key=JSON.stringify([site,day,activity,product])
      const entry=snapshot.get(key)??{site,date:day,activity,product,count:0}
      entry.count++
      snapshot.set(key,entry)
    }else{
      const greeter=get('Greeter')||null
      record('Micrologic',{site,date:day,activity,product,tier:memberTier('Micrologic',product),ticket:get('Ticket Number'),
        greeter,cashier:get('Cashier')||null,identifier:null,legalName:null,commission:null,
        eligible:activity==='new'&&!!greeter&&!kioskUsername(greeter)&&!/^employee\b/.test(posUsername(product))},{
          row:index+1, fields:JSON.stringify(['Date','Barcode','Store Number','Name','Plan Type','Ticket Number','Cashier','Greeter'].map(get)),
        })
    }
  }
  return {system:'Micrologic',events,snapshots:[...snapshot.values()],outside,overlaps}
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
 const verified=days.filter(d=>d.imported&&d.gsr!=null&&d.gsr===(d.commission_daily_observed??d.observed)).length
 const unresolved=days.reduce((n,d)=>n+d.unresolved,0)
 return {verified,expected:days.length,unresolved,provisional:verified!==days.length||unresolved>0||days.some(d=>d.commission_provisional)}
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
