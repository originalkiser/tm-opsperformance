import { kpiTableBindings } from './helpers/kpiTableBindings.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { businessToday, currentMtdRange, loadPerformanceLogs, selectTodayPerformance } from '../src/utils/dashboardPerformance.js'
import * as helpers from '../src/utils/insightsHelpers.js'
import * as colors from '../src/utils/metricColors.js'
import { netMembersCls } from '../src/utils/netMemberColors.js'
import { compareNetMembers } from '../src/utils/dashboardNetMembers.js'
import { fmtNum } from '../src/utils/format.js'

const sites = [{ id:'east', name:'Fictional East', timezone:'America/New_York', opportunities_formula:'simple', metric_thresholds:{conv_red:20,conv_yellow:30,pmix_green:90} }, {id:'west',name:'Fictional West',timezone:'America/Los_Angeles'}]
const now = new Date('2026-10-16T05:00:00Z')
const row = (extra={}) => ({location_id:'east',log_date:'2026-10-16',time_slot:'10:00',total_washes:100,member_washes:50,basic:5,good:0,better:3,best:2,google_reviews:2,updated_at:'2026-10-16T04:30:00Z',...extra})

test('today selects each site business day, last cumulative split, and configured opportunities without overlap',()=>{
 const result=selectTodayPerformance([row({time_slot:'09:00',total_washes:60}),row(),row({split_index:1,total_washes:120}),row({time_slot:'11:00',total_washes:0,member_washes:0,basic:0,better:0,best:0,google_reviews:0}),row({log_date:'2026-10-15',total_washes:999}),row({location_id:'west',log_date:'2026-10-15',total_washes:80})],sites,now)
 assert.equal(result.totals.length,2)
 assert.equal(result.totals[0].total_washes,120)
 assert.equal(result.totals[0].memberships_sold,10)
 assert.equal(result.totals[0].opportunities,70)
 assert.equal(result.totals[1].opportunities,40)
 assert.equal(result.statuses.west.date,'2026-10-15')
 assert.equal(result.statuses.east.updatedAt,'2026-10-16T04:30:00Z')
})

test('zero member washes remain valid, untouched locations are missing, authored zero is valid',()=>{
 const source=selectTodayPerformance([row({member_washes:0})],sites,now)
 assert.equal(source.totals[0].total_washes,100)
 assert.equal(source.totals[0].opportunities,100)
 assert.equal(source.statuses.west.updatedAt,undefined)
 const zero=row({employee_name:'Fictional',total_washes:0,member_washes:0,basic:0,better:0,best:0,google_reviews:0})
 assert.equal(selectTodayPerformance([zero],sites,now).totals.length,1)
 assert.equal(selectTodayPerformance([{...zero,employee_name:''}],sites,now).totals.length,0)
})

test('business days and current MTD roll over at site-local midnight including month/year boundary',()=>{
 assert.equal(businessToday(sites[0],now),'2026-10-16')
 assert.equal(businessToday(sites[1],now),'2026-10-15')
 assert.deepEqual(currentMtdRange(sites,new Date('2027-01-01T05:30:00Z')),{start:'2026-12-01',end:'2026-12-31'})
 assert.deepEqual(currentMtdRange(sites,new Date('2027-01-01T09:00:00Z')),{start:'2027-01-01',end:'2027-01-01'})
})

test('daily queries page all company IDs, stay read-only, and reject incomplete failed loads',async()=>{
 let pages=0
 const calls=[]
 const client={from(table){assert.equal(table,'daily_logs');const q={select(){return q},in(k,ids){calls.push(ids);return q},gte(){return q},lte(){return q},order(){return q},async range(start,end){assert.equal(end-start,999);pages++;return {data:start===0?Array.from({length:1000},()=>row()):[row()]}}};return q}}
 assert.equal((await loadPerformanceLogs(client,sites,{start:'2026-10-15',end:'2026-10-16'})).length,1001)
 assert.equal(pages,2);assert.deepEqual(calls[0],['east','west'])
 const bad={from(){const q={select(){return q},in(){return q},gte(){return q},lte(){return q},order(){return q},range(){return {error:{message:'denied'}}}};return q}}
 await assert.rejects(loadPerformanceLogs(bad,sites,{}),/could not be loaded/)
})

function tableModule(useState=React.useState){
 const text=readFileSync(new URL('../src/components/SiteMetricTable.jsx',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'')
 const module={exports:{}}
 const deps={React,useState,...kpiTableBindings(useState === React.useState ? undefined : useState()[0]),...helpers,...colors,netMembersCls,compareNetMembers,fmtNum,BudgetSourceNote:()=>null,ExportMenu:()=>null,fmtDateRange:()=> 'October'}
 new Function('module','exports',...Object.keys(deps),transformSync(text,{loader:'jsx',format:'cjs'}).code)(module,module.exports,...Object.values(deps))
 return module.exports
}

test('shared daily table lists unreported company sites, timestamps, thresholds, sortable accessible headers and mobile overflow',()=>{
 const source=selectTodayPerformance([row()],sites,now)
 const Table=tableModule().PerformanceTable
 const html=renderToStaticMarkup(React.createElement(Table,{source,locations:sites,dateRange:{},title:"Today's Performance",daily:true}))
 assert.match(html,/Fictional West/);assert.match(html,/No Update Yet/);assert.match(html,/Last Updated/)
 assert.match(html,/2026-10-16/);assert.match(html,/2026-10-15/)
 assert.match(html,/bg-yellow-100/,'site-specific conversion threshold applied')
 assert.match(html,/overflow-x-auto/);assert.match(html,/min-w-\[800px\]/)
 assert.match(html,/aria-sort="descending"/);assert.match(html,/<button[^>]*>Location/)
 assert.match(html,/Provisional subtotal/)
})

test('sorting uses selected numeric column and direction',()=>{
 const source=selectTodayPerformance([row(),row({location_id:'west',log_date:'2026-10-15',total_washes:200})],sites,now)
 const Table=tableModule(()=>[{col:'tw',dir:'desc'},()=>{}]).PerformanceTable
 const html=renderToStaticMarkup(React.createElement(Table,{source,locations:sites,dateRange:{}}))
 assert(html.indexOf('Fictional West')<html.indexOf('Fictional East'))
})

test('company reporting is Store-only and never replaces assigned entry or other-section scope', () => {
 const insights=readFileSync(new URL('../src/pages/Insights.jsx',import.meta.url),'utf8')
 assert.match(insights, /companyRead = profile\?\.role === 'store'/)
 assert.match(insights, /reportingLocations = companyRead \? companyLocations : locations/)
 assert.match(insights, /<DashboardPerformance locations=\{performanceLocations\} daily/)
 assert.match(insights, /<DashboardPerformance locations=\{performanceLocations\} companyRead=\{companyRead\}/)
 assert.match(insights, /tm_reporting_market_filter/)
 const auth=readFileSync(new URL('../src/contexts/AuthContext.jsx',import.meta.url),'utf8')
 assert.doesNotMatch(auth, /loadCompanyReportingLocations|companyLocations|dashboard_mtd_performance/)
 const access=readFileSync(new URL('../src/utils/locationAccess.js',import.meta.url),'utf8')
 assert.match(access, /profile\.role === 'area_manager'/)
 assert.doesNotMatch(access, /loadCompanyReportingLocations|companyLocations|dashboard_mtd_performance/)
 const entry=readFileSync(new URL('../src/pages/Dashboard.jsx',import.meta.url),'utf8')
 assert.doesNotMatch(entry, /tm_reporting_market_filter|companyLocations/)
})

test('reporting status uses latest genuine timestamp and never substitutes fetch time', () => {
 const source = selectTodayPerformance([row({ updated_at: 'invalid' }), row({ time_slot: '09:00', updated_at: '2026-10-16T04:55:00Z' })], sites, now)
 assert.equal(source.statuses.east.updatedAt, '2026-10-16T04:55:00Z')
 const Table = tableModule().PerformanceTable
 const html = renderToStaticMarkup(React.createElement(Table, { source, locations: sites, dateRange: {}, daily: true }))
 const westCell = html.split('Fictional West')[1].split('</td>')[0]
 assert.match(westCell, /No Update Yet/)
 assert.doesNotMatch(westCell, /Last Updated/)
 const invalid = selectTodayPerformance([row({ updated_at: 'invalid' })], sites, now)
 assert.equal(invalid.statuses.east.updatedAt, undefined)
 const unknownHtml = renderToStaticMarkup(React.createElement(Table, { source: invalid, locations: sites, dateRange: {}, daily: true }))
 assert.match(unknownHtml, /Last Updated: Unavailable/)
 assert.doesNotMatch(unknownHtml, /Invalid Date/)
})

test('company Today and MTD presentations retain all four reporting locations including no-data D', () => {
 const company = [...sites, {id:'third',name:'Fictional Third',timezone:'America/New_York'}, {id:'empty',name:'Fictional Empty',timezone:'America/New_York'}]
 const Table = tableModule().PerformanceTable
 const source = selectTodayPerformance([row()], company, now)
 for (const daily of [true, false]) {
  const html = renderToStaticMarkup(React.createElement(Table, { source, locations:company, dateRange:{}, daily }))
  for (const site of company) assert(html.includes(site.name))
  assert.match(html, daily ? /No Update Yet/ : /MTD unavailable/)
 }
})

test('Dashboard Net Members column sorts signed values, keeps unknown last and colors both tables', () => {
 const company=[{id:'positive',name:'Positive'},{id:'missing',name:'Unknown'},{id:'negative',name:'Negative'},{id:'zero',name:'Zero'}]
 const netMembers={positive:{value:4},missing:{value:null},negative:{value:-3},zero:{value:0}}
 for(const daily of [true,false]) {
  for(const dir of ['asc','desc']) {
   const Table=tableModule(()=>[{col:'nm',dir},()=>{}]).PerformanceTable
   const html=renderToStaticMarkup(React.createElement(Table,{source:{totals:[],notes:[],active:false},locations:company,dateRange:{},netMembers,daily}))
   assert.match(html,/>Net Members</)
   assert.match(html,/bg-red-100/);assert.match(html,/bg-yellow-100/);assert.match(html,/bg-green-100/)
   assert.match(html,/Net Members subtotal excludes unavailable/)
   assert.match(html,/overflow-x-auto/)
   const expected=dir==='asc'?['Negative','Zero','Positive','Unknown']:['Positive','Zero','Negative','Unknown']
   for(let i=0;i<expected.length-1;i++) assert(html.indexOf(expected[i])<html.indexOf(expected[i+1]))
  }
 }
})

test('daily and MTD tables show supporting dates with zero values, colors, and export dates', () => {
 const Table=tableModule().PerformanceTable
 for(const daily of [true,false]) {
  const html=renderToStaticMarkup(React.createElement(Table,{source:{totals:[],notes:[],active:false},locations:[sites[0]],dateRange:{},daily,
   netMembers:{east:{value:0,through:'2026-10-21',message:'Supported through Oct 21'}}}))
  assert.match(html,/Last entry: Oct 21, 2026/)
  assert.match(html,/bg-yellow-100/)
  assert.match(html,/>0<div/)
 }
})
