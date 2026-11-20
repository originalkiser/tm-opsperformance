// Opt-in local validation of one weekly export. No customer/employee values logged.
import { readFile } from 'node:fs/promises'
import { readDrbWorkbook } from '../../app/src/utils/drbWorkbook.js'
import { parseDrbTransactions, classifyDrbIdentifier } from '../../app/src/utils/drbReconciliation.js'
if (!process.env.DRB_WEEKLY_FILE) throw Error('Set DRB_WEEKLY_FILE, DRB_START and DRB_END.')
const doc=parseDrbTransactions(await readDrbWorkbook(await readFile(process.env.DRB_WEEKLY_FILE)),'weekly',process.env.DRB_START,process.env.DRB_END)
const classified=doc.rows.map(r=>classifyDrbIdentifier(r.employee_identifier))
console.log(JSON.stringify({kind:'weekly',transactions:doc.rows.length,sites:new Set(doc.rows.map(r=>r.site_code)).size,retained:classified.filter(r=>r.classification==='retained').length,excluded:classified.filter(r=>r.classification==='excluded').length,unresolvedFormat:classified.filter(r=>r.classification==='unresolved').length,nineDigitRetained:classified.filter(r=>r.classification==='retained'&&r.raw.length===9).length,duplicateSiteSaleKeys:doc.rows.length-new Set(doc.rows.map(r=>r.site_code+':'+r.sale_id)).size,customerFieldsInProjection:doc.rows.some(r=>Object.keys(r).some(k=>/customer|phone|note/i.test(k))),commissionEligibleBeforeCompletion:0}))
