import { computeScore, rankByScore, yesterdayMetrics, mtdMetrics, membershipStatus, daysElapsed, daysInMonth } from './budgetMath.js'
import { calculateMtdRevenue, latestHistoricalRevenue, revenuePresentation, shiftDate } from './budgetRevenue.js'
import { DEFAULT_THRESHOLDS } from './metricColors.js'
import { PERFORMANCE_DAILY_FIELDS, isPerformanceEntryComplete } from './budgetDailyFields.js'

export const SCORE_WEIGHTS = Object.freeze({ conversion: 20, revenue: 20, pmix: 10, washes: 10, revenuePlan: 15, growth: 15, rating: 10 })
export const SCORE_LABELS = { conversion: 'MTD Conversion', revenue: 'MTD Total Revenue', pmix: 'MTD P-Mix', washes: 'MTD Total Washes', revenuePlan: 'Revenue to Plan', growth: 'Membership Growth', rating: 'Google Rating' }
const number = v => v == null || String(v).trim() === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v)
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
  const tierFields = ['mtd_basic', 'mtd_good', 'mtd_better', 'mtd_best']
  const validTiers = entry => tierFields.every(key => count(entry[key]) != null)
  const validCounts = entry => !!entry && validTiers(entry) && count(entry.mtd_washes) != null
    && count(entry.mtd_redemptions) != null && Number(entry.mtd_redemptions) <= Number(entry.mtd_washes)
  const rows = eligible.map(loc => {
    const issues = [], componentIssues = {}, componentSources = {}
    const problem = (key, message) => { componentIssues[key] = message; issues.push(message) }
    const targetRows = targets.filter(t => t.location_id === loc.id && t.target_month === month)
    const target = targetRows.length === 1 ? targetRows[0] : null
    if (targetRows.length > 1) issues.push('Duplicate monthly targets; target-dependent categories unavailable')
    const siteEntries = entries.filter(e => e.location_id === loc.id && e.entry_date >= month && e.entry_date <= reportingDate)
    const latest = [...siteEntries].sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0]
    const dates = new Map()
    for (const entry of siteEntries) dates.set(entry.entry_date, [...(dates.get(entry.entry_date) || []), entry])
    const snapshots = [...dates.values()].filter(group => group.length === 1 && group[0].entry_date > month)
      .map(group => group[0]).sort((a, b) => b.entry_date.localeCompare(a.entry_date))
    const pick = (key, valid) => {
      const entry = elapsed > 0 ? snapshots.find(valid) : null
      if (entry) componentSources[key] = { entryDate: entry.entry_date, throughDate: shiftDate(entry.entry_date, -1), source: 'Budget snapshot' }
      return entry
    }
    const exact = dates.get(reportingDate) || []
    const entry = exact.length === 1 ? exact[0] : null
    if (!entry) issues.push(exact.length > 1 ? 'Duplicate entry for reporting date' : `Missing entry for ${reportingDate}${latest ? '; latest is ' + latest.entry_date : ''}`)
    const dailyEntryComplete = isPerformanceEntryComplete(entry)
    if (entry && !dailyEntryComplete) issues.push('Daily reporting entry incomplete or invalid')
    const missingEntryFields = entry ? PERFORMANCE_DAILY_FIELDS.filter(f => entry[f.key] == null || entry[f.key] === '').map(f => f.label) : []
    const missingReportingDates = [], incompleteReportingDates = []
    for (let date = shiftDate(month, 1); date <= reportingDate; date = shiftDate(date, 1)) {
      const group = dates.get(date)
      if (!group) missingReportingDates.push(date)
      else if (group.length !== 1 || !isPerformanceEntryComplete(group[0])) incompleteReportingDates.push(date)
    }
    if (missingReportingDates.length) issues.push(`${missingReportingDates.length} missing reporting date(s)`)
    if (incompleteReportingDates.length) issues.push(`${incompleteReportingDates.length} incomplete or ambiguous reporting date(s)`)
    if (elapsed === 0) issues.push('No completed business days in this month yet; monthly scoring points are zero')
    const balanceRows = balances.filter(b => b.location_id === loc.id && b.revenue_month === month)
    let revenue, historical, revenueSourceError = null
    try {
      if (balanceRows.length > 1) throw new Error('Duplicate starting balance for this month')
      revenue = calculateMtdRevenue(entries, loc.id, reportingDate, balanceRows[0])
      historical = latestHistoricalRevenue(entries, loc.id, reportingDate, revenue.startingBalance)
    } catch (error) {
      revenueSourceError = error.message
      revenue = { complete: false, total: null, recordedTotal: null, missingDates: [], throughDate: businessDate, startingBalance: null }
    }
    const reported = revenuePresentation(revenue, historical)
    const revenueReady = elapsed > 0 && revenue.complete && revenue.throughDate === businessDate && !revenueSourceError
    if (!revenueReady) issues.push(revenueSourceError ? `Revenue source invalid: ${revenueSourceError}` : `Revenue incomplete for ${businessDate}${reported.provisional ? '; provisional source through ' + reported.throughDate : ''}`)
    // This is a scoring numerator, not a claim of complete verified MTD revenue.
    // Preserve the existing single-source presentation; never add a partial daily
    // subtotal to a baseline/historical cumulative fallback.
    const scoringRevenue = elapsed > 0 && !revenueSourceError ? number(reported.amount) : null
    if (scoringRevenue != null) componentSources.revenue = componentSources.revenuePlan = {
      source: reported.source, throughDate: reported.throughDate, provisional: reported.provisional,
    }
    const conversionEntry = pick('conversion', validCounts)
    const pmixEntry = pick('pmix', validTiers)
    const washEntry = pick('washes', e => count(e.mtd_washes) != null)
    const memberEntry = pick('growth', e => count(e.mtd_membership_actual) != null)
    const ratingEntry = pick('rating', e => number(e.current_rating) != null && Number(e.current_rating) <= 5)
    const metrics = conversionEntry ? mtdMetrics(conversionEntry) : null
    const pmixMetrics = pmixEntry ? mtdMetrics(pmixEntry) : null
    const conversionGoal = number(loc.metric_thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow)
    const pmixGoal = number(loc.metric_thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green)
    const currentMembers = count(memberEntry?.mtd_membership_actual), baseline = count(target?.starting_members), dailyGrowth = number(target?.membership_daily_growth)
    const growth = currentMembers != null && baseline != null ? currentMembers - baseline : null
    const expectedGrowth = dailyGrowth != null ? dailyGrowth * elapsed : null
    const goal = number(target?.revenue_goal), rating = number(ratingEntry?.current_rating), ratingGoal = number(target?.desired_rating)
    const expectedRevenue = goal != null ? Math.round(goal * 100 * elapsed / daysInMonth(reportingDate)) / 100 : null
    const components = {
      conversion: cappedPoints(metrics?.conversion, conversionGoal != null ? conversionGoal / 100 : null, SCORE_WEIGHTS.conversion),
      revenue: null,
      pmix: cappedPoints(pmixMetrics ? (pmixMetrics.plansSold === 0 ? 0 : pmixMetrics.pmix) : null, pmixGoal != null ? pmixGoal / 100 : null, SCORE_WEIGHTS.pmix),
      washes: null,
      revenuePlan: cappedPoints(scoringRevenue, expectedRevenue, SCORE_WEIGHTS.revenuePlan),
      growth: cappedPoints(growth, expectedGrowth, SCORE_WEIGHTS.growth),
      rating: cappedPoints(rating, ratingGoal != null && ratingGoal <= 5 ? ratingGoal : null, SCORE_WEIGHTS.rating),
    }
    if (scoringRevenue == null) problem('revenue', 'No supported MTD revenue source; 0 points')
    if (components.conversion == null) problem('conversion', 'Conversion target/data unavailable or no retail opportunities; 0 points')
    if (components.pmix == null) problem('pmix', 'P-Mix target or tier counts unavailable; 0 points')
    if (!washEntry) problem('washes', 'MTD wash count unavailable; 0 points')
    if (components.revenuePlan == null) problem('revenuePlan', 'Revenue-to-plan unavailable: missing revenue/positive goal or no elapsed days; 0 points')
    if (components.growth == null) problem('growth', expectedGrowth === 0 ? 'Expected net growth is zero; 0 points (no division by zero)' : 'Current members, month-start members or net-growth target unavailable; 0 points')
    if (components.rating == null) problem('rating', 'Rating or rating target missing/invalid (valid range 0–5); 0 points')
    const oldMetrics = mtdMetrics(latest), oldYesterday = yesterdayMetrics(latest)
    const oldMem = membershipStatus(latest?.mtd_membership_actual, target?.membership_goal, reportingDate)
    const oldScore = latest ? computeScore({ yesterdayConv: oldYesterday.conversion, mtdConv: oldMetrics.conversion, mtdPmix: oldMetrics.pmix, membershipProgressRatio: oldMem.progressRatio, currentRating: latest.current_rating }) : null
    return { id: loc.id, site: loc.name, entry, loc, reportingDate, businessDate, lastEntryDate: latest?.entry_date ?? null,
      oldScore, oldDate: latest?.entry_date, components, componentIssues, componentSources, issues,
      candidate: true, target, revenueResult: revenue, historicalRevenue: historical ?? null, revenueSourceError, revenue: revenueReady ? revenue.total : null, scoringRevenue, washes: washEntry ? Number(washEntry.mtd_washes) : null,
      reportedRevenue: reported.amount, reportedThrough: reported.throughDate, provisionalRevenue: reported.provisional,
      growth, expectedGrowth, expectedRevenue, conversionGoal, pmixGoal,
      completeness: { entryPresent: !!entry, dailyEntryComplete, missingEntryFields,
        mtdCountsValid: validCounts(entry), revenueComplete: revenueReady,
        missingRevenueDates: revenue.missingDates || [], missingReportingDates, incompleteReportingDates } }
  })
  // Every eligible site remains in the pool. Valid-value relative ranking and
  // occupied-position tie handling are unchanged; missing/single values earn 0.
  const revenuePoints = competitivePoints(rows, 'scoringRevenue', SCORE_WEIGHTS.revenue)
  const washesPoints = competitivePoints(rows, 'washes', SCORE_WEIGHTS.washes)
  for (const r of rows) {
    r.components.revenue = revenuePoints.get(r.id) ?? null
    r.components.washes = washesPoints.get(r.id) ?? null
    if (r.scoringRevenue != null && !revenuePoints.has(r.id)) r.componentIssues.revenue = 'Fewer than two valid revenue values; 0 competitive points'
    if (r.washes != null && !washesPoints.has(r.id)) r.componentIssues.washes = 'Fewer than two valid wash values; 0 competitive points'
    r.availableWeight = Object.entries(r.components).filter(([, v]) => v != null).reduce((sum, [key]) => sum + SCORE_WEIGHTS[key], 0)
    r.completeness.scoredCategories = Object.values(r.components).filter(v => v != null).length
    r.components = Object.fromEntries(Object.entries(r.components).map(([key, value]) => [key, value ?? 0]))
    r.score = Math.max(0, Math.min(100, Math.round(Object.values(r.components).reduce((sum, value) => sum + value, 0) * 10) / 10))
  }
  const ranks = competitionRanks(rows)
  const oldRanks = new Map(rankByScore(rows.map(r => ({ ...r, score: r.oldScore }))).filter(r => r.oldScore != null).map(r => [r.id, r.rank]))
  for (const r of rows) { r.rank = ranks.get(r.id); r.oldRank = oldRanks.get(r.id) ?? null }
  rows.sort((a, b) => b.score - a.score || a.site.localeCompare(b.site))
  return { reportingDate, businessDate, competitiveSites: rows.length,
    competitiveValues: { revenue: rows.filter(r => r.scoringRevenue != null).length, washes: rows.filter(r => r.washes != null).length },
    rows, excluded: locations.filter(l => !eligible.includes(l)).map(l => ({site: l.name, reason: l.exclude_from_reporting ? 'Excluded from reporting' : 'Budget Tracking disabled'})) }
}
