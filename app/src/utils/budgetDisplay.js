import { revenueCents, revenuePresentation } from './budgetRevenue.js'
import { monthProgress } from './budgetMath.js'

export function revenueDisplayPlan(revenue, historical, monthlyGoal) {
  const reported = revenuePresentation(revenue, historical)
  const progress = reported.reportingDate ? monthProgress(reported.reportingDate) : null
  const goalCents = revenueCents(monthlyGoal)
  const expected = goalCents != null && goalCents > 0 && progress != null
    ? Math.round(goalCents * progress) / 100 : null
  return { reported, expected, progress, onTrack: reported.amount != null && expected != null ? reported.amount >= expected : null }
}
export const displayCount = value => value === '' || value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US')
export const displayMoney = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
