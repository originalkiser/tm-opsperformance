import test from 'node:test'
import assert from 'node:assert/strict'
import { competitivePoints, cappedPoints, competitionRanks, scoreBudgetLocations, SCORE_WEIGHTS } from '../src/utils/budgetScoring.js'

function fixture() {
  return { locations: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, show_budget_tracking: true })),
    targets: ['a', 'b', 'c', 'd'].map(location_id => ({ location_id, target_month: '2026-10-01', revenue_goal: 3100, membership_goal: 162, starting_members: 100, membership_daily_growth: 2, desired_rating: 4.85 })),
    entries: ['a', 'b', 'c', 'd'].map((location_id, i) => ({ location_id, entry_date: '2026-10-03', yesterday_washes: 100, yesterday_redemptions: 80, yesterday_basic: 0, yesterday_good: 0, yesterday_better: 0, yesterday_best: 4, mtd_washes: 100 - i * 20, mtd_redemptions: 0, mtd_basic: 0, mtd_good: 0, mtd_better: 0, mtd_best: 10, mtd_membership_actual: 104, current_rating: 5, current_reviews: 10, yesterday_total_revenue: 0, yesterday_cc_revenue: 0, yesterday_house_revenue: 0 })),
    balances: ['a', 'b', 'c', 'd'].map((location_id, i) => ({ location_id, revenue_month: '2026-10-01', amount: 600 - i * 100, cutoff_business_date: '2026-10-02' })) }
}
test('all 20 eligible sites remain visible even with missing, stale, incomplete or provisional data',()=>{
  const base=fixture(),data={locations:[],targets:[],entries:[],balances:[]}
  for(let i=0;i<20;i++){
    const id=String(i);data.locations.push({...base.locations[0],id,name:'Site '+id});data.targets.push({...base.targets[0],location_id:id});data.balances.push({...base.balances[0],location_id:id})
    if(i!==0)data.entries.push({...base.entries[0],location_id:id,entry_date:i===1?'2026-10-02':'2026-10-03',mtd_best:i===2?null:10,yesterday_total_revenue:i===3?null:0})
    if(i===3)data.balances[i].cutoff_business_date='2026-10-01'
  }
  const r=scoreBudgetLocations(data,'2026-10-03');assert.equal(r.rows.length,20)
  for(const id of ['0','1','2','3']){const row=r.rows.find(x=>x.id===id);assert(Number.isInteger(row.rank));assert(Number.isFinite(row.score));assert(row.issues.length>0)}
})
test('submitting missing revenue and correcting historical revenue automatically rebuild scores and ranks',()=>{
  const data=fixture();data.balances[1].cutoff_business_date='2026-10-01';data.entries[1].yesterday_total_revenue=null
  assert.equal(scoreBudgetLocations(data,'2026-10-03').rows.find(r=>r.id==='b').revenue,null)
  assert(Number.isInteger(scoreBudgetLocations(data,'2026-10-03').rows.find(r=>r.id==='b').rank))
  data.entries[1].yesterday_total_revenue=200;data.entries[1].yesterday_cc_revenue=180
  let r=scoreBudgetLocations(data,'2026-10-03');assert.equal(r.competitiveSites,4);assert(r.rows.find(x=>x.id==='b').rank!=null)
  const before=r.rows.find(x=>x.id==='b').score;data.entries[1].yesterday_total_revenue=50;data.entries[1].yesterday_cc_revenue=40
  r=scoreBudgetLocations(data,'2026-10-03');assert.notEqual(r.rows.find(x=>x.id==='b').score,before)
  data.entries[0].entry_date='2026-10-04';data.entries[0].yesterday_total_revenue=100;data.entries[0].yesterday_cc_revenue=80
  r=scoreBudgetLocations(data,'2026-10-04');assert(r.rows.every(x=>Number.isInteger(x.rank)))
})
test('weights sum to 100; caps preserve unavailable values and negative growth', () => {
  assert.equal(Object.values(SCORE_WEIGHTS).reduce((a,b)=>a+b),100)
  assert.equal(cappedPoints(50,100,20),10); assert.equal(cappedPoints(1000,100,20),20)
  assert.equal(cappedPoints(-2,10,15),0); assert.equal(cappedPoints(null,10,15),null)
  assert.equal(cappedPoints(0,10,15),0); assert.equal(cappedPoints(1,0,15),null)
  assert.equal(cappedPoints(Infinity,10,15),null)
})
test('competitive scores average occupied positions, including tied highest/lowest and genuine zeros', () => {
  const p=competitivePoints([{id:'a',v:100},{id:'b',v:100},{id:'c',v:50},{id:'d',v:0},{id:'missing',v:null}], 'v',20)
  assert.equal(p.get('a'),20*5/6);assert.equal(p.get('a'),p.get('b'));assert.equal(p.get('d'),0)
  assert.equal(p.has('missing'),false)
  const q=competitivePoints([{id:'a',v:100},{id:'b',v:50},{id:'c',v:0},{id:'d',v:0}],'v',20)
  assert.ok(Math.abs(q.get('c')-20/6)<1e-9);assert.equal(q.get('c'),q.get('d'))
  assert.equal(competitivePoints([{id:'a',v:0},{id:'b',v:0}],'v',20).get('a'),10)
  assert.equal(competitivePoints([{id:'a',v:1}],'v',20).size,0)
})
test('official final ranking uses 1,2,2,4; unranked rows have no rank',()=>{
  assert.deepEqual([...competitionRanks([{id:'a',site:'a',score:100},{id:'b',site:'b',score:80},{id:'c',site:'c',score:80},{id:'d',site:'d',score:60},{id:'e',site:'e',score:null}])],[['a',1],['b',2],['c',2],['d',4]])
})
test('full scores share common pool/cutoff and all components are capped; no source mutations',()=>{
  const data=fixture(),before=JSON.stringify(data),result=scoreBudgetLocations(data,'2026-10-03')
  assert.equal(JSON.stringify(data),before);assert.equal(result.competitiveSites,4)
  assert.equal(result.businessDate,'2026-10-02');assert.equal(result.rows[0].score,100)
  for(const r of result.rows){assert(r.score<=100);for(const [k,v] of Object.entries(r.components))assert(v<=SCORE_WEIGHTS[k])}
  assert.equal(result.rows.find(r=>r.id==='d').components.revenue,0)
})
test('missing/provisional/stale data remains officially scored and ranked with completeness labels',()=>{
  const data=fixture();data.balances[1].cutoff_business_date='2026-10-01';data.entries[1].yesterday_total_revenue=null;data.entries[2].entry_date='2026-10-02';data.entries[3].mtd_best=null
  const result=scoreBudgetLocations(data,'2026-10-03')
  assert.equal(result.competitiveSites,4)
  for(const r of result.rows){assert(Number.isFinite(r.score));assert(Number.isInteger(r.rank))}
  const b=result.rows.find(r=>r.id==='b');assert(b.provisionalRevenue);assert(Number.isFinite(b.score));assert.equal(b.revenue,null);assert(b.issues.length>0)
  assert.equal(result.rows.find(r=>r.id==='c').completeness.entryPresent,false)
})
test('net growth corrections, zero growth target, negative growth and missing baseline are safe',()=>{
  const data=fixture();data.entries[0].mtd_membership_actual=98;data.targets[1].membership_daily_growth=0;data.targets[2].starting_members=null
  let r=scoreBudgetLocations(data,'2026-10-03')
  assert.equal(r.rows.find(x=>x.id==='a').components.growth,0)
  const b=r.rows.find(x=>x.id==='b');assert(Number.isFinite(b.score));assert.equal(b.components.growth,0);assert(b.issues.some(x=>x.includes('zero')))
  assert.equal(r.rows.find(x=>x.id==='c').components.growth,0)
  data.entries[0].mtd_membership_actual=102;r=scoreBudgetLocations(data,'2026-10-03');assert.equal(r.rows.find(x=>x.id==='a').components.growth,7.5)
})
test('defaults and site thresholds are preserved; invalid/duplicate categories receive zero without losing rank',()=>{
  const data=fixture();data.locations[0].metric_thresholds={conv_yellow:20,pmix_green:80}
  let r=scoreBudgetLocations(data,'2026-10-03');assert.equal(r.rows.find(x=>x.id==='a').components.conversion,10)
  data.entries[0].mtd_washes=0;data.entries[0].mtd_best=0
  data.entries[1].current_rating=7;data.entries[2].mtd_washes=10.5;data.entries.push({...data.entries[3]})
  r=scoreBudgetLocations(data,'2026-10-03');assert(r.rows.every(x=>Number.isFinite(x.score) && Number.isInteger(x.rank)))
  assert.equal(r.rows.find(x=>x.id==='a').components.pmix,0)
  assert.equal(r.rows.find(x=>x.id==='b').components.rating,0)
  assert.equal(r.rows.find(x=>x.id==='c').components.washes,0)
})
test('disabled/excluded sites cannot enter competitive pool; November does not use October balances',()=>{
  const data=fixture();data.locations[3].exclude_from_reporting=true;data.locations[2].show_budget_tracking=false
  assert.equal(scoreBudgetLocations(data,'2026-10-03').rows.length,2)
  let r=scoreBudgetLocations(data,'2026-11-01');assert(r.rows.every(x=>x.score===0 && x.rank===1));assert(r.rows.every(x=>x.reportedRevenue===0))
  data.targets=data.targets.map(t=>({...t,target_month:'2026-11-01'}));data.entries=data.entries.map(e=>({...e,entry_date:'2026-11-02',yesterday_total_revenue:100,yesterday_cc_revenue:80,yesterday_house_revenue:0}))
  r=scoreBudgetLocations(data,'2026-11-02');assert.equal(r.rows.find(x=>x.id==='a').revenue,100);assert.equal(r.businessDate,'2026-11-01')
})
test('overlapping daily entries are excluded by verified cutoff; missed days and corrections recalculate',()=>{
  const data=fixture();data.entries.push({...data.entries[0],entry_date:'2026-10-02',yesterday_total_revenue:999,yesterday_cc_revenue:999,yesterday_house_revenue:0})
  assert.equal(scoreBudgetLocations(data,'2026-10-03').rows.find(x=>x.id==='a').revenue,600)
  data.entries.forEach(e=>{if(e.entry_date==='2026-10-03'){e.yesterday_total_revenue=100;e.yesterday_cc_revenue=80;e.yesterday_house_revenue=0}})
  assert(scoreBudgetLocations(data,'2026-10-04').rows.every(x=>x.revenue===null && Number.isInteger(x.rank)))
  data.entries.push({...data.entries[0],entry_date:'2026-10-04',yesterday_total_revenue:200,yesterday_cc_revenue:180,yesterday_house_revenue:0})
  assert.equal(scoreBudgetLocations(data,'2026-10-04').rows.find(x=>x.id==='a').revenue,800)
  data.entries[0].yesterday_total_revenue=150
  assert.equal(scoreBudgetLocations(data,'2026-10-04').rows.find(x=>x.id==='a').revenue,800)
  data.entries.find(e=>e.location_id==='a'&&e.entry_date==='2026-10-04').yesterday_total_revenue=250
  assert.equal(scoreBudgetLocations(data,'2026-10-04').rows.find(x=>x.id==='a').revenue,850)
})

