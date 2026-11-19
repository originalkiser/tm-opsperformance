// Opt-in local validation. Never prints source rows, identities or customer data.
import { readFile } from 'node:fs/promises'
import { readDrbWorkbook } from '../../app/src/utils/drbWorkbook.js'
import { parseDrbTransactions } from '../../app/src/utils/drbReconciliation.js'
const documents=[]
for(const [kind,path] of [['original',process.env.DRB_ORIGINAL_FILE],['reviewed',process.env.DRB_REVIEWED_FILE]]){
 if(!path)throw Error('Set DRB_ORIGINAL_FILE and DRB_REVIEWED_FILE to local examples.')
 const matrix=await readDrbWorkbook(await readFile(path))
 const doc=parseDrbTransactions(matrix,kind,process.env.DRB_START,process.env.DRB_END)
 documents.push(doc)
 console.log(JSON.stringify({kind,transactions:doc.rows.length,sites:new Set(doc.rows.map(r=>r.site_code)).size,fullIdentifiers:doc.rows.filter(r=>/^\d{10}$/.test(r.employee_identifier)).length,shortIdentifiers:doc.rows.filter(r=>/^\d{4}$/.test(r.employee_identifier)).length,annotatedTransactions:doc.rows.filter(r=>r.source_note).length}))
}
const original=new Map(documents[0].rows.map(r=>[`${r.site_code}:${r.sale_id}`,r]))
let matches=0,changedIdentifiers=0,dateOrItemConflicts=0
for(const r of documents[1].rows){const before=original.get(`${r.site_code}:${r.sale_id}`);if(before){matches++;if(before.employee_identifier!==r.employee_identifier)changedIdentifiers++;if(before.log_date!==r.log_date||before.item!==r.item)dateOrItemConflicts++}}
console.log(JSON.stringify({exactSiteSaleMatches:matches,changedIdentifiers,dateOrItemConflicts,reviewedWithoutOriginal:documents[1].rows.length-matches}))
