import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { revenueCents } from '../src/utils/budgetRevenue.js'

function editor({ reviewed = true, correction = false, approved = false, note = 'Verified ledger correction' } = {}) {
  const source = readFileSync(new URL('../src/components/AdminCashOnHandPanel.jsx', import.meta.url), 'utf8').replace(/^import .*\n/gm,'')
  const code = transformSync(source,{loader:'jsx',format:'cjs'}).code
  const state = ['site','850','2026-09-01',note,[],'site',false,'',true,'',reviewed ? { locationId:'site',effectiveDate:'2026-09-01',token:'review',active_id:1,active_cents:80000,next_date:'2026-10-01',saved_count:2,saved_business_dates:['2026-09-02','2026-09-03'],requires_correction:correction } : null,approved]
  let i=0; const mod={exports:{}}
  new Function('module','exports','React','useState','useEffect','useAuth','revenueCents',code)(mod,mod.exports,React,()=>[state[i++],()=>{}],()=>{},()=>({profile:{role:'admin'}}),revenueCents)
  return renderToStaticMarkup(React.createElement(mod.exports.default,{locations:[{id:'site',name:'Fictional Wash'}]}))
}
test('historical calendar has no minimum date; review shows interval and frozen saved entries',()=>{
  const html=editor()
  assert.match(html,/type="date"[^>]*value="2026-09-01"/)
  assert.doesNotMatch(html,/type="date"[^>]*min=/)
  assert.match(html,/until the next setting on 2026-10-01/)
  assert.match(html,/2 previously submitted cash entries/)
  assert.match(html,/2026-09-02, 2026-09-03/)
})
test('correction requires explicit confirmation, explanation and completed review',()=>{
  const disabled=html=> /<button[^>]*disabled=""/.test(html)
  assert.equal(disabled(editor({correction:true})),true)
  assert.equal(disabled(editor({correction:true,approved:true,note:'Short'})),true)
  assert.equal(disabled(editor({reviewed:false})),true)
  assert.equal(disabled(editor({correction:true,approved:true})),false)
  assert.match(editor({correction:true}),/authorize this audited setting correction/)
  assert.match(editor({correction:true}),/existing reconciliations are not recalculated/)
})
