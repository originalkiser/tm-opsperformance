import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDrbIdentifier, membershipTotals, parseMembershipSheet, topMembershipSeller } from '../src/utils/posMembership.js'

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
