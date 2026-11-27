import test from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { classifyDrbIdentifier, membershipCoverage, membershipEventKey, membershipTotals, parseMembershipFile, parseMembershipSheet, topMembershipSeller } from '../src/utils/posMembership.js'

const drb=['SITENUMBER','LOGDATE','SALEID','ITEM_NAME','CUST_NAME','CUST_MAINPHONE','CUST_ALTPHONE','COMMISSION','Legal Name']
const row=(id,identifier)=>['1508','2026-11-01',id,'Unl. Better Sld','Customer example','5555555555',identifier,'$0.58','Employee example']
const parse=rows=>parseMembershipSheet(rows,'2026-11-01','2026-11-07')
test('validated DRB uses full identifiers, retains reactivations and omits customer details',()=>{
 assert.deepEqual(classifyDrbIdentifier(' (020) 000-0123 '),{raw:'(020) 000-0123',digits:'0200000123',activity:'new'})
 assert.equal(classifyDrbIdentifier('012345678').activity,'new')
 assert.equal(classifyDrbIdentifier('012345678-').activity,'unresolved')
 const result=parse([drb,row('1','0200000123'),row('2','0123'),row('3','bad 123456789')])
 assert.deepEqual(result.events.map(x=>x.activity),['new','regular','unresolved'])
 assert.deepEqual(result.events.map(x=>x.eligible),[true,false,false])
 assert.equal(result.events[0].identifier,'0200000123')
 assert.equal(result.events[1].legalName,null)
 assert.equal(result.events[0].commission,58)
 assert.doesNotMatch(JSON.stringify(result),/Customer example|5555555555/)
 assert.throws(()=>parse([drb,row('1','0200000123'),row('1','0123')]),/Duplicate location and ticket/)
 const sameTicket=row('1','0123');sameTicket[0]='1511'
 assert.equal(parse([drb,row('1','0200000123'),sameTicket]).events.length,2)
})
test('Micrologic attribution uses only Greeter, excludes employee plans and keeps activity categories separate',()=>{
 const header=['Date','Barcode','Store Number','Name','Plan Type','Ticket Number','Cashier','Greeter']
 const mic=(ticket,greeter,product='Best Wash Unlimited',day='Nov 01, 2026')=>[day,'PRIVATE','TCWFM','PRIVATE',product,ticket,'cashierOnly',greeter]
 const ticketless=['Date','Barcode','Store Number','Name','Plan Type','Reason','Cashier']
 const result=parse([['ORG'],['Unlimited Detailed Report'],['New Signups — 4 records'],header,
  mic('A1','  KiOsK1 '),mic('A2',''),mic('A3','employee','Employee Best UWC'),
  mic('A4','employee','zBetter Blue Vet Unlimited BOGO'),['Reactivations — 1 records'],header,mic('A5','employee'),
  ['Grace Reactivations — 1 records'],header,mic('A6','employee','Best Wash Unlimited','Oct 31, 2026'),
  ['Cancellations — 2 records'],ticketless,
  ['Nov 01, 2026','PRIVATE','TCWFM','PRIVATE','Best Wash Unlimited','private note',''],
  ['Nov 01, 2026','PRIVATE','TCWFM','PRIVATE','Best Wash Unlimited','private note','']])
 assert.deepEqual(result.events.map(x=>x.eligible),[false,false,false,true,false])
 assert.equal(result.events[3].tier,'best')
 assert.equal(result.outside,1)
 const totals=membershipTotals(result.events,result.snapshots)
 assert.deepEqual([totals.new,totals.regular,totals.candidates,totals.kiosk,totals.blank,totals.cancel],[4,1,1,1,1,2])
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private note/)
})
test('Top Seller shows ties and is unavailable without credited new sales',()=>{
 assert.deepEqual(topMembershipSeller([{name:'B',credited:2},{name:'A',credited:2},{name:'C',credited:1}]),{names:['A','B'],count:2})
 assert.equal(topMembershipSeller([{name:'Nobody',credited:0}]),null)
})

test('leaders remain provisional when verified new sales do not cover GSR or attribution is unresolved',()=>{
 const covered={imported:true,gsr:8,observed:8,unresolved:0}
 assert.equal(membershipCoverage([covered]).provisional,false)
 assert.equal(membershipCoverage([{...covered,observed:4}]).provisional,true)
 assert.equal(membershipCoverage([{...covered,unresolved:1}]).provisional,true)
 assert.equal(membershipCoverage([{...covered,imported:false}]).provisional,true)
})

const micHeader=['Date','Barcode','Store Number','Name','Plan Type','Ticket Number','Cashier','Greeter']
const micRow=(day,site,ticket,product,customer='Private fixture')=>[day,'Private barcode',site,customer,product,ticket,'Cashier','Greeter']
const micro=(...sections)=>[['ORG'],['Unlimited Detailed Report'],...sections.flatMap(([name,...rows])=>[[name+' — '+rows.length+' records'],micHeader,...rows])]
const november=rows=>parseMembershipSheet(rows,'2026-11-01','2026-11-25')

test('identical Micrologic new and grace lines count once as grace regardless of section order',()=>{
 const same=micRow('Nov 09, 2026','TCWWR','A47169','Basic Wash Unlimited')
 for(const sections of [[['New Signups',same],['Grace Reactivations',same]],[['Grace Reactivations',same],['New Signups',same]]]){
  const result=november(micro(...sections))
  assert.equal(result.events.length,1)
  assert.equal(result.events[0].activity,'grace')
  assert.equal(result.events[0].eligible,false)
  assert.equal(result.overlaps.length,1)
  assert.doesNotMatch(JSON.stringify(result),/Private/)
 }
})
test('only verified generic Micrologic tickets use date identity, and a same-date ambiguity reports both rows',()=>{
 const a=micRow('Nov 14, 2026','TCWBLO','WASignup','Employee Best UWC')
 const b=micRow('Nov 15, 2026','TCWBLO','wasignup','Employee Best UWC')
 const result=november(micro(['New Signups',a,b]))
 assert.equal(result.events.length,2)
 assert.notEqual(...result.events.map(x=>membershipEventKey('Micrologic',x)))
 assert.throws(()=>november(micro(['New Signups',a,micRow('Nov 14, 2026','TCWBLO','wasignup','Employee Best UWC','Independent customer')])),
  error=>/1531.*2026-11-14.*WASignup.*new.*Excel row 5.*Excel row 6/.test(error.message)&&!/customer|barcode/.test(error.message))
 const ordinary=micRow('Nov 14, 2026','TCWBLO','A10','Basic Wash Unlimited')
 assert.throws(()=>november(micro(['New Signups',ordinary,micRow('Nov 15, 2026','TCWBLO','A10','Basic Wash Unlimited')])),
  /1531.*2026-11-14.*A10.*new.*2026-11-15/)
})
test('a blank Micrologic regular reactivation plan stays recorded with no tier and no credit',()=>{
 const result=november(micro(['Reactivations',micRow('Nov 20, 2026','TCWCB','A200','')]))
 assert.deepEqual(result.events.map(x=>[x.product,x.tier,x.eligible]),[['',null,false]])
})
const mtd=process.env.TM_MICROLOGIC_MTD_FIXTURE
test('November 1–25 original MTD workbook totals and reviewed ticket conflicts', {skip:!mtd},async()=>{
 const b=await readFile(mtd)
 const parsed=await parseMembershipFile({name:'fixture.xlsx',size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)},'2026-11-01','2026-11-25')
 const totals=membershipTotals(parsed.events,parsed.snapshots)
 assert.deepEqual([totals.new,totals.regular,totals.grace,totals.cancel,totals.decline,totals.candidates,totals.kiosk,totals.blank,parsed.outside],
  [740,58,97,566,539,624,102,14,3])
 assert.deepEqual(parsed.overlaps.map(x=>[x.ticket,x.activity]),[['A47169','grace'],['A49644','grace']])
 assert.deepEqual(parsed.events.filter(x=>x.site==='1531'&&x.ticket==='WASignup').map(x=>x.date),['2026-11-14','2026-11-15'])
})
