import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as metrics from '../src/utils/budgetMath.js'
import * as fields from '../src/utils/budgetDailyFields.js'
const Null=()=>null
function render(name,component,location, { blank = false, attemptedSave = false } = {}){
 const row={...Object.fromEntries(Object.keys(fields.emptyDailyForm()).map(k=>[k,0])),yesterday_washes:100,yesterday_redemptions:60,yesterday_wash_overrides:10,yesterday_best:6,mtd_washes:1000,mtd_redemptions:600,mtd_wash_overrides:100,mtd_best:60}
 if (blank) for (const key of Object.keys(row)) row[key] = ''
 const bindings={React,useState:React.useState,useEffect:React.useEffect,...metrics,...fields,
 useAuth:()=>({profile:{role:'admin'}}),useBudgetDailyEntry:(id,date,onSaved,site)=>{assert.equal(id,location.id);assert.equal(site,location);return {form:row,entry:row,target:null,dailyGoals:[],set:()=>{},handleSave:()=>{},missing:0,attemptedSave,mtdRevenue:{},historicalRevenue:null}},
 reportedRevenuePace:()=>({pct:null,onTrack:null,reported:{}}),displayCount:x=>String(x??''),BudgetRevenueSummary:Null,BudgetRevenueFields:Null,CashReconciliationSection:Null,TmLoader:Null}
 const source=readFileSync(new URL(`../src/components/${name}.jsx`,import.meta.url),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm,'')+`\nexport { ${component} };`
 const module={exports:{}};new Function('module','exports',...Object.keys(bindings),transformSync(source,{loader:'jsx',format:'cjs'}).code)(module,module.exports,...Object.values(bindings))
 return renderToStaticMarkup(React.createElement(module.exports[component],{location,locations:[location],profile:{location_id:location.id,role:'admin'}}))
}
for(const [file,component] of [['BudgetTrackingSection','DailyEntryTab'],['BudgetTrackingReport','DailyEntryPane']])test(`${file}: both override inputs follow Redemptions only at Detailed sites`,()=>{
 const detailed=render(file,component,{id:'fictional',name:'Fictional',opportunities_formula:'detailed'})
 const names=Array.from(detailed.matchAll(/aria-label="([^"]+)"/g),m=>m[1])
 for(const period of ['Yesterday','MTD']){const index=names.indexOf(`${period} Redemptions`);assert(index>=0);assert.equal(names[index+1],`${period} Wash Overrides`)}
 assert.match(detailed,/min="0"[^>]*aria-label="Yesterday Wash Overrides"/)
 const simple=render(file,component,{id:'fictional',name:'Fictional',opportunities_formula:'simple'});assert.doesNotMatch(simple,/Wash Overrides/)
 if(file==='BudgetTrackingSection'){assert.match(detailed,/20\.0%/);assert.match(simple,/15\.0%/)}
})

for (const [file, component] of [['BudgetTrackingSection', 'DailyEntryTab'], ['BudgetTrackingReport', 'DailyEntryPane']]) {
  test(`${file}: override input classes exactly match neighboring counts in filled, blank and attempted-save states`, () => {
    for (const state of [{}, { blank: true }, { blank: true, attemptedSave: true }]) {
      const html = render(file, component, { id: 'fictional', name: 'Fictional', opportunities_formula: 'detailed' }, state)
      const inputs = new Map(Array.from(html.matchAll(/<input\b[^>]*aria-label="([^"]+)"[^>]*class="([^"]+)"[^>]*>/g), match => [match[1], match[2]]))
      for (const period of ['Yesterday', 'MTD']) {
        const overrides = inputs.get(`${period} Wash Overrides`)
        assert(overrides)
        for (const field of ['Washes', 'Redemptions', 'Basic', 'Good', 'Better', 'Best']) assert.equal(overrides, inputs.get(`${period} ${field}`))
        for (const token of ['bg-white', 'dark:bg-tm-dark-surface', 'focus:outline-none', 'focus:ring-2', 'rounded-lg', 'border-2']) assert(overrides.split(' ').includes(token), token)
        if (!state.blank) assert(overrides.includes('dark:border-tm-dark-border'))
        else assert(overrides.includes(state.attemptedSave ? 'border-red-500' : 'border-orange-400'))
      }
    }
  })
}
