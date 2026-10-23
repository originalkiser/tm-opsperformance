import { revenuePresentation } from './budgetRevenue.js'
import { monthProgress, revenuePace } from './budgetMath.js'

export function reportedRevenuePace(revenue, historical, goal, reportingDate = null) {
  const reported = revenuePresentation(revenue, historical)
  return { reported, ...revenuePace(reported.amount, goal,
    (reportingDate || reported.reportingDate) ? monthProgress(reportingDate || reported.reportingDate) : 0) }
}
