import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { displayMoney } from '../src/utils/budgetDisplay.js'
import { varianceLabel } from '../src/utils/budgetReportFormatting.js'
import { REPORT_STATUS_CLS } from '../src/utils/metricColors.js'

test('cash cell renders signed saved variances, accessible status text and light/dark colors',()=>{
  const source=readFileSync(new URL('../src/components/BudgetCashCell.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  const mod={exports:{}}
  new Function('module','exports','React','displayMoney','varianceLabel','REPORT_STATUS_CLS',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,displayMoney,varianceLabel,REPORT_STATUS_CLS)
  const render=cash=>renderToStaticMarkup(React.createElement(mod.exports.default,{cash}))
  const short=render({amount:119,variance:-100,status:'red',note:'Shortage'});assert.match(short,/\$119.00 \(-\$1.00\)/);assert.match(short,/Shortage/);assert.match(short,/dark:text-red-400/)
  assert.match(render({amount:119,variance:100,status:'red',note:'Overage'}),/\(\+\$1.00\)/)
  const exact=render({amount:119,variance:0,status:'green',note:'Reconciled'});assert.match(exact,/dark:text-green-300/);assert.doesNotMatch(exact,/\(\+?\$0.00\)/)
  const missing=render({amount:119,variance:null,status:'neutral',note:'Reconciliation unavailable'});assert.match(missing,/dark:text-gray-300/);assert.doesNotMatch(missing,/text-green/);assert.match(missing,/unavailable/)
})
