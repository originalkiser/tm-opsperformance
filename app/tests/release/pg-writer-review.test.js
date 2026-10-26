import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {dailyLogPersistence} from '../../src/utils/dailyLogEmployees.js'
import {lossWriter} from '../../src/utils/dailyMemberships.js'
const A='10000000-0000-0000-0000-000000000001',E='20000000-0000-0000-0000-000000000001'
const bridge=fileURLToPath(new URL('./pg_release_bridge.py',import.meta.url))
async function request(value){return new Promise((resolve,reject)=>{
 const child=execFile('python3',[bridge],{env:{...process.env,PYTHONPATH:'/private/tmp/tmid-db-client'}},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout)))
 child.stdin.end(JSON.stringify(value))
})}
const client={from(table){const value={table,action:'select',filters:[]};const q={
 select(){return q},eq(k,v){value.filters.push([k,v]);return q},is(k,v){value.filters.push([k,v]);return q},or(){value.emptyName=true;return q},order(){return q},range(){return request(value)},
 update(body){Object.assign(value,{action:'update',body});return q},insert(body){Object.assign(value,{action:'insert',body});return q},upsert(body){Object.assign(value,{action:'upsert',body});return q},delete(){value.action='delete';return q},
 async maybeSingle(){const r=await request(value);return{...r,data:r.data?.[0]||null}},then(resolve,reject){return request(value).then(resolve,reject)}
 };return q}}
const payload=(extra={})=>({location_id:A,log_date:'2025-01-15',time_slot:'08:00:00',split_index:0,google_reviews:1,total_washes:20,member_washes:10,basic:2,good:0,better:0,best:0,memberships_sold:2,opportunities:10,...extra})
const reset=()=>request({action:'reset'})
const all=async()=>{const r=await client.from('daily_logs').select();if(r.error)throw r.error;return r.data}
const writer=(records=[])=>{const w=dailyLogPersistence(client,A,'2025-01-15');w.load(records);return w}
const stage=(w,p,name=null)=>w.stage({...p,employee_name:name},p)
test('production-shaped PostgreSQL: ordinary blank-name PATCH preserves existing employee ID',async()=>{
 await reset();const seed=await client.from('daily_logs').insert({...payload(),employee_name:null,employee_id:E}).maybeSingle();assert.equal(seed.error,null)
 const w=writer([seed.data]);stage(w,payload({google_reviews:3}));await w.flush()
 const [current]=await all();assert.equal(current.employee_id,E);assert.equal(current.employee_name,null);assert.equal(current.google_reviews,3)
})
test('production-shaped PostgreSQL: own Plans Lost anchor accepts subsequent first-hour save',async()=>{
 await reset();const w=writer();await w.loss(3);stage(w,payload());await w.flush()
 const rows=await all();assert.equal(rows.length,1);assert.equal(rows[0].plans_lost_today,3);assert.equal(rows[0].google_reviews,1)
})
test('production-shaped PostgreSQL: Undo after actual deletion restores full original checkpoint and identity',async()=>{
 await reset();const seed=await client.from('daily_logs').insert({...payload({split_index:1}),employee_name:'Historical Nick',employee_id:E,net_members:-4,net_members_legacy:true}).maybeSingle()
 assert.equal(seed.error,null);const original=seed.data,w=writer([original]);w.stage(original,null);await w.flush();assert.equal((await all()).length,0)
 stage(w,payload({split_index:1}),'Historical Nick');await w.flush();assert.deepEqual((await all())[0],original)
})
test('production-shaped PostgreSQL: Undo selection restores original NULL on a new numeric checkpoint',async()=>{
 await reset();const w=writer();stage(w,payload());await w.flush();stage(w,payload(),'Cam');await w.flush();stage(w,payload(),'');await w.flush()
 assert.equal((await all())[0].employee_name,null)
})
test('production-shaped PostgreSQL: unrelated edit retains concurrent name; explicit replacement conflicts',async()=>{
 await reset();const w=writer();stage(w,payload(),'Cam');await w.flush();const [original]=await all()
 await client.from('daily_logs').update({employee_name:'Historical Other'}).eq('id',original.id)
 stage(w,payload({google_reviews:4}),'Cam');await w.flush();assert.equal((await all())[0].employee_name,'Historical Other')
 const stale=writer([original]);stage(stale,payload(),'Replacement');await assert.rejects(stale.flush(),/another session/)
})
test('production-shaped PostgreSQL: concurrent new checkpoints produce one row and explicit unique conflict',async()=>{
 await reset();const a=writer(),b=writer();stage(a,payload(),'Cam');stage(b,payload(),'Cam');const results=await Promise.allSettled([a.flush(),b.flush()])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'23505');assert.equal((await all()).length,1)
})
test('production-shaped PostgreSQL: original Plans Lost deletion guard remains enforced',async()=>{
 await reset();const w=writer();await w.loss(3);const [anchor]=await all();w.stage(anchor,null);await assert.rejects(w.flush(),/Daily plans lost must be retained/)
 const denied=await client.from('daily_logs').delete().eq('id',anchor.id);assert.match(denied.error.message,/Daily plans lost must be retained/)
})
