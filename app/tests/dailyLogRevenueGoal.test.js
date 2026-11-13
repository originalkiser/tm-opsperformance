import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchDailyRevenueGoal } from '../src/utils/dailyRevenueGoals.js'
import { displayMoney } from '../src/utils/budgetDisplay.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'

function api(response) {
  const calls=[]
  const query={select(value){calls.push(['select',value]);return this},eq(key,value){calls.push(['eq',key,value]);return this},async maybeSingle(){calls.push(['maybeSingle']);return response}}
  return { calls, from(table){calls.push(['from',table]);return query} }
}
test('reads the exact imported target for the selected site/business date, without monthly distribution or prior-day offset',async()=>{
 const client=api({data:{total:'1234.56789'}})
 assert.equal(await fetchDailyRevenueGoal(client,'fictional-site','2026-11-01'),'1234.56789')
 assert.deepEqual(client.calls,[['from','budget_daily_revenue_goals'],['select','total:total_revenue_goal::text'],['eq','location_id','fictional-site'],['eq','business_date','2026-11-01'],['maybeSingle']])
})
test('explicit zero remains a goal; a missing goal is unavailable',async()=>{
 assert.equal(await fetchDailyRevenueGoal(api({data:{total:'0'}}),'site','2026-11-13'),'0')
 assert.equal(await fetchDailyRevenueGoal(api({data:null}),'site','2026-11-13'),null)
})
test('permission/query failures and invalid targets are not presented as valid goals',async()=>{
 const error=new Error('denied');await assert.rejects(fetchDailyRevenueGoal(api({error}),'site','2026-11-13'),error)
 for(const value of [-1,'-1','NaN','Infinity','',null,100])await assert.rejects(fetchDailyRevenueGoal(api({data:{total:value}}),'site','2026-11-13'),/nonnegative decimal/)
})
test('no site or date means no query',async()=>{
 const client={from(){assert.fail('No query without a complete scope')}}
 assert.equal(await fetchDailyRevenueGoal(client,null,'2026-11-13'),null);assert.equal(await fetchDailyRevenueGoal(client,'site',null),null)
})
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const setup=(fetcher,props={locationId:'a',businessDate:'2026-11-13'})=>locationHelpHarness('components/DailyLogRevenueGoal',{supabase:{},fetchDailyRevenueGoal:fetcher,displayMoney},props)
const goalText=h=>h.find(n=>n.type==='strong').props.children

test('renders a prominent, read-only formatted goal with existing Light/Dark styles',async()=>{
 const h=setup(async()=> '1234.56');await h.flush();assert.equal(goalText(h),'$1,234.56')
 assert.equal(h.find(n=>n.type==='input'),undefined);assert.equal(h.find(n=>n.props?.['aria-label']==='Daily Revenue Goal').props.role,'status')
 assert.match(h.find(n=>n.type==='strong').props.className,/text-lg.*text-tm-blue dark:text-tm-teal/)
 assert.match(h.find(n=>n.props?.role==='status').props.className,/text-right/)
})
test('site changes clear the old goal immediately; late responses cannot overwrite the current site',async()=>{
 const a=deferred(),b=deferred(),requests=[]
 const h=setup((client,site,date)=>{requests.push([site,date]);return site==='a'?a.promise:b.promise});h.render()
 h.props({locationId:'b',businessDate:'2026-11-13'});assert.equal(goalText(h),'No Daily Goal Set')
 b.resolve('400');await h.flush();assert.equal(goalText(h),'$400.00')
 a.resolve('999');await h.flush();assert.equal(goalText(h),'$400.00');assert.deepEqual(requests,[['a','2026-11-13'],['b','2026-11-13']])
})
test('date changes reload the goal; zero is displayed and missing/error goals show the specified fallback',async()=>{
 const requests=[];const h=setup(async(client,site,date)=>{requests.push(date);if(date==='2026-11-14')return '0';if(date==='2026-11-15')return null;if(date==='2026-11-16')throw Error('unavailable');return '250'})
 await h.flush();assert.equal(goalText(h),'$250.00')
 for(const [date,expected] of [['2026-11-14','$0.00'],['2026-11-15','No Daily Goal Set'],['2026-11-16','No Daily Goal Set']]){h.props({locationId:'a',businessDate:date});await h.flush();assert.equal(goalText(h),expected)}
 assert.deepEqual(requests,['2026-11-13','2026-11-14','2026-11-15','2026-11-16'])
})
test('unmounted requests cannot publish a stale goal',async()=>{
 const pending=deferred();const h=setup(()=>pending.promise);h.render();h.unmount();pending.resolve('100');await h.flush();assert.equal(goalText(h),'No Daily Goal Set')
})
test('goal is placed inside the existing wrapping toolbar after all left-side action buttons',()=>{
 const source=readFileSync(new URL('../src/components/DailyLogTable.jsx',import.meta.url),'utf8')
 const toolbar=source.slice(source.indexOf('{/* Toolbar */}'),source.indexOf('{saveError && (',source.indexOf('{/* Toolbar */}')))
 assert.match(toolbar,/tm-entry-log-toolbar flex flex-wrap/)
 for(const label of ['Switch to Card View','Employees','Columns','Copy','Paste Data','Start Downtime'])assert(toolbar.indexOf(label)>=0&&toolbar.indexOf(label)<toolbar.indexOf('<DailyLogRevenueGoal'))
 assert.match(toolbar,/ml-auto flex max-w-full flex-wrap items-center justify-end/)
 assert.match(toolbar,/<DailyLogRevenueGoal locationId=\{locationId\} businessDate=\{selectedDate\} \/>/)
 assert(!source.slice(source.indexOf('<table')).includes('<DailyLogRevenueGoal'))
})
