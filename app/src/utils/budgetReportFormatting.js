import { cashRevenue, revenueCents, revenueError, shiftDate } from './budgetRevenue.js'
import { membershipPace, yesterdayMetrics, mtdMetrics } from './budgetMath.js'
import { reportThresholdStatus } from './metricColors.js'

const nonnegative = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0
const savedCents = value => value != null && /^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null
const validCounts = (entry, prefix) => !!entry && ['washes','redemptions','basic','good','better','best'].every(key => {
  const v = entry[`${prefix}_${key}`]
  return nonnegative(v) && Number.isSafeInteger(Number(v))
}) && Number(entry[`${prefix}_redemptions`]) <= Number(entry[`${prefix}_washes`])

// Read the saved reconciliation; never infer balance from absent snapshots or
// recompute/replace the saved variance using today's Cash on Hand setting.
export function reportCash(entry, reportingDate) {
  const fresh = entry?.entry_date === reportingDate
  const amount = entry && !revenueError(entry) ? cashRevenue(entry) : null
  const count = revenueCents(entry?.yesterday_cash_counted)
  const hand = savedCents(entry?.cash_on_hand_cents)
  const variance = savedCents(entry?.cash_variance_cents)
  const saved = amount != null && amount >= 0 && count != null && hand != null && hand >= 0
    && savedCents(entry?.cash_on_hand_version_id) > 0 && !!entry?.cash_first_submitted_at
    && Number.isFinite(Date.parse(entry.cash_first_submitted_at)) && variance != null
  return { amount, variance: saved ? variance : null,
    status: !fresh || !saved ? 'neutral' : variance === 0 ? 'green' : 'red',
    note: !fresh ? entry ? `Stale · business date ${shiftDate(entry.entry_date, -1)}` : 'No daily entry'
      : !saved ? 'Reconciliation unavailable' : variance === 0 ? 'Reconciled' : variance < 0 ? 'Shortage' : 'Overage' }
}

export function reportMetricFormatting(entry, target, location, reportingDate, plan, reported) {
  const fresh = entry?.entry_date === reportingDate
  const yst = yesterdayMetrics(entry), mtd = mtdMetrics(entry)
  const ystValid = fresh && validCounts(entry, 'yesterday'), mtdValid = fresh && validCounts(entry, 'mtd')
  const thresholds = location?.metric_thresholds
  const membersValid = fresh && nonnegative(entry?.mtd_membership_actual) && Number.isSafeInteger(Number(entry.mtd_membership_actual))
    && nonnegative(target?.starting_members) && Number.isSafeInteger(Number(target.starting_members))
    && (target?.membership_daily_growth == null || target.membership_daily_growth === '' || nonnegative(target.membership_daily_growth))
  const membership = membersValid ? membershipPace(entry.mtd_membership_actual, target.starting_members, target.membership_daily_growth, reportingDate) : { onTrack: null }
  const revenueVerified = fresh && !reported?.provisional && reported?.throughDate === shiftDate(reportingDate, -1)
  return {
    yesterdayAvailable: validCounts(entry, 'yesterday'),
    mtdAvailable: validCounts(entry, 'mtd'),
    yesterdayConversion: reportThresholdStatus(yst.conversion, 'conv_yellow', thresholds, ystValid),
    yesterdayPmix: reportThresholdStatus(yst.pmix, 'pmix_green', thresholds, ystValid),
    mtdConversion: reportThresholdStatus(mtd.conversion, 'conv_yellow', thresholds, mtdValid),
    mtdPmix: reportThresholdStatus(mtd.pmix, 'pmix_green', thresholds, mtdValid),
    revenue: !revenueVerified || plan?.onTrack == null ? 'neutral' : plan.onTrack ? 'green' : 'red',
    membershipOnTrack: membership.onTrack,
    provisional: !!reported?.provisional,
    stale: !fresh,
  }
}

export const varianceLabel = cents => cents == null || cents === 0 ? '' : `(${cents < 0 ? '-' : '+'}${(Math.abs(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`
