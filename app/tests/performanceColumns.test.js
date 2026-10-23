import test from 'node:test'
import assert from 'node:assert/strict'
import { KPI_COLUMNS, normalizePreferences, preferenceKey, readPreferences, savePreferences, moveColumn, visibleColumns, filterRows, columnValue, compareRows, activeFilter } from '../src/utils/performanceColumns.js'
import { memoryStorage } from './helpers/kpiCustomizationHarness.js'

const column=key=>KPI_COLUMNS.find(c=>c.key===key)
test('saved order/visibility are validated; Location is pinned and future columns append visible',()=>{
 const saved={order:['nm','name','tw','nm','removed'],hidden:['name','mw','mw','removed'],filters:{mw:{op:'eq',value:'0'}},sort:{col:'removed',dir:'desc'}}
 const prefs=normalizePreferences(saved)
 assert.deepEqual(prefs.order.slice(0,3),['name','nm','tw'])
 assert.equal(new Set(prefs.order).size,KPI_COLUMNS.length)
 assert.deepEqual(prefs.hidden,['mw']);assert.deepEqual(prefs.filters,{})
 assert.equal(prefs.sort.col,'tw')
 const future=normalizePreferences(prefs,[...KPI_COLUMNS,{key:'future',label:'Future',type:'number'}])
 assert.equal(visibleColumns([...KPI_COLUMNS,{key:'future'}],future).at(-1).key,'future')
 assert.equal(visibleColumns(KPI_COLUMNS,prefs)[0].key,'name')
 assert.deepEqual(normalizePreferences({order:'broken',hidden:{},filters:[],sort:42}),normalizePreferences(null))
})
test('reordering is immutable, supports arbitrary moves, and cannot move or displace Location',()=>{
 const order=['name','tw','mw','nm']
 assert.deepEqual(moveColumn(order,'nm','tw'),['name','nm','tw','mw'])
 assert.deepEqual(order,['name','tw','mw','nm'])
 for(const [key,target] of [['name','tw'],['tw','name'],['missing','tw'],['tw','tw']])assert.deepEqual(moveColumn(order,key,target),order)
})
test('local storage isolates table/user identities, handles corruption and blocked storage',()=>{
 const storage=memoryStorage(),prefs=normalizePreferences({hidden:['tw']})
 const key=preferenceKey('dashboard-today','alice')
 assert.equal(savePreferences(storage,key,prefs),true)
 assert.deepEqual(readPreferences(storage,key),prefs)
 for(const [table,user]of [['dashboard-mtd','alice'],['reports-sites','alice'],['dashboard-today','bob'],['dashboard-today',null]]){
  assert.deepEqual(readPreferences(storage,preferenceKey(table,user)),normalizePreferences(null))
 }
 storage.setItem(key,'bad json');assert.deepEqual(readPreferences(storage,key),normalizePreferences(null))
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}
 assert.deepEqual(readPreferences(blocked,key),normalizePreferences(null));assert.equal(savePreferences(blocked,key,prefs),false)
 assert.notEqual(preferenceKey('a:b','c'),preferenceKey('b','c:a'))
})
test('text, numeric, signed and percentage filters combine without treating missing as zero',()=>{
 const rows=[{name:'Alpha',tw:0,nm:0,p_mix:'25.0%',revenuePct:.25},{name:'Beta',tw:10,nm:-4,p_mix:'50.0%',revenuePct:.5},{name:'Empty',tw:0,nm:null,p_mix:'',revenuePct:null,missing:true}]
 const apply=(key,op,value)=>filterRows(rows,[column(key)],{[key]:{op,value}}).map(r=>r.name)
 assert.deepEqual(apply('name','contains','ALP'),['Alpha'])
 assert.deepEqual(apply('name','starts','be'),['Beta'])
 assert.deepEqual(apply('name','notContains','alp'),['Beta','Empty'])
 assert.deepEqual(apply('tw','eq','0'),['Alpha'])
 assert.deepEqual(apply('nm','ne','0'),['Beta'])
 assert.deepEqual(apply('nm','lt','0'),['Beta'])
 assert.deepEqual(apply('p_mix','gte','25%'),['Alpha','Beta'])
 assert.deepEqual(apply('revenuePct','eq','25'),['Alpha'])
 assert.deepEqual(apply('p_mix','missing',''),['Empty'])
 assert.deepEqual(apply('nm','present',''),['Alpha','Beta'])
 assert.deepEqual(filterRows(rows,[column('name'),column('tw')],{name:{op:'contains',value:'a'},tw:{op:'gt',value:'0'}}).map(r=>r.name),['Beta'])
 for(const value of ['', ' ', 'not a number'])assert.equal(activeFilter({op:'eq',value},column('tw')),false)
 for(const value of [null,undefined,'','—',false])assert.equal(columnValue({tw:value},column('tw')),null)
})
test('sorting handles text, percentages, signed numbers and missing values in both directions',()=>{
 const rows=[{name:'Missing',nm:null},{name:'Zero',nm:0},{name:'Negative',nm:-4},{name:'Positive',nm:5}]
 assert.deepEqual([...rows].sort((a,b)=>compareRows(a,b,column('nm'),'asc')).map(r=>r.nm),[-4,0,5,null])
 assert.deepEqual([...rows].sort((a,b)=>compareRows(a,b,column('nm'),'desc')).map(r=>r.nm),[5,0,-4,null])
 assert.deepEqual([{name:'B',p_mix:'9%'},{name:'A',p_mix:'10%'},{name:'C',p_mix:''}].sort((a,b)=>compareRows(a,b,column('p_mix'),'desc')).map(r=>r.name),['A','B','C'])
})


test('filters match displayed percent/currency/score precision without changing raw-value sorting',()=>{
 const values={name:'Rounded',revenuePct:.0746,score:74.96,revenue:12.345}
 for(const [key,display] of [['revenuePct','7.5'],['score','75.0'],['revenue','12.35']]) {
  assert.deepEqual(filterRows([values],[column(key)],{[key]:{op:'eq',value:display}}),[values])
 }
 assert.ok(compareRows({...values,name:'Z',score:74.96},{...values,name:'A',score:74.95},column('score'),'desc')<0)
})
