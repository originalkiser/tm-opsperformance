import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applicableCashCents, CASH_COUNT_LABEL, cashBusinessDate, cashCountError, fetchCashSetting, reconcileCash } from '../src/utils/cashReconciliation.js'

function renderCash(count, showExpected = true, attemptedSave = false, submitted = true) {
  const source = readFileSync(new URL('../src/components/CashReconciliationSection.jsx', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const code = transformSync(source, { loader: 'jsx', format: 'cjs' }).code
  let hook = 0
  const useState = initial => [hook++ === 1 ? 'site|2026-10-13|stamp' : initial, () => {}]
  const mod = { exports: {} }
  new Function('module','exports','React','useState','useEffect','applicableCashCents','CASH_COUNT_LABEL','cashBusinessDate','cashCountError','fetchCashSetting','reconcileCash',code)(mod,mod.exports,React,useState,()=>{},applicableCashCents,CASH_COUNT_LABEL,cashBusinessDate,cashCountError,fetchCashSetting,reconcileCash)
  return renderToStaticMarkup(React.createElement(mod.exports.default, { attemptedSave, showExpected, locationId: 'site', entryDate: '2026-10-13', entry: { updated_at: 'stamp', cash_on_hand_version_id: 1, cash_on_hand_cents: 85000, cash_edited_after_submission: true, cash_original_count: submitted ? 969 : null, cash_first_submitted_at: submitted ? '2026-10-13T14:00:00Z' : null }, form: { yesterday_total_revenue: 119, yesterday_cc_revenue: 0, yesterday_house_revenue: 0, yesterday_cash_counted: count }, set:()=>{} }))
}

test('Managers hide expected cash while Admins retain it and reconciliation stays identical',()=>{
  assert.doesNotMatch(renderCash('969',false),/Expected Total Cash on Site|Admin Cash on Hand/)
  assert.match(renderCash('969',true),/Admin Cash on Hand/)
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
  assert.match(short,/TOTAL CASH ONSITE \(Before Deposit\) \(\$\)/)
  assert(short.indexOf('TOTAL CASH ONSITE') < short.indexOf('Calculated Cash Revenue'))
  assert.match(short,/required="" aria-required="true"/)
  assert.match(renderCash('',true,true),/Enter TOTAL CASH ONSITE/)
  assert.match(short,/Discrepancies may be saved/)
  assert.match(renderCash(''),/Incomplete or invalid/)
})
test('Admin Cash on Hand panel renders no setting editor for Managers', () => {
  const source = readFileSync(new URL('../src/components/AdminCashOnHandPanel.jsx', import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  const code=transformSync(source,{loader:'jsx',format:'cjs'}).code; const mod={exports:{}}
  new Function('module','exports','React','useState','useEffect','useAuth',code)(mod,mod.exports,React,React.useState,()=>{},()=>({profile:{role:'store'}}))
  assert.equal(renderToStaticMarkup(React.createElement(mod.exports.default,{locations:[{id:'site',timezone:'America/Chicago'}]})),'')
})

for (const role of ['Store', 'Manager']) {
  test(`${role}: hides both Admin values before and after submission with both cash results gated on the saved count`, () => {
    for (const submitted of [false, true]) {
      const html = renderCash('969', false, false, submitted)
      assert.doesNotMatch(html, /Admin Cash on Hand|Expected Total Cash on Site/)
      if (submitted) assert.match(html, /Cash Available for Deposit: <strong>\$119\.00<\/strong>/)
      else assert.doesNotMatch(html, /Cash Available for Deposit|Cash Variance/)
      assert.match(html, /Calculated Cash Revenue/)
      assert.match(html, /required="" aria-required="true"/)
      assert.match(html, /bg-gray-50 dark:bg-tm-dark-card/)
      assert.match(html, /bg-white dark:bg-tm-dark-surface/)
      assert.match(html, /Cash audit history/)
    }
  })
  test(`${role}: typed or invalid unsaved count cannot reveal deposit or variance until first saved count`, () => {
    for (const count of ['', '969', '968.99', '969.01', '-1']) {
      const html = renderCash(count, false, false, false)
      assert.doesNotMatch(html, /Cash Variance|Reconciled<|Shortage|Overage/)
      assert.doesNotMatch(html, /Cash Available for Deposit/)
    }
    assert.match(renderCash('969', false, false, true), /Cash Variance:.*Reconciled/)
    assert.match(renderCash('968.99', false, false, true), /Shortage \$0\.01/)
    assert.match(renderCash('969.01', false, false, true), /Overage \$0\.01/)
    assert.match(renderCash('', false, false, true), /Cash Variance:.*Incomplete or invalid/)
  })
}
test('Admin retains Cash on Hand, Expected Total, deposit and variance preview/reporting', () => {
  for (const submitted of [false, true]) {
    const html = renderCash('969', true, false, submitted)
    assert.match(html, /Admin Cash on Hand<\/div><strong>\$850\.00/)
    assert.match(html, /Expected Total Cash on Site<\/div><strong>\$969\.00/)
    assert.match(html, /Cash Available for Deposit: <strong>\$119\.00/)
    assert.match(html, /Cash Variance:.*Reconciled/)
  }
})
