// Execute the real Edge handlers with fictional clients. No external requests or credentials.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import {webcrypto} from 'node:crypto'
function handler(file,role,own=true){
 let fn,resetCalls=0
 const profile={role,is_active:true,location_id:own?'site':'other'}
 const admin={auth:{admin:{async updateUserById(){resetCalls++;return {data:{}}}}},from(table){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='user_profiles'?profile:{id:'log',location_id:'site',status:'resolved',ended_at:'date',jotform_submission_id:'already-sent'}})}}}
 const userClient={auth:{getUser:async()=>({data:{user:{id:'fictional-caller'}}})}}
 let clients=0
 const source=readFileSync(new URL(`../supabase/functions/${file}/index.ts`,import.meta.url),'utf8').replace(/^import .*\n/gm,'')
 new Function('Deno','createClient','projectKeys','crypto','buildSubmissionFields',transformSync(source,{loader:'ts',format:'cjs'}).code)(
 {serve:f=>{fn=f}},()=>clients++%2===0?userClient:admin,()=>({url:'https://fictional.invalid',publishableKey:'public',secretKey:'fictional-server-key'}),webcrypto,()=>{throw Error('Outbound submission forbidden in fixture')})
 return {call:body=>fn(new Request('https://fictional.invalid',{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(body)})),resets:()=>resetCalls}
}
test('account administration remains Admin-only and rejects retired Area Manager',async()=>{
 for(const role of ['admin','store','area_manager']){
  const h=handler('admin-users',role);const result=await h.call({action:'reset_password',user_id:'fictional-target'});assert.equal(result.status,role==='admin'?200:403);assert.equal(h.resets(),role==='admin'?1:0)
 }
})
test('downtime retains Admin and assigned Store rights; retired role and other-site Store are denied',async()=>{
 for(const [role,own,expected] of [['admin',false,200],['store',true,200],['store',false,403],['area_manager',true,403]]){
  const h=handler('submit-downtime-jotform',role,own);assert.equal((await h.call({downtime_log_id:'log'})).status,expected)
 }
})
