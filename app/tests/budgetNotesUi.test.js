import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { revenuePresentation } from '../src/utils/budgetRevenue.js'
import { displayMoney } from '../src/utils/budgetDisplay.js'

test('report Notes starts collapsed and retains provisional dates and historical context',()=>{
  const source=readFileSync(new URL('../src/components/BudgetRevenueNotes.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  const mod={exports:{}}
  new Function('module','exports','React','revenuePresentation','displayMoney',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,revenuePresentation,displayMoney)
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{revenue:{complete:false,recordedTotal:40,missingDates:['2026-10-01','2026-10-02']},historical:{amount:100,entryDate:'2026-10-03'},monthlyGoal:3100}))
  assert.match(html,/<summary[^>]*>Notes<\/summary>/);assert.doesNotMatch(html,/<details[^>]*open/)
  assert.match(html,/Provisional reported MTD through 2026-10-02/)
  assert.match(html,/2026-10-01, 2026-10-02/);assert.match(html,/does not drive pace/)
  assert.match(html,/Historical reported MTD/)
})
