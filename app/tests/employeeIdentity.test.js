import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { employeeNameKey, duplicateEmployeeGroups, createEmployeeIfMissing, readLocationEmployees } from '../src/utils/employeeIdentity.js'
import { buildEmployeePerformance, fetchEmployeeLogs } from '../src/utils/employeePerformance.js'

function database(initial=[]) {
  const records=initial.map(r=>({...r})),writes=[],reads=[]
  let error=null,readError=null
  const client={from(table){assert.equal(table,'employees');let locationId
    return {
      select(columns,options){assert.equal(columns,'id, location_id, name, is_active');assert.equal(options.count,'exact');return this},
      eq(key,id){assert.equal(key,'location_id');locationId=id;return this},order(key){assert.equal(key,'id');return this},
      async range(from,to){reads.push([locationId,from,to]);if(readError)return{error:readError};const all=records.filter(r=>r.location_id===locationId);return{data:all.slice(from,Math.min(to+1,from+2)),count:all.length}},
      async insert(value){writes.push(value);if(error)return{error};records.push({id:`created-${writes.length}`,...value});return{error:null}},
    }
  }}
  return {client,records,writes,reads,failInsert:e=>{error=e},failRead:e=>{readError=e}}
}
const emp=(id,name='Cam',location_id='carencro',is_active=true)=>({id,name,location_id,is_active})

test('normalized identity is trimmed, case-insensitive and location-scoped; never a person merge',()=>{
  assert.equal(employeeNameKey('  cAM '),'cam');assert.equal(employeeNameKey(null),'')
  const records=[emp('a'),emp('b',' cam '),emp('c','CAM','other'),emp('d','Other')]
  const groups=duplicateEmployeeGroups(records)
  assert.deepEqual(groups.map(g=>g.map(e=>e.id)),[['a','b']]);assert.equal(records.length,4)
})

test('Admin creation rejects seven matching Cam records without inserts, deletes, updates or reactivation',async()=>{
  const db=database(Array.from({length:7},(_,i)=>emp(`cam-${i}`)))
  const result=await createEmployeeIfMissing(db.client,'carencro',' cAM ')
  assert.equal(result.created,false);assert.equal(result.matches.length,7);assert.deepEqual(db.writes,[])
  assert.equal(db.records.length,7);assert.ok(db.reads.length>1,'server-capped pages are all checked')
})

test('inactive matches also prevent duplicates; same name in a different location remains legitimate',async()=>{
  const db=database([emp('old',' CAM ','carencro',false)])
  assert.equal((await createEmployeeIfMissing(db.client,'carencro','Cam')).created,false)
  assert.equal(db.records[0].is_active,false)
  assert.equal((await createEmployeeIfMissing(db.client,'other',' Cam ')).created,true)
  assert.deepEqual(db.writes,[{location_id:'other',name:'Cam',is_active:true}])
})

test('concurrent Admin/auto-add calls in the same client share a pending check and insert once',async()=>{
  const db=database()
  const results=await Promise.all([createEmployeeIfMissing(db.client,'carencro','Cam'),createEmployeeIfMissing(db.client,'carencro',' CAM ')])
  assert.equal(db.writes.length,1);assert.equal(results[0],results[1])
  assert.equal((await createEmployeeIfMissing(db.client,'carencro','cam')).created,false)
})

test('failed verification or insertion never claims success and the pending guard permits retries',async()=>{
  const db=database();db.failRead(new Error('denied'))
  await assert.rejects(createEmployeeIfMissing(db.client,'carencro','Cam'),/denied/);assert.equal(db.writes.length,0)
  db.failRead(null);db.failInsert(new Error('insert failed'))
  await assert.rejects(createEmployeeIfMissing(db.client,'carencro','Cam'),/insert failed/)
  db.failInsert(null);assert.equal((await createEmployeeIfMissing(db.client,'carencro','Cam')).created,true)
  await assert.rejects(createEmployeeIfMissing(db.client,'carencro',' '),/enter an employee name/)
})

test('incomplete, duplicate, foreign-scope or changing roster pages fail closed',async()=>{
  for(const response of [{data:[],count:null},{data:[emp('a'),emp('a')],count:2},{data:[emp('a','Cam','other')],count:1},{data:[],count:1}]){
    const client={from(){return{select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve(response)},insert(){assert.fail('no insert')}}}}
    await assert.rejects(createEmployeeIfMissing(client,'carencro','Cam'))
  }
  const db=database();assert.deepEqual(await readLocationEmployees(db.client,'carencro'),[])
})

test('Admin shows duplicate/error messages and prevents repeated submissions before its first await',async()=>{
  const source=readFileSync(new URL('../src/pages/Admin.jsx',import.meta.url),'utf8')
  const handler=source.slice(source.indexOf('  const addEmployee = async () => {'),source.indexOf('  const toggleEmployee'))
  const ref={current:false},errors=[],saving=[];let release,calls=0,refresh=0
  const bindings={newEmpName:' Cam ',selectedLocId:'carencro',employeeSaveRef:ref,supabase:{},
    setEmployeeSaving:v=>saving.push(v),setEmployeeError:v=>errors.push(v),setNewEmpName:()=>assert.fail('duplicate must keep input'),
    createEmployeeIfMissing:()=>{calls++;return new Promise(resolve=>{release=resolve})},fetchEmployees:()=>{refresh++}}
  const add=new Function(...Object.keys(bindings),handler+';return addEmployee')(...Object.values(bindings))
  const first=add();await add();assert.equal(calls,1);release({created:false,matches:[emp('a')]});await first
  assert.match(errors.at(-1),/already exists/);assert.equal(ref.current,false);assert.deepEqual(saving,[true,false]);assert.equal(refresh,0)
  assert.match(source,/duplicateEmployeeGroups\(employees\)/)
})

test('Daily Log auto-add uses shared guard while preserving log saves and avoiding cross-location refresh',async()=>{
  const source=readFileSync(new URL('../src/components/DailyLogTable.jsx',import.meta.url),'utf8')
  const block=source.slice(source.indexOf('  const autoAddEmployee = async (name) => {'),source.indexOf('  const saveImmediately'))
  let resolve,calls=0,refresh=0
  const loc={current:'carencro'},bindings={employeeNameKey,locationIdRef:loc,employeesRef:{current:[]},supabase:{},
    createEmployeeIfMissing:(_,locationId)=>{calls++;assert.equal(locationId,'carencro');return new Promise(r=>{resolve=r})},fetchEmployees:()=>{refresh++}}
  const auto=new Function(...Object.keys(bindings),block+';return autoAddEmployee')(...Object.values(bindings))
  const p=auto('Cam');loc.current='other';resolve({created:true});await p;assert.equal(refresh,0);assert.equal(calls,1)
  assert.match(source,/scheduleBatch\(\[index\]\)/)
  assert.match(source,/employee_name:\s+row.employee_name \|\| null/)
  assert.doesNotMatch(source,/employee_id:/)
})

test('seven roster records do not fan out Daily Log rows or leaderboard sales/opportunities',async()=>{
  const roster=Array.from({length:7},(_,i)=>emp(`cam-${i}`))
  const logs=[{id:'log1',location_id:'carencro',log_date:'2026-10-20',time_slot:'08:00:00',split_index:0,employee_name:'Cam',total_washes:100,member_washes:20,basic:1,good:0,better:2,best:3},
    {id:'log2',location_id:'carencro',log_date:'2026-10-21',time_slot:'08:00:00',split_index:0,employee_name:' cAM ',total_washes:50,member_washes:10,basic:1,good:0,better:1,best:1}]
  const client={from(table){assert.equal(table,'daily_logs','ranking must not join the employees roster');return{select(){return this},in(){return this},gte(){return this},lte(){return this},order(){return this},range(){return Promise.resolve({data:logs,count:logs.length})}}}}
  const range={start:'2026-10-01',end:'2026-10-31'},data=await fetchEmployeeLogs(client,['carencro'],range)
  const report=buildEmployeePerformance(data,[{id:'carencro',name:'1527-Carencro',opportunities_formula:'simple'}],range)
  assert.equal(roster.length,7);assert.equal(report.rows.length,1)
  assert.equal(report.rows[0].ms,9);assert.equal(report.rows[0].opp,120);assert.equal(report.rows[0].rank,1)
})
