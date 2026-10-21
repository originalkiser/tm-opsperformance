import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardDailyNet, selectMtdNetMembers, loadMembershipSnapshots, compareNetMembers } from '../src/utils/dashboardNetMembers.js'
import { selectTodayPerformance, currentMtdRange } from '../src/utils/dashboardPerformance.js'
import { selectPerformanceSources } from '../src/utils/budgetPerformanceSource.js'
const now=new Date('2026-10-21T15:00:00Z'), range={start:'2026-10-01',end:'2026-10-21'}
const sites=[{id:'a',timezone:'America/New_York',show_budget_tracking:true,opportunities_formula:'simple'},{id:'b',timezone:'America/New_York',show_budget_tracking:true,opportunities_formula:'detailed'}]
const day=(id,date,loss=4)=>[
 {location_id:id,log_date:date,time_slot:'08:00:00',split_index:0,plans_lost_today:loss,basic:0,reactivations:0},
 {location_id:id,log_date:date,time_slot:'10:00:00',split_index:0,basic:5,reactivations:2},
 {location_id:id,log_date:date,time_slot:'10:00:00',split_index:1,basic:6,reactivations:3},
]
const snapshot=(id='a',extra={})=>({location_id:id,starting_members:100,active_members:110,covered_through:'2026-10-20',...extra})
test('Today uses latest cumulative split, losses once and detailed reactivations once',()=>{
 const logs=[...day('a','2026-10-21'),...day('b','2026-10-21')]
 const source=selectTodayPerformance(logs,sites,now)
 assert.equal(source.netMembers.a.value,2)
 assert.equal(source.netMembers.b.value,5)
 assert.equal(selectTodayPerformance(day('a','2026-10-21',null),sites,now).netMembers.a.value,null)
 assert.equal(selectTodayPerformance(day('a','2026-10-21',0),sites,now).netMembers.a.value,6)
 const opening=selectTodayPerformance([day('a','2026-10-21')[0]],sites,now)
 assert.equal(opening.netMembers.a.value,-4)
 assert.equal(opening.totals.length,1)
})
test('MTD snapshot covers earlier days; only subsequent final daily balances are added',()=>{
 const logs=[...day('a','2026-10-19',999),...day('a','2026-10-20',999),...day('a','2026-10-21'),...day('b','2026-10-21')]
 const result=selectMtdNetMembers(logs,[snapshot(),snapshot('b')],sites,range,now)
 assert.equal(result.a.value,12)
 assert.equal(result.b.value,15)
 assert.equal(result.a.snapshotThrough,'2026-10-20')
 assert.equal(result.a.through,'2026-10-21')
})
test('stale snapshot tail includes each completed day and current running day exactly once',()=>{
 const logs=[...day('a','2026-10-19'),...day('a','2026-10-20'),...day('a','2026-10-21')]
 const result=selectMtdNetMembers(logs,[snapshot('a',{covered_through:'2026-10-18'})],sites,range,now)
 assert.equal(result.a.value,16)
 const gap=selectMtdNetMembers(logs.filter(r=>r.log_date!=='2026-10-20'),[snapshot('a',{covered_through:'2026-10-18'})],sites,range,now)
 assert.equal(gap.a.value,null)
 assert.match(gap.a.message,/2026-10-20/)
})
test('missing baseline/current headcount/coverage or uncovered loss stays unavailable; explicit zeros are valid',()=>{
 for(const extra of [{starting_members:null},{active_members:null},{starting_members:''},{covered_through:null},{covered_through:'2026-09-30'},{covered_through:'2026-10-21'}]) {
  assert.equal(selectMtdNetMembers(day('a','2026-10-21'),[snapshot('a',extra)],sites,range,now).a.value,null)
 }
 assert.equal(selectMtdNetMembers([],[],sites,range,now).a.value,null)
 assert.equal(selectMtdNetMembers(day('a','2026-10-21',null),[snapshot()],sites,range,now).a.value,null)
 assert.equal(selectMtdNetMembers(day('a','2026-10-21',6),[snapshot('a',{starting_members:0,active_members:0})],sites,range,now).a.value,0)
})
test('historical signed and explicitly legacy zero Net Members survive without loss fabrication',()=>{
 const manual=[{location_id:'a',log_date:'2026-10-21',time_slot:'09:00:00',net_members:-3,net_members_legacy:true}]
 assert.equal(dashboardDailyNet(manual),-3)
 assert.equal(selectMtdNetMembers(manual,[snapshot()],sites,range,now).a.value,7)
 assert.equal(dashboardDailyNet([{time_slot:'08:00',net_members:0}]),null)
 assert.equal(dashboardDailyNet([{time_slot:'08:00',net_members:0,net_members_legacy:true}]),0)
 assert.equal(manual[0].net_members,-3)
})
test('site-local rollover and existing common MTD range are preserved',()=>{
 const locations=[sites[0],{...sites[1],timezone:'America/Los_Angeles'}]
 const boundary=new Date('2027-01-01T05:30:00Z')
 const r=currentMtdRange(locations,boundary)
 assert.deepEqual(r,{start:'2026-12-01',end:'2026-12-31'})
 const logs=[...day('a','2026-12-31'),...day('a','2027-01-01'),...day('b','2026-12-31')]
 assert.equal(selectTodayPerformance(logs,locations,boundary).netMembers.a.through,'2027-01-01')
 assert.equal(selectTodayPerformance(logs,locations,boundary).netMembers.b.through,'2026-12-31')
 const net=selectMtdNetMembers(logs,[snapshot('a',{covered_through:'2026-12-30'}),snapshot('b',{covered_through:'2026-12-30'})],locations,r,boundary)
 assert.equal(net.a.value,12);assert.equal(net.b.value,15)
})
test('signed sorting keeps missing values last in either direction',()=>{
 for(const direction of ['asc','desc']) {
  const sorted=[null,0,5,-4,null].sort((a,b)=>compareNetMembers(a,b,direction))
  assert.deepEqual(sorted,direction==='asc'?[-4,0,5,null,null]:[5,0,-4,null,null])
 }
})
test('RPC projection is read-only, range-scoped, whitelisted, and fails without raw-table fallback',async()=>{
 const client={async rpc(name,args){assert.equal(name,'dashboard_membership_snapshots');assert.deepEqual(args,{p_location_ids:['a','b'],p_month_start:range.start,p_through_date:range.end});return {data:[snapshot('a',{cash:999}),snapshot('other')]}}}
 assert.deepEqual(await loadMembershipSnapshots(client,sites,range),[snapshot()])
 await assert.rejects(loadMembershipSnapshots({async rpc(){return {error:{message:'denied'}}}},sites,range),/unavailable/)
})
test('other MTD counts preserve Budget priority and completed-date cutoff',()=>{
 const entry={location_id:'a',entry_date:'2026-10-21',mtd_washes:100,mtd_redemptions:40,mtd_basic:10,mtd_good:0,mtd_better:0,mtd_best:0,current_reviews:3}
 const existing=selectPerformanceSources(day('a','2026-10-21'),[entry],sites,range,'2026-10-21')
 assert.equal(existing.totals[0].total_washes,100)
 assert.equal(existing.totals[0].log_date,'2026-10-20')
 assert.equal(existing.cutoff,'2026-10-20')
})
