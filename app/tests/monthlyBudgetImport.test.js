import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { parseBudgetSheets, parseMonthlyBudget, sumDecimals, decimal, monthDays } from '../src/utils/monthlyBudgetWorkbook.js'
import { membershipStatus, computeMembershipGoal } from '../src/utils/budgetMath.js'
import { scoreBudgetLocations } from '../src/utils/budgetScoring.js'

const col = n => { let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s }
function fixture(month='2028-02-01') {
 const days=monthDays(month), cells=new Map(), labor=new Map()
 const put=(m,k,v,numeric=true)=>m.set(k,{value:String(v),numeric})
 for(const [block,header] of [3,10,17].entries()) {
  const category=['total','retail','recurring'][block], amount={total:'1.000000000000000001',retail:'0.25',recurring:'0.750000000000000001'}[category]
  for(let d=1;d<=days;d++) {
   put(cells,col(d+2)+header,Math.round((Date.parse(month)+86400000*(d-1)-Date.UTC(1899,11,30))/86400000))
   for(let i=0;i<2;i++)put(cells,col(d+2)+(header+1+i),amount)
   put(cells,col(d+2)+(header+3),sumDecimals([amount,amount]))
  }
  for(const [i,site] of ['1508','1512'].entries()) {
   put(cells,'A'+(header+1+i),site);put(cells,'B'+(header+1+i),sumDecimals(Array(days).fill(amount)))
   put(cells,col(days+4)+(header+1+i),sumDecimals(Array(days).fill(amount)))
  }
 }
 put(labor,'A3','1508');put(labor,'D3','0.35');put(labor,'A4','1512');put(labor,'B4','100');put(labor,'C4','145')
 return [{name:'Feb Plan',cells},{name:'Labor and Membership Goals',cells:labor}]
}
async function workbook(sheets) {
 const zip=new JSZip(), names=sheets.map((s,i)=>`<sheet name="${s.name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')
 zip.file('xl/workbook.xml',`<workbook xmlns:r="urn:relationships"><sheets>${names}</sheets></workbook>`)
 zip.file('xl/_rels/workbook.xml.rels',`<Relationships>${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`)
 sheets.forEach((s,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,`<worksheet><sheetData>${[...s.cells].map(([r,c])=>`<c r="${r}"${c.numeric?'':' t="inlineStr"'}>${c.numeric?`<v>${c.value}</v>`:`<is><t>${c.value}</t></is>`}</c>`).join('')}</sheetData></worksheet>`))
 return zip.generateAsync({type:'arraybuffer'})
}

test('raw XLSX preserves all fractional cents and reconciles leap-year daily goals',async()=>{
 const parsed=await parseMonthlyBudget(await workbook(fixture()))
 assert.equal(parsed.month,'2028-02-01');assert.equal(parsed.sites[0].daily.length,29)
 assert.equal(parsed.sites[0].daily[0].total,'1.000000000000000001')
 assert.equal(parsed.totals.total,'58.000000000000000058')
 assert.equal(parsed.sites[1].hours_with_manager,'145');assert.equal(parsed.sites[0].percentage,'0.35')
 assert.equal(decimal('7.500000000000000001E-2'),'0.07500000000000000001')
})
test('28–31 days, including February non-leap years and year boundaries',()=>{
 for(const [month,days]of [['2027-02-01',28],['2028-02-01',29],['2024-02-01',29],['2026-11-01',30],['2026-12-01',31],['2027-01-01',31]]) {
  const parsed=parseBudgetSheets(fixture(month));assert.equal(parsed.sites[0].daily.length,days)
  assert.equal(computeMembershipGoal(100,2,month),100+2*days)
 }
})
test('missing dates, duplicate sites, bad controls, labor and category discrepancies stop parsing',()=>{
 for(const breakIt of [s=>s[0].cells.delete('C3'),s=>s[0].cells.set('A5',{value:'1508',numeric:true}),s=>s[0].cells.set('B4',{value:'999',numeric:true}),s=>s[1].cells.set('C4',{value:'144',numeric:true}),s=>s[0].cells.set('C11',{value:'2',numeric:true})]) {
  const sheets=fixture();breakIt(sheets);assert.throws(()=>parseBudgetSheets(sheets))
 }
})
test('invalid XML / formula errors and absent cached values cannot become zero',async()=>{
 const buf=await workbook(fixture()),zip=await JSZip.loadAsync(buf)
 zip.file('xl/worksheets/sheet1.xml','<worksheet><c r="C3"><f>TODAY()</f></c></worksheet>')
 await assert.rejects(parseMonthlyBudget(await zip.generateAsync({type:'arraybuffer'})),/cached result/)
 assert.throws(()=>decimal('-1'));assert.throws(()=>decimal('NaN'))
})
test('pending membership is unavailable, not a zero goal or zero growth achievement',()=>{
 assert.equal(membershipStatus(150,null,'2028-02-10').tier,'Membership baseline pending')
 assert.equal(membershipStatus(150,null,'2028-02-10').progressRatio,null)
 const result=scoreBudgetLocations({locations:[{id:'a',name:'A',show_budget_tracking:true}],targets:[{location_id:'a',target_month:'2028-02-01',starting_members:null,membership_goal:null,membership_daily_growth:2}],entries:[{location_id:'a',entry_date:'2028-02-10',mtd_membership_actual:150}]},'2028-02-10').rows[0]
 assert.equal(result.growth,null);assert.equal(result.components.growth,null);assert.equal(result.membershipPending,true)
 assert.equal(result.componentIssues.growth,'Membership baseline pending; growth category unavailable')
 assert.ok(Number.isFinite(result.score));assert.equal(result.rank,1)
 assert.equal(computeMembershipGoal(0,2,'2028-02-01'),58)
})
