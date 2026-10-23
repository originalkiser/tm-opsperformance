import * as columnUtilities from '../src/utils/performanceColumns.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { kpiCustomizationHarness, memoryStorage } from './helpers/kpiCustomizationHarness.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { normalizePreferences, preferenceKey } from '../src/utils/performanceColumns.js'
import { buildBudgetReportRows } from '../src/utils/budgetReportRows.js'
import { budgetPerformanceRow } from '../src/utils/budgetPerformanceSource.js'

const locations=[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Empty'}]
const props={locations,dateRange:{start:'2026-10-01',end:'2026-10-23'},daily:true,source:{active:false,notes:[],totals:[
 {location_id:'a',total_washes:100,member_washes:50,memberships_sold:10,opportunities:50,better:3,best:2,google_reviews:0},
 {location_id:'b',total_washes:200,member_washes:100,memberships_sold:50,opportunities:100,better:10,best:0,google_reviews:2},
 ]},netMembers:{a:{value:0,through:'2026-10-21'},b:{value:-3,through:'2026-10-20'},c:{value:null}}}
const cells=row=>React.Children.toArray(row.props.children).filter(c=>c.type==='td')
const headerKeys=h=>h.all(n=>n.type==='th').map(n=>n.props['data-column'])
const bodyRows=h=>h.all(n=>n.type==='tr').slice(1)
const text=node=>node==null?'':typeof node!=='object'?String(node):React.Children.toArray(node.props?.children).map(text).join('')
const update=(h,change)=>h.controls().update(change)
const clickSort=(h,label)=>h.find(n=>n.type==='button' && n.props.children?.[0]===label).props.onClick()

test('reorder/hide keeps headers, cells, totals, dates and visible exports aligned; full exports retain all data',()=>{
 const h=kpiCustomizationHarness(props)
 update(h,c=>({...c,order:['name','nm',...c.order.filter(k=>!['name','nm'].includes(k))],hidden:['mw','gr']}))
 const keys=headerKeys(h)
 assert.deepEqual(keys,['name','nm','tw','ms','opp','p_mix','conversion'])
 for(const row of bodyRows(h))assert.deepEqual(cells(row).map(c=>c.props['data-column']),keys)
 assert.match(h.html(),/Last entry: Oct 21, 2026/)
 for(const [index,format] of [[3,'xlsx'],[4,'pdf'],[5,'csv']]){
  h.menu()[index].run();const exported=h.exports.at(-1)
  assert.equal(exported.format,format)
  const spec=exported.spec
  assert.deepEqual(spec.columns.map(c=>c.label),['Location','Net Members','Net Members through','Total Washes','Memberships Sold','Opportunities','P-Mix','Conversion'])
  assert.ok(spec.rows.every(r=>r.length===spec.columns.length));assert.equal(spec.totalsRow.length,spec.columns.length)
  const a=spec.rows.find(r=>r[0]==='Alpha');assert.deepEqual(a.slice(1,4),[0,'2026-10-21',100])
 }
 h.menu()[2].run();const full=h.exports.at(-1).spec
 assert.equal(full.columns.length,10);assert.equal(full.rows.length,3)
 assert.equal(full.columns[2].label,'Member Washes');assert.equal(full.rows.at(-1)[1],'','missing washes stay empty in export')
})

test('filters produce weighted subtotals and separate full-data totals, zero Net Members remains yellow',()=>{
 const h=kpiCustomizationHarness(props)
 update(h,c=>({...c,filters:{name:{op:'equals',value:'Alpha'}}}))
 const rows=bodyRows(h)
 assert.equal(rows.length,3)
 assert.match(text(rows[0]),/^Alpha/)
 assert.match(text(rows[1]),/^Filtered subtotal/);assert.match(text(rows[2]),/^Full-data provisional subtotal/)
 assert.equal(text(cells(rows[1])[1]),'100');assert.equal(text(cells(rows[2])[1]),'300')
 assert.equal(text(cells(rows[1])[7]),'20.0%');assert.equal(text(cells(rows[2])[7]),'40.0%')
 assert.match(h.html(),/Companywide ranks are unchanged/);assert.match(h.html(),/bg-yellow-100/)
 h.menu()[5].run();const visible=h.exports.at(-1).spec
 assert.equal(visible.rows.length,1);assert.equal(visible.totalsRow[0],'Filtered subtotal');assert.equal(visible.totalsRow[1],100)
 assert.match(visible.subtitle,/Filtered: 1 of 3 locations/)
 h.menu()[2].run();assert.equal(h.exports.at(-1).spec.totalsRow[1],300)
})

test('zero filters exclude missing values, invalid criteria are inactive, hiding clears a filter, and empty results have aligned totals',()=>{
 const h=kpiCustomizationHarness(props)
 update(h,c=>({...c,filters:{nm:{op:'eq',value:'0'}}}))
 assert.equal(bodyRows(h).length,3);assert.match(text(bodyRows(h)[0]),/^Alpha/)
 update(h,c=>({...c,filters:{tw:{op:'eq',value:'0'}}}))
 assert.match(h.html(),/No locations match the column filters/)
 assert.equal(h.find(n=>n.type==='td' && n.props.colSpan).props.colSpan,headerKeys(h).length)
 update(h,c=>({...c,filters:{nm:{op:'eq',value:'invalid'}}}))
 assert.equal(bodyRows(h).length,4)
 update(h,c=>({...c,filters:{nm:{op:'eq',value:'0'}},hidden:['nm']}))
 assert.deepEqual(h.controls().config.filters,{})
 assert.equal(bodyRows(h).length,4)
})

test('clickable headers toggle sorting, keep missing last, and sorting survives filtering/customization',()=>{
 const h=kpiCustomizationHarness(props)
 clickSort(h,'Net Members') // New column: descending.
 assert.equal(h.find(n=>n.type==='th' && n.props['data-column']==='nm').props['aria-sort'],'descending')
 assert.deepEqual(bodyRows(h).slice(0,3).map(r=>cells(r)[0].props.children[0]),['Alpha','Beta','Empty'])
 clickSort(h,'Net Members')
 assert.deepEqual(bodyRows(h).slice(0,3).map(r=>cells(r)[0].props.children[0]),['Beta','Alpha','Empty'])
 update(h,c=>({...c,hidden:['nm'],filters:{name:{op:'contains',value:'a'}}}))
 assert.match(h.html(),/Sorted by Net Members \(ascending; hidden column\)/)
 assert.match(text(bodyRows(h)[0]),/^Beta/)
})

test('real preference hook isolates all three tables/accounts, persists filters/order/sort and resets all defaults',()=>{
 const storage=memoryStorage(),h=kpiCustomizationHarness(props,storage,'alice')
 update(h,c=>({...c,hidden:['tw'],filters:{nm:{op:'eq',value:'0'}},sort:{col:'name',dir:'asc'}}))
 const reopened=kpiCustomizationHarness(props,storage,'alice')
 assert.deepEqual(reopened.controls().config,h.controls().config)
 for(const tableProps of [{...props,daily:false,title:'MTD Performance'},{...props,daily:false,title:'Site Performance'}]){
  h.props(tableProps);assert.deepEqual(h.controls().config.hidden,[])
  update(h,c=>({...c,hidden:['mw']}))
 }
 h.props(props);assert.deepEqual(h.controls().config.hidden,['tw'])
 h.user('bob');assert.deepEqual(h.controls().config.hidden,[])
 update(h,c=>({...c,hidden:['gr']}))
 h.user('alice');assert.deepEqual(h.controls().config.hidden,['tw'])
 h.controls().reset();assert.deepEqual(h.controls().config,normalizePreferences(null))
 assert.deepEqual(JSON.parse(storage.getItem(preferenceKey('dashboard-today','alice'))),normalizePreferences(null))
 h.user('bob');assert.deepEqual(h.controls().config.hidden,['gr'])
})

test('blocked or corrupt storage cannot break the table; settings remain usable in this session',()=>{
 const blocked={getItem(){throw Error('denied')},setItem(){throw Error('denied')}}
 const h=kpiCustomizationHarness(props,blocked)
 update(h,c=>({...c,hidden:['tw']}))
 assert.ok(!headerKeys(h).includes('tw'));assert.equal(h.controls().unsaved,true)
 assert.match(h.html(),/Browser storage is unavailable/)
 const storage=memoryStorage();storage.setItem(preferenceKey('dashboard-today','user-a'),'{broken')
 assert.equal(headerKeys(kpiCustomizationHarness(props,storage))[0],'name')
})

test('live row refresh retains customization and applies filters to new values without altering source data',()=>{
 const before=structuredClone(props),h=kpiCustomizationHarness(props)
 update(h,c=>({...c,hidden:['mw'],filters:{tw:{op:'gt',value:'150'}}}))
 assert.match(text(bodyRows(h)[0]),/^Beta/)
 const next=structuredClone(props);next.source.totals[0].total_washes=175
 h.props(next)
 assert.equal(bodyRows(h).length,4);assert.ok(!headerKeys(h).includes('mw'))
 assert.deepEqual(props,before)
})

test('companywide scores/ranks and their formatting remain unchanged by display-only filters',()=>{
 const locs=locations.slice(0,2).map(l=>({...l,show_budget_tracking:true}))
 const data={locations:locs,targets:locs.map(l=>({location_id:l.id,target_month:'2026-10-01',revenue_goal:3100,starting_members:100,membership_daily_growth:2,membership_goal:162,desired_rating:4.85})),
  entries:locs.map((l,i)=>({location_id:l.id,entry_date:'2026-10-03',mtd_washes:100-i*20,mtd_redemptions:0,mtd_basic:0,mtd_good:0,mtd_better:0,mtd_best:10,mtd_membership_actual:104+i,current_reviews:12,current_rating:4.85,yesterday_washes:100,yesterday_redemptions:80,yesterday_basic:0,yesterday_good:0,yesterday_better:0,yesterday_best:4,yesterday_total_revenue:0,yesterday_cc_revenue:0,yesterday_house_revenue:0})),
  balances:locs.map(l=>({location_id:l.id,revenue_month:'2026-10-01',amount:600,cutoff_business_date:'2026-10-02'}))}
 const budgetRows=buildBudgetReportRows(data,'2026-10-03'),before=structuredClone(budgetRows)
 assert.ok(budgetRows.every(r=>r.rank!=null),'fixture must have genuine companywide ranks')
 const p={...props,daily:false,locations:locs,budgetRows,source:{notes:[],totals:budgetRows.map(r=>budgetPerformanceRow(r.entry,'mtd','2026-10-02'))}}
 const h=kpiCustomizationHarness(p)
 const rankBefore=bodyRows(h).slice(0,2).find(r=>text(cells(r)[0])==='Beta').props.children.find(c=>c.props['data-column']==='rank')
 update(h,c=>({...c,filters:{name:{op:'equals',value:'Beta'}}}))
 const rankAfter=cells(bodyRows(h)[0]).find(c=>c.props['data-column']==='rank')
 assert.equal(text(rankAfter),text(rankBefore));assert.deepEqual(budgetRows,before)
 h.menu()[5].run();assert.equal(h.exports.at(-1).spec.rows[0][h.exports.at(-1).spec.columns.findIndex(c=>c.label==='Rank')],Number(text(rankBefore)))
})

test('controls support drag/drop, touch move buttons, keyboard moves, visibility and accessible filter inputs',()=>{
 const h=kpiCustomizationHarness(props)
 const controls=locationHelpHarness('components/KpiTableControls',{
  ...columnUtilities,
 },h.controls())
 const sync=()=>controls.props(h.controls())
 const handle=()=>controls.find(n=>n.type==='button' && n.props['aria-label']==='Move Net Members')
 const drag={value:'',setData(type,value){this.value=value},getData(){return this.value}}
 handle().props.onDragStart({dataTransfer:drag})
 controls.find(n=>n.type==='li' && React.Children.toArray(n.props.children).some(c=>c.props?.['aria-label']==='Move Total Washes')).props.onDrop({preventDefault(){},dataTransfer:drag})
 sync();assert.deepEqual(headerKeys(h).slice(0,3),['name','nm','tw'])
 handle().props.onKeyDown({key:'ArrowDown',preventDefault(){}});sync();assert.deepEqual(headerKeys(h).slice(0,3),['name','tw','nm'])
 controls.find(n=>n.type==='button' && n.props['aria-label']==='Move Net Members up').props.onClick();sync();assert.equal(headerKeys(h)[1],'nm')
 const locationCheckbox=controls.find(n=>n.type==='input' && n.props.type==='checkbox' && n.props.disabled)
 assert.equal(locationCheckbox.props.checked,true)
 const netRule=controls.find(n=>n.type==='select' && n.props['aria-label']==='Net Members filter operator')
 netRule.props.onChange({target:{value:'eq'}});sync()
 controls.find(n=>n.type==='input' && n.props['aria-label']==='Net Members filter value').props.onChange({target:{value:'0'}});sync()
 assert.match(text(bodyRows(h)[0]),/^Alpha/)
 const netCheck=controls.find(n=>n.type==='label' && text(n)==='Net Members').props.children[0]
 netCheck.props.onChange({target:{checked:false}});sync();assert.ok(!headerKeys(h).includes('nm'));assert.deepEqual(h.controls().config.filters,{})
 assert.ok(controls.find(n=>n.props['aria-live']==='polite'))
 assert.match(h.html(),/role="region"/);assert.match(h.html(),/tabindex="0"/);assert.match(h.html(),/dark:bg-tm-dark-surface/)
})


test('Location alone stays identifiable and exportable without forcing a wide mobile table',()=>{
 const h=kpiCustomizationHarness(props)
 update(h,c=>({...c,hidden:c.order.filter(k=>k!=='name')}))
 assert.deepEqual(headerKeys(h),['name'])
 for(const row of bodyRows(h))assert.equal(cells(row).length,1)
 assert.doesNotMatch(h.html(),/min-w-\[800px\]/)
 h.menu()[5].run();const spec=h.exports.at(-1).spec
 assert.deepEqual(spec.columns,[{label:'Location',type:'text'}]);assert.ok(spec.rows.every(r=>r.length===1));assert.equal(spec.totalsRow.length,1)
})
