import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDrbTransactions, drbDate, saleBucket, reconciliationComparison, employeeReconciliation } from '../src/utils/drbReconciliation.js'
const header=['SITENUMBER','LOGDATE','SALEID','ITEM_NAME','CUST_NAME','CUST_MAINPHONE','CUST_ALTPHONE','COMMISSION','Legal Name']
const record=['1508','2026-11-10','100','Membership','Fictional Customer','5550100000','0012345678','5','Fictional Employee']
const parse=(rows,kind='original')=>parseDrbTransactions([header,...rows],kind,'2026-11-08','2026-11-14')
test('original and reviewed columns validated, repeated headers/blank totals handled without employee name inference',()=>{
 const doc=parse([record,header,[],['','','','','','','','100']]);assert.equal(doc.rows.length,1);assert.equal(doc.rows[0].employee_identifier,'0012345678');assert.equal(doc.rows[0].customer_name,'Fictional Customer');assert.equal(doc.rows[0].employee_name,undefined)
 assert.equal(parse([record],'reviewed').kind,'reviewed')
 assert.throws(()=>parse([record,record]),/line identifier/)
 assert.throws(()=>parseDrbTransactions([['Site','Count'],['1508','2']],'original','2026-11-08','2026-11-14'),/transaction-level/)
})
test('missing/date/identifier errors fail closed; suffixes preserved exactly and never padded',()=>{
 assert.throws(()=>drbDate('2026-02-30'),/Invalid/)
 assert.throws(()=>parse([[...record.slice(0,1),'2026-11-20',...record.slice(2)]]),/outside/)
 assert.equal(parse([[...record.slice(0,6),'5678',...record.slice(7)]],'reviewed').rows[0].employee_identifier,'5678')
 const duplicate=[...header];duplicate.push('SALEID');assert.throws(()=>parseDrbTransactions([duplicate,record],'original','2026-11-08','2026-11-14'),/Expected/)
})
test('unreviewed, unmapped and incomplete evidence never become eligible',()=>{
 const sale={decision:'pending',has_original:true,has_reviewed:true,employee_id:'e',identity_confirmed:true,activity:'new'}
 assert.equal(saleBucket(sale),'unresolved');assert.equal(saleBucket({...sale,decision:'eligible'}),'eligible')
 for(const change of [{employee_id:null},{identity_confirmed:false},{has_original:false},{has_reviewed:false},{activity:'unknown'}])assert.equal(saleBucket({...sale,decision:'eligible',...change}),'unresolved')
 assert.equal(saleBucket({...sale,decision:'excluded'}),'excluded')
})
const range={start:'2026-11-08',end:'2026-11-14'},sites=[{id:'s',name:'Fictional Site',opportunities_formula:'simple'}]
const checkpoint=(name,t,n)=>({location_id:'s',log_date:'2026-11-10',time_slot:t,split_index:0,employee_name:name,total_washes:n*10,member_washes:0,basic:n,good:0,better:0,best:0,google_reviews:0})
const logs=[checkpoint('Alex','08:00',1),checkpoint('','09:00',2),checkpoint('Blair','10:00',3)]
const sale=(decision,extra={})=>({location_id:'s',log_date:'2026-11-10',has_original:true,has_reviewed:true,identity_confirmed:true,activity:'new',employee_id:'e',employee_name:'Alex',decision,...extra})
test('gross, eligible, excluded and unresolved partition original records, reviewed-only is separate, inputs untouched',()=>{
 const sales=[sale('eligible'),sale('excluded'),sale('pending'),sale('pending',{has_original:false})],before=JSON.stringify({sales,logs})
 const r=reconciliationComparison(sales,logs,sites,range)[0]
 assert.deepEqual([r.reported,r.gross,r.eligible,r.excluded,r.unresolved,r.reviewedOnly],[2,3,1,1,1,1])
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

test('source annotations retained verbatim without deriving an exclusion decision',()=>{
 const doc=parse([[...record,'Review prior membership']],'reviewed')
 assert.equal(doc.rows[0].source_note,'Review prior membership');assert.equal(doc.rows[0].decision,undefined)
})

test('customer data cannot be reflected through arbitrary database error messages',async()=>{
 const {reconciliationError}=await import('../src/utils/drbReconciliation.js')
 assert.equal(reconciliationError({message:'Transaction changed; reload'}),'Transaction changed; reload')
 assert.doesNotMatch(reconciliationError({message:'Database detail: Fictional Customer 5550100000'}),/Fictional Customer|5550100000/)
})
