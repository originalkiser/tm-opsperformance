import { revenueDisplayPlan } from './budgetDisplay.js'
import { usesReportedMtd } from './budgetRevenue.js'
import { revenuePace } from './budgetMath.js'

export function reportedRevenuePace(revenue, historical, goal, reportingDate = null, dailyGoals = null, locationId = null) {
  const plan = revenueDisplayPlan(revenue, historical, goal, reportingDate, dailyGoals, locationId)
  const pace = revenuePace(plan.reported.amount, goal, plan.progress)
  if (!usesReportedMtd(reportingDate || plan.reported.reportingDate || '')) return { reported: plan.reported, ...pace }
  return { reported: plan.reported, ...pace, onTrack: plan.onTrack,
    paceRatio: plan.expected > 0 && plan.reported.amount != null ? Math.min(1.5, plan.reported.amount / plan.expected) : 0 }
}
