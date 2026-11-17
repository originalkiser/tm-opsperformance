import test from 'node:test'
import assert from 'node:assert/strict'
import {createViewFetch, setManagerViewReadOnly, managerViewState, loadManagerView, viewStorageKey, pendingViewWrites, withViewWrite} from '../src/utils/managerViewPolicy.js'
const url='https://fictional.supabase.co',user={id:'admin1'},admin={id:'admin1',role:'admin',is_active:true},sites=[{id:'a'},{id:'b'}]
test('only active Admin can preview; invalid sites clamp to authorized locations',()=>{
 for(const profile of [{...admin,role:'store'},{...admin,role:'area_manager'},{...admin,is_active:false},{...admin,deleted_at:'date'}])assert.equal(managerViewState(user,profile,sites,{manager:true,site:'b'}).active,false)
 assert.equal(managerViewState(null,admin,sites,{manager:true}).active,false)
 assert.deepEqual(managerViewState(user,admin,sites,{manager:true,site:'outside'}),{allowed:true,active:true,site:'a'})
 assert.equal(admin.role,'admin');assert.equal(admin.location_id,undefined)
})
test('view and site restore per user without writing account settings',()=>{
 const map=new Map([[viewStorageKey('admin1'),JSON.stringify({manager:true,site:'b'})]]),storage={getItem:k=>map.get(k)}
 assert.deepEqual(loadManagerView(storage,'admin1'),{manager:true,site:'b'})
 assert.deepEqual(loadManagerView(storage,'other'),{manager:false,site:''})
 assert.deepEqual(loadManagerView({getItem(){throw Error('blocked')}},'admin1'),{manager:false,site:''})
})
test('preview blocks table mutations, unknown RPCs, uploads, account changes and outbound writes before network',async()=>{
 const calls=[],fetcher=createViewFetch(async(...args)=>{calls.push(args);return new Response('{}')});setManagerViewReadOnly(true)
 try {
  for(const [path,method,body] of [['/rest/v1/daily_logs','POST','{}'],['/rest/v1/budget_tracking','PATCH','{}'],['/rest/v1/employees','DELETE'],['/rest/v1/rpc/save_checklist','POST','{}'],['/rest/v1/rpc/import_monthly_budget','POST','{}'],['/storage/v1/object/bucket/file','POST','bytes'],['/auth/v1/user','PUT','{}'],['/functions/v1/submit-downtime-jotform','POST','{}'],['https://api.jotform.com/submission/1','DELETE']]){
   const r=await fetcher(path.startsWith('https:')?path:url+path,{method,body});assert.equal(r.status,403)
  }
  for(const action of ['start','save','upload','begin_edit','discard','qr_rotate','qr_revoke'])assert.equal((await fetcher(url+'/functions/v1/checklist-access',{method:'POST',body:JSON.stringify({action})})).status,403)
  assert.equal(calls.length,0);await assert.rejects(withViewWrite(async()=>{throw Error('network reached')}),/read-only/)
 }finally{setManagerViewReadOnly(false)}
})
test('preview permits reads, approved reporting RPCs, evidence downloads and auth refresh/sign-out',async()=>{
 const calls=[],fetcher=createViewFetch(async(...args)=>{calls.push(args);return new Response('{}')});setManagerViewReadOnly(true)
 try{
  for(const path of ['/rest/v1/budget_tracking','/rest/v1/checklist_templates','/storage/v1/object/authenticated/bucket/photo'])assert.equal((await fetcher(url+path)).status,200)
  for(const path of ['/rest/v1/rpc/dashboard_mtd_performance','/rest/v1/rpc/get_checklist_compliance','/auth/v1/token?grant_type=refresh_token','/auth/v1/logout','/storage/v1/object/sign/bucket/photo'])assert.equal((await fetcher(url+path,{method:'POST',body:'{}'})).status,200)
  for(const action of ['context','read','history','download'])assert.equal((await fetcher(url+'/functions/v1/checklist-access',{method:'POST',body:JSON.stringify({action})})).status,200)
  assert.equal(calls.length,12)
 }finally{setManagerViewReadOnly(false)}
})
test('normal Admin and Store requests are unchanged; pending writes protect switching',async()=>{
 setManagerViewReadOnly(false);let finish;const fetcher=createViewFetch(()=>new Promise(r=>{finish=r}));const result=fetcher(url+'/rest/v1/daily_logs',{method:'POST',body:'{}'});await new Promise(r=>setTimeout(r,0));assert.equal(pendingViewWrites(),1);finish(new Response('{}'));assert.equal((await result).status,200);assert.equal(pendingViewWrites(),0)
})
