import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as columns from '../../src/utils/performanceColumns.js'
import * as helpers from '../../src/utils/insightsHelpers.js'
import * as colors from '../../src/utils/metricColors.js'
import * as display from '../../src/utils/budgetDisplay.js'
import { netMembersCls } from '../../src/utils/netMemberColors.js'
import { fmtNum } from '../../src/utils/format.js'
import { pct1 } from '../../src/utils/budgetMath.js'
import { SCORE_LABELS, SCORE_WEIGHTS } from '../../src/utils/budgetScoring.js'

export function memoryStorage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const source = path => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
function compile(text, bindings) {
  const mod = { exports: {} }
  new Function('module','exports',...Object.keys(bindings),transformSync(text,{loader:'jsx',format:'cjs'}).code)(mod,mod.exports,...Object.values(bindings))
  return mod.exports
}
export function kpiCustomizationHarness(props, storage = memoryStorage(), userId = 'user-a') {
  const hooks=[];let cursor, currentProps=props, currentUser=userId
  const useState = initial => {
    const index=cursor++
    if (!(index in hooks)) hooks[index]=typeof initial==='function'?initial():initial
    return [hooks[index], value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value}]
  }
  const Controls=compile(source('components/KpiTableControls.jsx'),{React,useState:React.useState,...columns}).default
  const Menu=()=>null
  const details=compile(source('components/BudgetScoreDetails.jsx'),{React,SCORE_LABELS,SCORE_WEIGHTS})
  const exports=[]
  const bindings={React,useState,window:{localStorage:storage},...columns,...helpers,...colors,...display,pct1,fmtNum,netMembersCls,
    useAuth:()=>({user:currentUser?{id:currentUser}:null}),KpiTableControls:Controls,ExportMenu:Menu,
    BudgetSourceNote:()=>null,BudgetScoreDetails:details.default,formatBudgetScore:details.formatBudgetScore,fmtDateRange:()=> 'October',
    exportCsv:spec=>exports.push({format:'csv',spec}),exportPdf:spec=>exports.push({format:'pdf',spec}),exportXlsx:spec=>exports.push({format:'xlsx',spec})}
  const hook=source('hooks/useKpiTablePreferences.js').replace('export default function','function')
  const mod=compile(hook+'\n'+source('components/SiteMetricTable.jsx'),bindings)
  const render=()=>{cursor=0;return mod.PerformanceTable(currentProps)}
  const nodes=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)]
  return {storage,exports,Controls,render,html:()=>renderToStaticMarkup(render()),
    find:predicate=>nodes(render()).find(predicate),all:predicate=>nodes(render()).filter(predicate),
    controls:()=>nodes(render()).find(n=>n.type===Controls).props,
    menu:()=>nodes(render()).find(n=>n.type===Menu).props.items,
    props(next){currentProps=next;return render()},user(id){currentUser=id;return render()},
  }
}
