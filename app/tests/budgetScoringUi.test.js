import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SCORE_LABELS, SCORE_WEIGHTS, scoreBudgetLocations } from '../src/utils/budgetScoring.js'

test('official numeric scores retain reporting completeness, dates, and zero-point reasons without provisional score previews',()=>{
  const source=readFileSync(new URL('../src/components/BudgetScoreDetails.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  const mod={exports:{}}
  new Function('module','exports','React','SCORE_LABELS','SCORE_WEIGHTS',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,SCORE_LABELS,SCORE_WEIGHTS)
  const rows=scoreBudgetLocations({locations:[{id:'a',name:'A',show_budget_tracking:true}]},'2026-10-13').rows
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{result:rows[0]}))
  assert.match(html,/Official score: 0.0 \/ 100 · Rank: 1/)
  assert.match(html,/Incomplete reporting/);assert.match(html,/Last entry: None this month/)
  assert.match(html,/2026-10-12/);assert.match(html,/Missing reporting dates/)
  assert.match(html,/Conversion target\/data unavailable/)
  assert.doesNotMatch(html,/Provisional preview|Unranked|Unavailable scores/)
  assert.doesNotMatch(html,/<details[^>]*open/)
  assert.equal(mod.exports.formatBudgetScore(rows[0]),'0.0')
  assert.equal(mod.exports.formatBudgetScore(null),'—')
})
