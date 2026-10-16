import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadDashboardMtd } from '../src/utils/dashboardMtdRead.js'
import { selectPerformanceSources } from '../src/utils/budgetPerformanceSource.js'

const sites = [{id:'own',show_budget_tracking:true},{id:'other',show_budget_tracking:true},{id:'logs',show_budget_tracking:false}]
const range={start:'2026-10-01',end:'2026-10-16'}
const snapshot=id=>({location_id:id,entry_date:'2026-10-16',mtd_washes:1000,mtd_redemptions:500,mtd_basic:10,mtd_good:10,mtd_better:20,mtd_best:10,current_reviews:12})

test('Dashboard requests company performance via RPC with a completed-day cutoff and no raw Budget table read',async()=>{
 let calls=0
 const client={async rpc(name,args){calls++;assert.equal(name,'dashboard_mtd_performance');assert.deepEqual(args,{p_location_ids:['own','other'],p_month_start:'2026-10-01',p_through_date:'2026-10-15'});return {data:[snapshot('own'),snapshot('other')]}}}
 const entries=await loadDashboardMtd(client,sites,range,'2026-10-15')
 assert.equal(calls,1);assert.equal(entries.length,2)
 const result=selectPerformanceSources([{location_id:'other',log_date:'2026-10-15',time_slot:'10:00',total_washes:9999}],entries,sites,range,'2026-10-16')
 assert.equal(result.totals.filter(r=>r.location_id==='other').length,1)
 assert.equal(result.totals.find(r=>r.location_id==='other').total_washes,1000)
 assert(result.notes.every(n=>n.complete))
})

test('RPC fields are whitelisted and out-of-scope locations/future dates are discarded',async()=>{
 const client={async rpc(){return {data:[{...snapshot('other'),mtd_revenue_actual:90000,entered_by:'private',cash_count:200},snapshot('not-requested'),{...snapshot('own'),entry_date:'2026-10-17'}]}}}
 const entries=await loadDashboardMtd(client,sites,range,'2026-10-15')
 assert.equal(entries.length,1)
 assert.deepEqual(Object.keys(entries[0]).sort(),Object.keys(snapshot('other')).sort())
 assert(!('mtd_revenue_actual' in entries[0]));assert(!('entered_by' in entries[0]))
})

test('missing endpoint/access denied never falls back to raw table reads or partial Daily Logs',async()=>{
 for(const code of ['PGRST202','42501']) {
  const client={async rpc(){return {error:{code}}},from(){assert.fail('No fallback table read permitted')}}
  await assert.rejects(loadDashboardMtd(client,sites,range,'2026-10-15'),/unavailable/)
 }
})

test('first of month with no completed day and non-Budget locations do not issue a request',async()=>{
 const client={rpc(){assert.fail('No request expected')}}
 assert.deepEqual(await loadDashboardMtd(client,sites,{start:'2026-11-01',end:'2026-11-01'},'2026-10-31'),[])
 assert.deepEqual(await loadDashboardMtd(client,[sites[2]],range,'2026-10-15'),[])
})

test('proposed SQL boundary explicitly authenticates active users, narrows the projection and revokes public execution',()=>{
 const sql=readFileSync(new URL('../supabase/migration21.sql',import.meta.url),'utf8')
 assert.match(sql,/p\.id = auth\.uid\(\) and p\.is_active = true and p\.deleted_at is null/)
 assert.match(sql,/p\.role = 'store' and p\.location_id is not null/)
 assert.match(sql,/stable security definer/)
 assert.match(sql,/set search_path = ''/)
 assert.match(sql,/owner to postgres/)
 assert.match(sql,/from public, anon/)
 assert.match(sql,/to authenticated/)
 const projection=sql.slice(sql.indexOf('return query'),sql.indexOf('from public.budget_daily_entries'))
 assert.doesNotMatch(projection,/revenue|cash|entered_by|rating|select \*/i)
 assert.doesNotMatch(sql,/create policy|alter policy|grant .* on (table )?public\.budget_daily_entries/i)
})
