import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDrbTransactions, drbDate, saleBucket, reconciliationComparison, employeeReconciliation, classifyDrbIdentifier, adpBadgeKey } from '../src/utils/drbReconciliation.js'
const header=['SITENUMBER','LOGDATE','SALEID','ITEM_NAME','CUST_NAME','CUST_MAINPHONE','CUST_ALTPHONE','COMMISSION','Legal Name']
const record=['1508','2026-11-10','100','Membership','Fictional Customer','5550100000','0200000012','5','Fictional Employee']
const parse=(rows,kind='weekly')=>parseDrbTransactions([header,...rows],kind,'2026-11-08','2026-11-14')
test('weekly columns validated, repeated headers/blank totals handled without employee name inference',()=>{
 const doc=parse([record,header,[],['','','','','','','','100']]);assert.equal(doc.rows.length,1);assert.equal(doc.rows[0].employee_identifier,'0200000012');assert.equal(doc.rows[0].customer_name,'Fictional Customer');assert.equal(doc.rows[0].employee_name,undefined)
 assert.equal(parse([record],'weekly').kind,'weekly')
 assert.throws(()=>parse([record,record]),/line identifier/)
 assert.throws(()=>parseDrbTransactions([['Site','Count'],['1508','2']],'weekly','2026-11-08','2026-11-14'),/transaction-level/)
})
test('missing/date/identifier errors fail closed; suffixes preserved exactly and never padded',()=>{
 assert.throws(()=>drbDate('2026-02-30'),/Invalid/)
 assert.throws(()=>parse([[...record.slice(0,1),'2026-11-20',...record.slice(2)]]),/outside/)
 assert.equal(parse([[...record.slice(0,6),'5678',...record.slice(7)]],'weekly').rows[0].employee_identifier,'5678')
 const duplicate=[...header];duplicate.push('SALEID');assert.throws(()=>parseDrbTransactions([duplicate,record],'weekly','2026-11-08','2026-11-14'),/Expected/)
})
test('unreviewed, unmapped and incomplete evidence never become eligible',()=>{
 const sale={decision:'pending',identifier_classification:'retained',review_complete:true,employee_id:'e',identity_confirmed:true,activity:'new'}
 assert.equal(saleBucket({...sale,decision:'eligible',commission_status:'pending'}),'unresolved');assert.equal(saleBucket(sale),'unresolved');assert.equal(saleBucket({...sale,decision:'eligible'}),'eligible')
 for(const change of [{employee_id:null},{identity_confirmed:false},{review_complete:false},{identifier_classification:'unresolved'},{activity:'unknown'}])assert.equal(saleBucket({...sale,decision:'eligible',...change}),'unresolved')
 assert.equal(saleBucket({...sale,decision:'excluded'}),'excluded')
 assert.equal(saleBucket({...sale,decision:'pending',identifier_classification:'excluded',employee_id:null}),'excluded')
})
const range={start:'2026-11-08',end:'2026-11-14'},sites=[{id:'s',name:'Fictional Site',opportunities_formula:'simple'}]
const checkpoint=(name,t,n)=>({location_id:'s',log_date:'2026-11-10',time_slot:t,split_index:0,employee_name:name,total_washes:n*10,member_washes:0,basic:n,good:0,better:0,best:0,google_reviews:0})
const logs=[checkpoint('Alex','08:00',1),checkpoint('','09:00',2),checkpoint('Blair','10:00',3)]
const sale=(decision,extra={})=>({location_id:'s',log_date:'2026-11-10',identifier_classification:'retained',review_complete:true,identity_confirmed:true,activity:'new',employee_id:'e',employee_name:'Alex',decision,...extra})
test('weekly gross and commission buckets stay separate from unresolved employee attribution',()=>{
 const sales=[sale('eligible'),sale('excluded'),sale('pending'),sale('pending',{identifier_classification:'excluded',employee_id:null})],before=JSON.stringify({sales,logs})
 const r=reconciliationComparison(sales,logs,sites,range)[0]
 assert.deepEqual([r.reported,r.gross,r.eligible,r.excluded,r.unresolved,r.unresolvedAttribution],[2,4,1,2,1,1])
 assert.equal(JSON.stringify({sales,logs}),before)
 assert.equal(reconciliationComparison([],[],sites,range)[0].reported,null)
})
test('employee comparison only bridges approved historical UUIDs, never same-name matches',()=>{
 let rows=employeeReconciliation([sale('eligible')],logs,sites,range)
 assert.equal(rows.filter(r=>r.name==='Alex').length,2);assert.equal(rows.find(r=>r.employeeId==='e').reported,null)
 const mappings=[{location_id:'s',original_name:'Alex',employee_id:'e',employee_name:'Alex',status:'approved',start_date:range.start,end_date:range.end}]
 rows=employeeReconciliation([sale('eligible')],logs,sites,range,mappings)
 const alex=rows.find(r=>r.employeeId==='e');assert.equal(alex.reported,1);assert.equal(alex.gross,1);assert.equal(rows.filter(r=>r.name==='Alex').length,1)
})

test('source annotations retained verbatim without deriving an eligibility decision',()=>{
 const doc=parse([[...record,'Review prior membership']],'weekly')
 assert.equal(doc.rows[0].source_note,'Review prior membership');assert.equal(doc.rows[0].decision,undefined)
})

test('customer data cannot be reflected through arbitrary database error messages',async()=>{
 const {reconciliationError}=await import('../src/utils/drbReconciliation.js')
 assert.equal(reconciliationError({message:'Transaction changed; reload'}),'Transaction changed; reload')
 assert.doesNotMatch(reconciliationError({message:'Database detail: Fictional Customer 5550100000'}),/Fictional Customer|5550100000/)
})


test('classify original value first: full formats equivalent, four digits excluded, zeros preserved',()=>{
 for(const raw of ['0200000012','200000012'])assert.deepEqual(classifyDrbIdentifier(raw),{raw,classification:'retained',employeeKey:'0012'})
 assert.deepEqual(classifyDrbIdentifier('0012'),{raw:'0012',classification:'excluded',employeeKey:'0012'})
 for(const raw of ['', '012', '123456789', '9900000012', '2000000120'])assert.equal(classifyDrbIdentifier(raw).classification,'unresolved')
 assert.equal(adpBadgeKey('0200000012'),'0012');assert.equal(adpBadgeKey('200000012'),'0012');assert.equal(adpBadgeKey('0012'),'0012');assert.equal(adpBadgeKey('012'),null)
 const parsed=parse([[...record.slice(0,6),'200000012',...record.slice(7)]])
 assert.equal(parsed.rows[0].employee_identifier,'200000012')
 const spaced=parse([[...record.slice(0,6),' 0012 ',...record.slice(7)]])
 assert.equal(spaced.rows[0].employee_identifier,' 0012 ');assert.equal(classifyDrbIdentifier(spaced.rows[0].employee_identifier).classification,'unresolved')
})
