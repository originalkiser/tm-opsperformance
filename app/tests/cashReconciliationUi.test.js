import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applicableCashCents, CASH_COUNT_LABEL, cashBusinessDate, cashCountError, fetchCashSetting, reconcileCash } from '../src/utils/cashReconciliation.js'

function renderCash(count, showExpected = true) {
  const source = readFileSync(new URL('../src/components/CashReconciliationSection.jsx', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const code = transformSync(source, { loader: 'jsx', format: 'cjs' }).code
  let hook = 0
  const useState = initial => [hook++ === 1 ? 'site|2026-10-13|stamp' : initial, () => {}]
  const mod = { exports: {} }
  new Function('module','exports','React','useState','useEffect','applicableCashCents','CASH_COUNT_LABEL','cashBusinessDate','cashCountError','fetchCashSetting','reconcileCash',code)(mod,mod.exports,React,useState,()=>{},applicableCashCents,CASH_COUNT_LABEL,cashBusinessDate,cashCountError,fetchCashSetting,reconcileCash)
  return renderToStaticMarkup(React.createElement(mod.exports.default, { showExpected, locationId: 'site', entryDate: '2026-10-13', entry: { updated_at: 'stamp', cash_on_hand_version_id: 1, cash_on_hand_cents: 85000, cash_edited_after_submission: true, cash_original_count: 969, cash_first_submitted_at: '2026-10-13T14:00:00Z' }, form: { yesterday_total_revenue: 119, yesterday_cc_revenue: 0, yesterday_house_revenue: 0, yesterday_cash_counted: count }, set:()=>{} }))
}

test('Managers hide expected cash while Admins retain it and reconciliation stays identical',()=>{
  assert.doesNotMatch(renderCash('969',false),/Expected Total Cash on Site/)
  assert.match(renderCash('969',true),/Expected Total Cash on Site/)
  assert.match(renderCash('969',false),/Reconciled/)
  assert.match(renderCash('968.99',false),/Shortage \$0\.01/)
})
test('cash UI shows exact green and red shortage/overage with one editable count only', () => {
  const green = renderCash('969'); assert.match(green,/Reconciled/); assert.match(green,/text-green-800 dark:text-green-300/)
  const short = renderCash('968.99'); assert.match(short,/Shortage \$0\.01/); assert.match(short,/text-red-800 dark:text-red-300/)
  assert.match(renderCash('969.01'),/Overage \$0\.01/)
  assert.match(short,/Edited After Submission/); assert.match(short,/Original submitted count:.*\$969\.00/)
  assert.equal((short.match(/<input/g)||[]).length,1)
  assert.match(short,/YESTERDAY TOTAL CASH COUNTED \(BEFORE DEPOSIT\) \(\$\)/)
  assert.match(short,/Discrepancies may be saved/)
  assert.match(renderCash(''),/Incomplete or invalid/)
})
test('Admin Cash on Hand panel renders no setting editor for Managers', () => {
  const source = readFileSync(new URL('../src/components/AdminCashOnHandPanel.jsx', import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  const code=transformSync(source,{loader:'jsx',format:'cjs'}).code; const mod={exports:{}}
  new Function('module','exports','React','useState','useEffect','useAuth',code)(mod,mod.exports,React,React.useState,()=>{},()=>({profile:{role:'store'}}))
  assert.equal(renderToStaticMarkup(React.createElement(mod.exports.default,{locations:[{id:'site',timezone:'America/Chicago'}]})),'')
})
