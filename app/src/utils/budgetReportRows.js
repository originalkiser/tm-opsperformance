import { scoreBudgetLocations } from './budgetScoring.js'
import { calculateMtdRevenue, latestHistoricalRevenue } from './budgetRevenue.js'
import { reportedRevenuePace } from './budgetRevenueReporting.js'
import { yesterdayMetrics, mtdMetrics, membershipStatus, membershipPace, firstOfMonth, toDateStr } from './budgetMath.js'
import { reportCash, reportMetricFormatting } from './budgetReportFormatting.js'
import { revenueDisplayPlan } from './budgetDisplay.js'

// Both reports use the same morning entry date; its MTD ends the prior day.
export function budgetReportPeriod(range, today = toDateStr(new Date())) {
  const reportingDate = range?.end || today
  const supported = reportingDate <= today && (!range || range.start === firstOfMonth(reportingDate))
  return { reportingDate, supported }
}

export function buildBudgetReportRows({ locations, targets, entries: dailyEntries, balances: startingBalances }, reportingDate) {
  const month = firstOfMonth(reportingDate)
  const entries = dailyEntries.filter(e => e.entry_date >= month && e.entry_date <= reportingDate)
  const scoring = scoreBudgetLocations({ locations, targets, entries, balances: startingBalances }, reportingDate)
  return scoring.rows.map(scoringResult => {
    const loc = scoringResult.loc
    const target = targets.find(t => t.location_id === loc.id && t.target_month === month)
    const entry  = entries.filter(e => e.location_id === loc.id).sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0]
    const yst    = yesterdayMetrics(entry)
    const mtd    = mtdMetrics(entry)
    const revenue = calculateMtdRevenue(entries, loc.id, reportingDate, startingBalances.find(balance => balance.location_id === loc.id && balance.revenue_month === month))
    const historicalRevenue = latestHistoricalRevenue(entries, loc.id, reportingDate, revenue.startingBalance)
    const rev    = reportedRevenuePace(revenue, historicalRevenue, target?.revenue_goal)
    const mem    = membershipStatus(entry?.mtd_membership_actual, target?.membership_goal, reportingDate)
    const memPace = membershipPace(entry?.mtd_membership_actual, target?.starting_members, target?.membership_daily_growth, reportingDate)
    const plan = revenueDisplayPlan(revenue, historicalRevenue, target?.revenue_goal)
    const formatting = reportMetricFormatting(entry, target, loc, reportingDate, plan, rev.reported)
    const cash = reportCash(entry, reportingDate)
    return { loc, target, entry, yst, mtd, rev, mem, memPace, score: scoringResult.score, rank: scoringResult.rank, scoringResult, revenue, historicalRevenue, plan, formatting, cash }
  })
}
