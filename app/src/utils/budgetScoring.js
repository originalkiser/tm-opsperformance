import { computeScore, rankByScore, yesterdayMetrics, mtdMetrics, membershipStatus, daysElapsed, daysInMonth } from './budgetMath.js'
import { calculateMtdRevenue, latestHistoricalRevenue, revenuePresentation, shiftDate } from './budgetRevenue.js'
import { DEFAULT_THRESHOLDS } from './metricColors.js'
import { ALL_DAILY_FIELDS, isDayComplete } from './budgetDailyFields.js'

export const SCORE_WEIGHTS = Object.freeze({ conversion: 20, revenue: 20, pmix: 10, washes: 10, revenuePlan: 15, growth: 15, rating: 10 })
export const SCORE_LABELS = { conversion: 'MTD Conversion', revenue: 'MTD Total Revenue', pmix: 'MTD P-Mix', washes: 'MTD Total Washes', revenuePlan: 'Revenue to Plan', growth: 'Membership Growth', rating: 'Google Rating' }
const number = v => v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v)
const count = v => number(v) != null && Number.isSafeInteger(Number(v)) ? Number(v) : null
export function cappedPoints(value, target, weight) {
  if (value == null || !Number.isFinite(Number(value)) || !(target > 0) || !Number.isFinite(target)) return null
  return weight * Math.max(0, Math.min(1, value / target))
}

// Occupied rank positions are averaged for ties, then mapped linearly to points.
export function competitivePoints(rows, key, weight) {
  const sorted = rows.filter(r => number(r[key]) != null).sort((a, b) => b[key] - a[key])
  const n = sorted.length, result = new Map()
  if (n < 2) return result
  for (let start = 0; start < n;) {
    let end = start
    while (end + 1 < n && Number(sorted[end + 1][key]) === Number(sorted[start][key])) end++
    const averagePosition = (start + end) / 2 // zero-based occupied positions
    const points = weight * (1 - averagePosition / (n - 1))
    for (let i = start; i <= end; i++) result.set(sorted[i].id, points)
    start = end + 1
  }
  return result
}

export function competitionRanks(rows, scoreKey = 'score') {
  const sorted = [...rows].filter(r => r[scoreKey] != null).sort((a, b) => b[scoreKey] - a[scoreKey] || a.site.localeCompare(b.site))
  let rank = 0, previous = null
  return new Map(sorted.map((r, i) => { if (r[scoreKey] !== previous) rank = i + 1; previous = r[scoreKey]; return [r.id, rank] }))
}

export function scoreBudgetLocations({ locations = [], targets = [], entries = [], balances = [] }, reportingDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportingDate) || new Date(reportingDate + 'T00:00:00Z').toISOString().slice(0, 10) !== reportingDate) throw new Error('Invalid reporting date')
  const businessDate = shiftDate(reportingDate, -1), elapsed = daysElapsed(reportingDate), month = reportingDate.slice(0, 7) + '-01'
  const eligible = locations.filter(l => l.show_budget_tracking && !l.exclude_from_reporting)
  const rows = eligible.map(loc => {
    const issues = [], componentIssues = {}
    const problem = (key, message) => { componentIssues[key] = message; issues.push(message) }
    const targetRows = targets.filter(t => t.location_id === loc.id && t.target_month === month)
    const target = targetRows.length === 1 ? targetRows[0] : null
    const siteEntries = entries.filter(e => e.location_id === loc.id && e.entry_date >= month && e.entry_date <= reportingDate)
    const latest = [...siteEntries].sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0]
    const exact = siteEntries.filter(e => e.entry_date === reportingDate)
    const entry = exact.length === 1 ? exact[0] : null
    if (!entry) issues.push(exact.length > 1 ? 'Duplicate entry for reporting date' : `Missing entry for ${reportingDate}${latest ? '; latest is ' + latest.entry_date : ''}`)
    const dailyEntryComplete = isDayComplete(entry)
    if (entry && !dailyEntryComplete) issues.push('Daily reporting entry incomplete or invalid')
    const missingEntryFields = entry ? ALL_DAILY_FIELDS.filter(f => entry[f.key] == null || entry[f.key] === '').map(f => f.label) : []
    if (elapsed === 0) issues.push('No completed business days in this month yet')
    const balanceRows = balances.filter(b => b.location_id === loc.id && b.revenue_month === month)
    const revenue = calculateMtdRevenue(entries, loc.id, reportingDate, balanceRows.length === 1 ? balanceRows[0] : null)
    if (balanceRows.length > 1) issues.push('Duplicate starting balance for this month')
    const historical = latestHistoricalRevenue(entries, loc.id, reportingDate, revenue.startingBalance)
    const reported = revenuePresentation(revenue, historical)
    const revenueReady = elapsed > 0 && revenue.complete && revenue.throughDate === businessDate && balanceRows.length < 2
    if (!revenueReady) problem('revenue', `Revenue incomplete for ${businessDate}${reported.provisional ? '; provisional source through ' + reported.throughDate : ''}`)
    const fields = ['mtd_washes', 'mtd_redemptions', 'mtd_basic', 'mtd_good', 'mtd_better', 'mtd_best']
    const validCounts = !!entry && fields.every(k => count(entry[k]) != null) && Number(entry.mtd_redemptions) <= Number(entry.mtd_washes)
    const metrics = validCounts ? mtdMetrics(entry) : null
    if (!validCounts) problem('washes', 'Missing or invalid MTD wash/redemption/membership-tier counts')
    const conversionGoal = number(loc.metric_thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow)
    const pmixGoal = number(loc.metric_thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green)
    const currentMembers = count(entry?.mtd_membership_actual), baseline = count(target?.starting_members), dailyGrowth = number(target?.membership_daily_growth)
    const growth = currentMembers != null && baseline != null ? currentMembers - baseline : null
    const expectedGrowth = dailyGrowth != null ? dailyGrowth * elapsed : null
    const goal = number(target?.revenue_goal), rating = number(entry?.current_rating), ratingGoal = number(target?.desired_rating)
    const expectedRevenue = goal != null ? Math.round(goal * 100 * elapsed / daysInMonth(reportingDate)) / 100 : null
    const components = {
      conversion: cappedPoints(metrics?.conversion, conversionGoal != null ? conversionGoal / 100 : null, 20),
      revenue: null,
      pmix: cappedPoints(metrics ? (metrics.plansSold === 0 ? 0 : metrics.pmix) : null, pmixGoal != null ? pmixGoal / 100 : null, 10),
      washes: null,
      revenuePlan: cappedPoints(revenueReady ? revenue.total : null, expectedRevenue, 15),
      growth: cappedPoints(growth, expectedGrowth, 15),
      rating: cappedPoints(rating != null && rating <= 5 ? rating : null, ratingGoal != null && ratingGoal <= 5 ? ratingGoal : null, 10),
    }
    if (components.conversion == null) problem('conversion', 'Conversion target/data unavailable or no retail opportunities')
    if (components.pmix == null) problem('pmix', 'P-Mix target or tier counts unavailable')
    if (components.revenuePlan == null) problem('revenuePlan', 'Revenue-to-plan unavailable: incomplete revenue, missing/zero goal or no elapsed days')
    if (components.growth == null) problem('growth', expectedGrowth === 0 ? 'Expected net growth is zero; growth points unavailable (no division by zero)' : 'Current members, month-start members or net-growth target unavailable')
    if (components.rating == null) problem('rating', 'Rating or rating target missing/invalid (valid range 0–5)')
    const oldMetrics = mtdMetrics(latest), oldYesterday = yesterdayMetrics(latest)
    const oldMem = membershipStatus(latest?.mtd_membership_actual, target?.membership_goal, reportingDate)
    const oldScore = latest ? computeScore({ yesterdayConv: oldYesterday.conversion, mtdConv: oldMetrics.conversion, mtdPmix: oldMetrics.pmix, membershipProgressRatio: oldMem.progressRatio, currentRating: latest.current_rating }) : null
    return { id: loc.id, site: loc.name, entry, loc, reportingDate, businessDate, oldScore, oldDate: latest?.entry_date, components, componentIssues, issues,
      candidate: issues.length === 0, revenue: revenueReady ? revenue.total : null, washes: validCounts ? Number(entry.mtd_washes) : null,
      reportedRevenue: reported.amount, reportedThrough: reported.throughDate, provisionalRevenue: reported.provisional,
      growth, expectedGrowth, expectedRevenue, conversionGoal, pmixGoal,
      completeness: { entryPresent: !!entry, dailyEntryComplete, missingEntryFields, mtdCountsValid: validCounts, revenueComplete: revenueReady, missingRevenueDates: revenue.missingDates || [] } }
  })
  // Both competitive categories use this exact common pool and cutoff.
  const pool = rows.filter(r => r.candidate)
  const revenuePoints = competitivePoints(pool, 'revenue', 20), washesPoints = competitivePoints(pool, 'washes', 10)
  for (const r of rows) {
    if (r.candidate) { r.components.revenue = revenuePoints.get(r.id) ?? null; r.components.washes = washesPoints.get(r.id) ?? null }
    if (r.candidate && pool.length < 2) r.issues.push('Only one eligible location; official competitive score/rank withheld')
    r.availableWeight = Object.entries(r.components).filter(([, v]) => v != null).reduce((s, [k]) => s + SCORE_WEIGHTS[k], 0)
    r.previewPoints = r.availableWeight ? Math.round(Object.values(r.components).filter(v => v != null).reduce((s, v) => s + v, 0) * 10) / 10 : null
    r.score = r.issues.length === 0 && r.availableWeight === 100 ? Math.min(100, r.previewPoints) : null
    r.completeness.scoredCategories = Object.values(r.components).filter(v => v != null).length
  }
  const ranks = competitionRanks(rows)
  const oldRanks = new Map(rankByScore(rows.map(r => ({ ...r, score: r.oldScore }))).filter(r => r.oldScore != null).map(r => [r.id, r.rank]))
  for (const r of rows) { r.rank = ranks.get(r.id) ?? null; r.oldRank = oldRanks.get(r.id) ?? null }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.site.localeCompare(b.site))
  return { reportingDate, businessDate, competitiveSites: pool.length, rows, excluded: locations.filter(l => !eligible.includes(l)).map(l => ({site: l.name, reason: l.exclude_from_reporting ? 'Excluded from reporting' : 'Budget Tracking disabled'})) }
}
