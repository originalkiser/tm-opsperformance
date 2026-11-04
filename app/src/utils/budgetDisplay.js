import { revenueCents, revenuePresentation, usesReportedMtd } from './budgetRevenue.js'
import { monthProgress } from './budgetMath.js'
import { sumDailyRevenueGoals } from './dailyRevenueGoals.js'

export function revenueDisplayPlan(revenue, historical, monthlyGoal, reportingDate = null, dailyGoals = null, locationId = null) {
  const reported = revenuePresentation(revenue, historical)
  const modern = usesReportedMtd(reportingDate || reported.reportingDate || '')
  const date = modern ? reported.reportingDate : reportingDate || reported.reportingDate
  const legacyProgress = date ? monthProgress(date) : null
  const goalCents = revenueCents(monthlyGoal)
  const dailyPlan = modern && reported.throughDate ? sumDailyRevenueGoals(dailyGoals, locationId, reported.throughDate) : null
  const expected = modern ? dailyPlan?.amount ?? null : goalCents != null && goalCents > 0 && legacyProgress != null
    ? Math.round(goalCents * legacyProgress) / 100 : null
  const monthly = monthlyGoal !== '' && monthlyGoal != null && Number(monthlyGoal) > 0 ? Number(monthlyGoal) : null
  const progress = modern ? expected != null && monthly != null ? expected / monthly : null : legacyProgress
  return { reported, expected, progress, dailyPlan, onTrack: reported.amount != null && expected != null ? reported.amount >= expected : null }
}
export const displayCount = value => value === '' || value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US')
export const displayMoney = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
