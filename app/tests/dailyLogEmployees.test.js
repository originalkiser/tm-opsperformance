import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeEmployeeOptions, loadDailyLogEmployees, resolvePastedEmployee, saveDailyLogCheckpoint } from '../src/utils/dailyLogEmployees.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
const employee = (id, name, extra = {}) => ({ id, name, location_id: 'a', is_active: true, ...extra })
const roster = [employee('3','Zoe'),employee('2',' cam '),employee('1','Cam'),employee('4','Al'),employee('5','Old',{is_active:false}),employee('6','Other',{location_id:'b'})]
function client({ rows=roster.filter(e=>e.location_id==='a'), count=rows.length, fail, saved={id:'log',employee_name:'Cam'} }={}) {
 const calls=[]
 return { calls, from(table) {
  const q={ select(){return q},eq(k,v){calls.push(['eq',k,v]);return q},or(v){calls.push(['or',v]);return q},order(){return q},range(){return Promise.resolve({data:rows,count,error:fail})},
   insert(value){calls.push(['insert',table,value]);return q},update(value){calls.push(['update',table,value]);return q},maybeSingle(){return Promise.resolve({data:saved,error:fail})} }
  return q
 } }
}
const payload={location_id:'a',log_date:'2025-01-15',time_slot:'08:00:00',split_index:2,basic:4,memberships_sold:4,opportunities:8,employee_id:'do-not-write',employee_name:'stale'}
test('active roster is location-specific, alphabetical and normalized-deduplicated with deterministic spelling',()=>{
 assert.deepEqual(activeEmployeeOptions(roster,'a').map(e=>e.name),['Al','Cam','Zoe'])
 assert.deepEqual(activeEmployeeOptions([...roster].reverse(),'a'),activeEmployeeOptions(roster,'a'))
 assert.deepEqual(activeEmployeeOptions(roster,'missing'),[])
})
test('roster read rejects failed/incomplete coverage instead of offering partial choices',async()=>{
 assert.deepEqual((await loadDailyLogEmployees(client(),'a')).map(e=>e.name),['Al','Cam','Zoe'])
 await assert.rejects(loadDailyLogEmployees(client({fail:Error('offline')}),'a'),/offline/)
 await assert.rejects(loadDailyLogEmployees(client({count:null}),'a'),/verified/)
})
test('paste preserves blank and exact historical names, resolves active spelling, rejects unmatched new names',()=>{
 const options=activeEmployeeOptions(roster,'a')
 assert.equal(resolvePastedEmployee('', '  Nickname  ', options),'  Nickname  ')
 assert.equal(resolvePastedEmployee('Retired','Retired',options),'Retired')
 assert.equal(resolvePastedEmployee(' CAM ','Retired',options),'Cam')
 assert.throws(()=>resolvePastedEmployee('Unknown','Retired',options),/Employees tab/)
})
test('unrelated edits PATCH without name or employee ID and preserve exact backdate/split and numeric fields',async()=>{
 const c=client({saved:{id:'log',employee_name:'Different concurrent name'}})
 await saveDailyLogCheckpoint(c,{id:'log',employee_name:'  Historic  ',_savedEmployeeName:'  Historic  '},payload)
 const [,table,write]=c.calls.find(x=>x[0]==='update')
 assert.equal(table,'daily_logs');assert.equal(write.log_date,'2025-01-15');assert.equal(write.split_index,2)
 assert.equal(write.basic,4);assert.equal(write.opportunities,8)
 assert.ok(!('employee_name' in write));assert.ok(!('employee_id' in write))
})
test('new names revalidate against active location roster, INSERT exact spelling without employee ID',async()=>{
 const c=client();await saveDailyLogCheckpoint(c,{employee_name:'Cam'},payload)
 const write=c.calls.find(x=>x[0]==='insert')[2]
 assert.equal(write.employee_name,'Cam');assert.ok(!('employee_id' in write))
 for(const name of ['Old','Other','Unknown','CAM']) {
  const denied=client();await assert.rejects(saveDailyLogCheckpoint(denied,{employee_name:name},payload),/active roster/)
  assert.equal(denied.calls.filter(x=>['insert','update'].includes(x[0])).length,0)
 }
})
test('explicit replacement guards original historical name and detects simultaneous rename/delete',async()=>{
 const c=client();await saveDailyLogCheckpoint(c,{id:'log',employee_name:'Cam',_savedEmployeeName:'Nickname'},payload)
 assert.ok(c.calls.some(x=>x[0]==='eq'&&x[1]==='employee_name'&&x[2]==='Nickname'))
 const missing=client({saved:null});await assert.rejects(saveDailyLogCheckpoint(missing,{id:'log',employee_name:'Cam',_savedEmployeeName:'Nickname'},payload),/another session/)
})
test('unique conflict on simultaneous new checkpoint surfaces instead of overwriting; blank names stay allowed',async()=>{
 const c=client({fail:Error('duplicate key')});await assert.rejects(saveDailyLogCheckpoint(c,{employee_name:''},payload),/duplicate key/)
 assert.equal(c.calls[0][0],'insert');assert.equal(c.calls[0][2].employee_name,null)
})
function picker(props={}) {
 const changes=[]
 const h=locationHelpHarness('components/EmployeeSelect',{useId:()=> 'picker'}, {value:'Historic Nick',employees:activeEmployeeOptions(roster,'a'),onChange:v=>changes.push(v),...props})
 const input=()=>h.find(n=>n.type==='input')
 return Object.assign(h,{changes,input,focus(){input().props.onFocus();h.render()},type(value){input().props.onChange({target:{value}});h.render()},key(key){input().props.onKeyDown({key,preventDefault(){}});h.render()}})
}
test('typing/Enter without highlighted selection never commits text; Escape/Tab/blur restore historical name',()=>{
 for(const exit of ['Escape','Tab','blur']) {
  const h=picker();h.render();h.focus();h.type('unknown');h.key('Enter')
  assert.deepEqual(h.changes,[])
  if(exit==='blur')h.find(n=>n.type==='div').props.onBlur({currentTarget:{contains:()=>false},relatedTarget:null});else h.key(exit)
  assert.equal(h.input().props.value,'Historic Nick');assert.deepEqual(h.changes,[])
 }
})
test('keyboard and pointer selection commit roster name only, exposing combobox/listbox semantics',()=>{
 const h=picker();h.render();h.focus();h.type('ca');h.key('ArrowDown')
 assert.equal(h.input().props['aria-activedescendant'],'picker-0')
 h.key('Enter');assert.deepEqual(h.changes,['Cam'])
 const p=picker();p.render();p.focus();p.find(n=>n.props.role==='option'&&n.props.children==='Al').props.onClick();assert.deepEqual(p.changes,['Al'])
})
test('loading/error/empty roster never exposes selectable names and offers Employees guidance',()=>{
 for(const props of [{loading:true},{error:'offline'},{employees:[]}]) {
  const h=picker(props);h.render();h.focus();h.key('ArrowDown');h.key('Enter')
  assert.deepEqual(h.changes,[]);assert.equal(h.all(n=>n.props.role==='option').length,0)
  assert.ok(h.find(n=>n.type==='a'&&n.props.href==='#/employees'))
 }
})
test('all Daily Log entry paths use roster picker and guarded writer; no roster writes or free-text auto-add remain',()=>{
 const src=readFileSync(new URL('../src/components/DailyLogTable.jsx',import.meta.url),'utf8')
 assert.equal((src.match(/<EmployeeSelect/g)||[]).length,2)
 assert.equal((src.match(/loading=\{rosterLoading\}/g)||[]).length,2)
 assert.doesNotMatch(src,/createEmployeeIfMissing|autoAddEmployee|EditEmployeesModal|employee_id:/)
 assert.match(src,/resolvePastedEmployee/);assert.match(src,/const flushSave = doSave/)
 assert.match(src,/pendingSaves.current/)
})

test('undo may restore the exact originally recorded historical name with a guarded PATCH',async()=>{
 const c=client({rows:[],saved:{id:'log',employee_name:'Retired Nickname'}})
 await saveDailyLogCheckpoint(c,{id:'log',employee_name:'Retired Nickname',_savedEmployeeName:'Cam',_recordedEmployeeName:'Retired Nickname'},payload)
 assert.equal(c.calls.find(x=>x[0]==='update')[2].employee_name,'Retired Nickname')
 assert.ok(c.calls.some(x=>x[0]==='eq'&&x[1]==='employee_name'&&x[2]==='Cam'))
})
test('late roster responses cannot repopulate a different location or clear its loading state',async()=>{
 const src=readFileSync(new URL('../src/components/DailyLogTable.jsx',import.meta.url),'utf8')
 const block=src.slice(src.indexOf('  const fetchEmployees = async () => {'),src.indexOf('\n  useEffect(() => {\n    const refresh ='))
 const requests=[],shown=[],loading=[],loc={current:'a'},request={current:0}
 const bindings={supabase:{},locationIdRef:loc,rosterRequest:request,setRosterLoading:v=>loading.push(v),setRosterError:()=>{},setEmps:v=>shown.push(v),loadDailyLogEmployees:(_,id)=>new Promise(resolve=>requests.push({id,resolve}))}
 const fetch=new Function(...Object.keys(bindings),block+';return fetchEmployees')(...Object.values(bindings))
 const first=fetch();loc.current='b';const second=fetch()
 requests[1].resolve([employee('b','B',{location_id:'b'})]);await second
 const count=loading.length
 requests[0].resolve([employee('a','A')]);await first
 assert.equal(shown.at(-1)[0].location_id,'b');assert.equal(loading.length,count)
})
