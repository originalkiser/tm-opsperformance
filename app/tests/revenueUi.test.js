import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync, transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('provisional summary renders the dated amount and keeps details collapsed',()=>{
 const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/components/BudgetRevenueSummary.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text
 const mod={exports:{}};new Function('module','exports','React',code)(mod,mod.exports,React)
 const html=renderToStaticMarkup(React.createElement(mod.exports.default,{revenue:{complete:false,total:null,recordedTotal:100,missingDates:['2026-10-11'],throughDate:'2026-10-11'},historical:{amount:2000,entryDate:'2026-10-04'}}))
 assert.match(html,/Provisional reported MTD/);assert.match(html,/\$2,000\.00/);assert.match(html,/2026-10-03/)
 assert.match(html,/<details><summary/);assert.doesNotMatch(html,/<details[^>]*open/)
 assert.match(html,/dark:text-gray-100/);assert.match(html,/never added to daily subtotals/)
})
test('standalone panel exposes no unrelated daily fields and renders nothing for Managers',()=>{
 const source=readFileSync(new URL('../src/components/AdminStartingBalancePanel.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
 const code=transformSync(source,{loader:'jsx',format:'cjs'}).code
 const render=role=>{const mod={exports:{}};new Function('module','exports','React','useEffect','useRef','useState','useAuth',code)(mod,mod.exports,React,React.useEffect,React.useRef,React.useState,()=>({profile:{role}}));return renderToStaticMarkup(React.createElement(mod.exports.default,{locations:[{id:'site',name:'Site'}]}))}
 const admin=render('admin');assert.match(admin,/No daily-entry fields are required/);assert.match(admin,/Starting balance location/)
 assert.doesNotMatch(admin,/Yesterday Washes|CURRENT RATING|CREDIT CARD REVENUE/)
 assert.equal(render('store'),'')
})
