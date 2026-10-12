import { revenuePresentation } from './budgetRevenue.js'
import { monthProgress, revenuePace } from './budgetMath.js'

export function reportedRevenuePace(revenue, historical, goal) {
  const reported = revenuePresentation(revenue, historical)
  return { reported, ...revenuePace(reported.amount, goal,
    reported.reportingDate ? monthProgress(reported.reportingDate) : 0) }
}
