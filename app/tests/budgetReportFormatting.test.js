import test from 'node:test'
import assert from 'node:assert/strict'
import { reportCash, reportMetricFormatting, varianceLabel } from '../src/utils/budgetReportFormatting.js'
import { REPORT_STATUS_CLS, reportThresholdStatus, DEFAULT_THRESHOLDS } from '../src/utils/metricColors.js'

const entry = () => ({ entry_date: '2026-10-15', yesterday_total_revenue: 1165.25, yesterday_cc_revenue: 1000, yesterday_house_revenue: 46.25,
  yesterday_cash_counted: 969, cash_on_hand_cents: 85000, cash_on_hand_version_id: 1,
  cash_first_submitted_at: '2026-10-15T12:00:00Z', cash_variance_cents: 0,
  mtd_washes: 200, mtd_redemptions: 100, mtd_basic: 2, mtd_good: 2, mtd_better: 3, mtd_best: 3,
  yesterday_washes: 200, yesterday_redemptions: 100, yesterday_basic: 2, yesterday_good: 2, yesterday_better: 3, yesterday_best: 3,
  mtd_membership_actual: 128 })
const target = { starting_members: 100, membership_daily_growth: 2 }
const reported = { provisional: false, throughDate: '2026-10-14' }
const format = (row=entry(), t=target, loc={}, plan={onTrack:true}, revenue=reported) => reportMetricFormatting(row,t,loc,'2026-10-15',plan,revenue)

test('cash displays calculated revenue, exact saved reconciliation green, signed shortages/overages red',()=>{
  const row=entry(), before=JSON.stringify(row)
  assert.deepEqual(reportCash(row,'2026-10-15'),{amount:119,variance:0,status:'green',note:'Reconciled'})
  assert.equal(JSON.stringify(row),before)
  assert.equal(varianceLabel(0),'')
  row.yesterday_cash_counted=968;row.cash_variance_cents=-100
  let cash=reportCash(row,'2026-10-15');assert.equal(cash.amount,119);assert.equal(cash.status,'red');assert.equal(cash.note,'Shortage');assert.equal(varianceLabel(cash.variance),'(-$1.00)')
  row.yesterday_cash_counted=970;row.cash_variance_cents=100
  cash=reportCash(row,'2026-10-15');assert.equal(cash.status,'red');assert.equal(cash.note,'Overage');assert.equal(varianceLabel(cash.variance),'(+$1.00)')
  assert.equal(varianceLabel(1),'(+$0.01)');assert.equal(varianceLabel(-1),'(-$0.01)')
})
test('missing or invalid snapshots never count as balanced, even with a stored zero variance',()=>{
  for(const [key, value] of [['yesterday_cash_counted',null],['yesterday_cash_counted',''],['yesterday_cash_counted',-1],['cash_on_hand_cents',null],['cash_on_hand_cents',-1],['cash_on_hand_version_id',null],['cash_on_hand_version_id',''],['cash_variance_cents',null],['cash_variance_cents',''],['cash_variance_cents',0.5],['cash_first_submitted_at',null],['cash_first_submitted_at','invalid']]){
    const row={...entry(),[key]:value};const cash=reportCash(row,'2026-10-15');assert.equal(cash.status,'neutral',key);assert.equal(cash.variance,null,key);assert.equal(cash.amount,119)
  }
  assert.equal(reportCash(null,'2026-10-15').status,'neutral')
  assert.equal(reportCash({...entry(),yesterday_cc_revenue:null},'2026-10-15').amount,null)
  assert.equal(reportCash({...entry(),yesterday_cc_revenue:2000},'2026-10-15').amount,null)
})
test('zero cash count and zero fixed cash are valid; stale records remain neutral and dated',()=>{
  const row={...entry(),yesterday_total_revenue:100,yesterday_cc_revenue:100,yesterday_house_revenue:0,yesterday_cash_counted:0,cash_on_hand_cents:0}
  assert.equal(reportCash(row,'2026-10-15').status,'green')
  row.cash_variance_cents=-99
  assert.equal(reportCash(row,'2026-10-15').variance,-99,'saved variance is displayed without recomputing or overwriting it')
  const stale=reportCash(row,'2026-10-16');assert.equal(stale.status,'neutral');assert.match(stale.note,/2026-10-14/);assert.equal(stale.variance,-99)
})
test('threshold boundaries use location configuration and full precision, not rounded display percentages',()=>{
  assert.equal(reportThresholdStatus(.10,'conv_yellow'), 'green')
  assert.equal(reportThresholdStatus(.09999,'conv_yellow'),'red')
  assert.equal(reportThresholdStatus(.6,'pmix_green'),'green')
  assert.equal(reportThresholdStatus(.59999,'pmix_green'),'red')
  assert.equal(reportThresholdStatus(.12,'conv_yellow',{conv_yellow:12}),'green')
  assert.equal(reportThresholdStatus(.11999,'conv_yellow',{conv_yellow:12}),'red')
  assert.equal(reportThresholdStatus(.7,'pmix_green',{pmix_green:75}),'red')
  assert.equal(reportThresholdStatus(.75,'pmix_green',{pmix_green:75}),'green')
  assert.equal(reportThresholdStatus(0,'conv_yellow',{conv_yellow:0}),'green')
  for(const value of [null,undefined,NaN,Infinity,-1])assert.equal(reportThresholdStatus(value,'conv_yellow'),'neutral')
  assert.equal(reportThresholdStatus(.5,'conv_yellow',{conv_yellow:'invalid'}),'neutral')
  assert.equal(reportThresholdStatus(.5,'conv_yellow',null,false),'neutral')
  assert.equal(DEFAULT_THRESHOLDS.conv_yellow,10);assert.equal(DEFAULT_THRESHOLDS.pmix_green,60)
  for(const cls of Object.values(REPORT_STATUS_CLS))assert.match(cls,/dark:/)
})
test('equivalent Yesterday/MTD metrics share thresholds; missing counts and stale data are neutral',()=>{
  let f=format();assert.equal(f.mtdConversion,'green');assert.equal(f.mtdPmix,'green');assert.equal(f.yesterdayConversion,'green');assert.equal(f.yesterdayPmix,'green')
  f=format(entry(),target,{metric_thresholds:{conv_yellow:11,pmix_green:61}});assert.equal(f.mtdConversion,'red');assert.equal(f.mtdPmix,'red')
  f=format({...entry(),mtd_basic:null});assert.equal(f.mtdConversion,'neutral');assert.equal(f.mtdPmix,'neutral');assert.equal(f.yesterdayConversion,'green')
  f=format({...entry(),entry_date:'2026-10-14'});assert.equal(f.mtdConversion,'neutral');assert.equal(f.yesterdayPmix,'neutral');assert.equal(f.revenue,'neutral');assert.equal(f.membershipOnTrack,null)
})
test('verified revenue uses the existing plan comparison; provisional, stale and unavailable revenue remain neutral',()=>{
  assert.equal(format().revenue,'green');assert.equal(format(entry(),target,{}, {onTrack:false}).revenue,'red')
  let f=format(entry(),target,{}, {onTrack:true}, {...reported,provisional:true});assert.equal(f.revenue,'neutral');assert.equal(f.provisional,true)
  assert.equal(format(entry(),target,{}, {onTrack:true},{...reported,throughDate:'2026-10-13'}).revenue,'neutral')
  assert.equal(format(entry(),target,{}, {onTrack:null}).revenue,'neutral')
})
test('membership presentation retains growth pace boundaries and defaults, with missing data neutral',()=>{
  assert.equal(format().membershipOnTrack,true)
  assert.equal(format({...entry(),mtd_membership_actual:127}).membershipOnTrack,false)
  assert.equal(format({...entry(),mtd_membership_actual:null}).membershipOnTrack,null)
  assert.equal(format(entry(),{...target,starting_members:null}).membershipOnTrack,null)
  assert.equal(format(entry(),{...target,membership_daily_growth:-1}).membershipOnTrack,null)
  assert.equal(format(entry(),{starting_members:100}).membershipOnTrack,true)
  assert.equal(format({...entry(),mtd_membership_actual:100},{...target,membership_daily_growth:0}).membershipOnTrack,true)
})
