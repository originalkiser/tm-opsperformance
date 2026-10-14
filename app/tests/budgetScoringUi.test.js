import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SCORE_LABELS, SCORE_WEIGHTS } from '../src/utils/budgetScoring.js'

test('score details distinguish official scores from unnormalized provisional previews and expose completeness',()=>{
  const source=readFileSync(new URL('../src/components/BudgetScoreDetails.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
  const mod={exports:{}}
  new Function('module','exports','React','SCORE_LABELS','SCORE_WEIGHTS',transformSync(source,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,React,SCORE_LABELS,SCORE_WEIGHTS)
  const result={score:null,previewPoints:32.5,availableWeight:55,businessDate:'2026-10-12',reportingDate:'2026-10-13',components:{conversion:12.5,pmix:10,growth:0,rating:10},issues:['Revenue incomplete'],completeness:{scoredCategories:4,entryPresent:true,mtdCountsValid:true,revenueComplete:false,missingRevenueDates:['2026-10-11']}}
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{result}))
  assert.match(html,/Provisional preview: 32.5 \/ 55 available points/);assert.match(html,/Unranked · no official score or rank/)
  assert.match(html,/not scaled to 100/);assert.match(html,/2026-10-11/);assert.match(html,/revenue incomplete/)
  assert.doesNotMatch(html,/<details[^>]*open/)
  const official=renderToStaticMarkup(React.createElement(mod.exports.default,{result:{...result,score:80,issues:[]}}))
  assert.match(official,/80.0/);assert.doesNotMatch(official,/Provisional preview/)
})
