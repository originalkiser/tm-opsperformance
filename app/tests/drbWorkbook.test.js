import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { readDrbWorkbook } from '../src/utils/drbWorkbook.js'
async function workbook(rows,extra={}) {
 const zip=new JSZip()
 zip.file('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" r:id="rId1"/></sheets></workbook>')
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData>'+rows+'</sheetData></worksheet>')
 for(const [path,value] of Object.entries(extra))zip.file(path,value)
 return zip.generateAsync({type:'uint8array'})
}
test('values-only XLSX preserves exact identifiers and converts numeric dates',async()=>{
 const bytes=await workbook('<row><c t="inlineStr"><is><t>LOGDATE</t></is></c><c t="inlineStr"><is><t>ID</t></is></c></row><row><c><v>46336</v></c><c t="inlineStr"><is><t>0012345678</t></is></c></row>')
 const rows=await readDrbWorkbook(bytes);assert.match(rows[1][0],/^2026-/);assert.equal(rows[1][1],'0012345678')
})
test('formulas and XML entities fail closed; unrelated comments are ignored',async()=>{
 await assert.rejects(readDrbWorkbook(await workbook('<row><c><f>1+1</f><v>2</v></c></row>')),/formulas/)
 await assert.rejects(readDrbWorkbook(await workbook('<!DOCTYPE sheet><row/>')),/Unsupported/)
 assert.deepEqual(await readDrbWorkbook(await workbook('<row/>',{'xl/comments1.xml':'<comments/>'})),[[]])
})
test('duplicate cell identities and oversized uploads rejected',async()=>{
 await assert.rejects(readDrbWorkbook(await workbook('<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row>')),/Duplicate/)
 await assert.rejects(readDrbWorkbook(new Uint8Array(10000001)),/10 MB/)
})
