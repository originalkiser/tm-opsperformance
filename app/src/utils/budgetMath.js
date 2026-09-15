// Budget Tracking calculations — ported from the MSMO budget workbook's
// Setup / Daily Input / Dashboard sheets.
//
// Field model (per calendar day, per location):
//   "Yesterday" fields  — raw counts for the single prior day
//   "MTD" fields        — running totals for the month so far
// All fields, including MTD Membership Actual, are typed in directly each
// day (not derived from prior rows or from other app data), matching the
// source workbook.

const toNum = (v) => (v === '' || v == null ? 0 : Number(v) || 0)

// ── Month helpers ───────────────────────────────────────────────────────────────

export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function firstOfMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function daysInMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

// Days elapsed THROUGH YESTERDAY, not including today — Yesterday/MTD figures
// are entered each morning for the prior day, so on the 1st this is 0 (nothing
// from this month has been entered yet) and on the 15th this is 14.
export function daysElapsed(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return Math.max(0, d.getDate() - 1)
}

// Fraction of the month elapsed as of yesterday (the 1st → 0, the 15th of a
// 30-day month → 14/30 ≈ 46.7%, the last day → (daysInMonth-1)/daysInMonth).
export function monthProgress(dateStr) {
  return daysElapsed(dateStr) / daysInMonth(dateStr)
}

// ── Yesterday / MTD derived metrics ──────────────────────────────────────────────
// plansSold = basic+good+better+best, retail = washes-redemptions,
// conversion = plans/retail, pmix = (better+best)/plans — all as fractions (0-1).

function derive(washes, redemptions, basic, good, better, best) {
  const plansSold = toNum(basic) + toNum(good) + toNum(better) + toNum(best)
  const retail    = Math.max(0, toNum(washes) - toNum(redemptions))
  return {
    plansSold,
    retail,
    conversion: retail > 0 ? plansSold / retail : null,
    pmix:       plansSold > 0 ? (toNum(better) + toNum(best)) / plansSold : null,
  }
}

export function yesterdayMetrics(entry) {
  if (!entry) return derive(0, 0, 0, 0, 0, 0)
  return derive(
    entry.yesterday_washes, entry.yesterday_redemptions,
    entry.yesterday_basic, entry.yesterday_good, entry.yesterday_better, entry.yesterday_best,
  )
}

export function mtdMetrics(entry) {
  if (!entry) return derive(0, 0, 0, 0, 0, 0)
  return derive(
    entry.mtd_washes, entry.mtd_redemptions,
    entry.mtd_basic, entry.mtd_good, entry.mtd_better, entry.mtd_best,
  )
}

// ── Revenue pace ──────────────────────────────────────────────────────────────

// On track when MTD Revenue % has kept pace with the fraction of the month elapsed.
export function revenuePace(mtdRevenueActual, revenueGoal, progress) {
  const pct = revenueGoal > 0 ? toNum(mtdRevenueActual) / revenueGoal : null
  if (pct == null) return { pct: null, onTrack: null, paceRatio: 0 }
  return {
    pct,
    onTrack: pct >= progress,
    paceRatio: progress > 0 ? Math.min(1.5, pct / progress) : 0,
  }
}

// ── Membership pace / bonus tier ─────────────────────────────────────────────────
// Bonus tiers mirror the workbook: goal alone = $50, goal + a month's typical
// volume = $100, goal + two months' worth = $200, otherwise Off Track.

export function membershipStatus(mtdMembershipActual, membershipGoal, dateStr) {
  const actual = toNum(mtdMembershipActual)
  const goal   = toNum(membershipGoal)
  const dim    = daysInMonth(dateStr)
  let tier = 'Off Track'
  if (goal > 0 || actual > 0) {
    if (actual >= goal + 2 * dim)      tier = '$200 Bonus'
    else if (actual >= goal + dim)     tier = '$100 Bonus'
    else if (actual >= goal)           tier = '$50 Bonus'
  }
  const progressRatio = goal > 0 ? Math.min(1.5, actual / goal) : 0
  return { tier, progressRatio, actual, goal }
}

// Default net-new-members-per-day pace when a target doesn't set its own.
export const DEFAULT_MEMBERSHIP_DAILY_GROWTH = 2

// End-of-month membership goal, derived from a starting headcount and a daily
// net-growth rate (e.g. 1,700 starting + 2/day × 30 days = 1,760 by month end).
export function computeMembershipGoal(startingMembers, dailyGrowth, dateStr) {
  if (startingMembers == null || startingMembers === '') return null
  const rate = dailyGrowth == null || dailyGrowth === '' ? DEFAULT_MEMBERSHIP_DAILY_GROWTH : Number(dailyGrowth)
  return Math.round(toNum(startingMembers) + rate * daysInMonth(dateStr))
}

// Day-by-day membership pace, the same shape as revenuePace: is MTD Membership
// Actual at or above where the daily growth rate says it should be by now
// (starting headcount + rate × days elapsed through yesterday)?
export function membershipPace(mtdMembershipActual, startingMembers, dailyGrowth, dateStr) {
  if (startingMembers == null || startingMembers === '') return { expected: null, onTrack: null, paceRatio: 0 }
  const rate     = dailyGrowth == null || dailyGrowth === '' ? DEFAULT_MEMBERSHIP_DAILY_GROWTH : Number(dailyGrowth)
  const expected = toNum(startingMembers) + rate * daysElapsed(dateStr)
  const actual   = toNum(mtdMembershipActual)
  return {
    expected,
    onTrack: expected > 0 ? actual >= expected : null,
    paceRatio: expected > 0 ? Math.min(1.5, actual / expected) : 0,
  }
}

// ── Composite score & rank ────────────────────────────────────────────────────
// Weights per the Dashboard sheet's documented intent:
//   Yesterday Conv 25% | MTD Conv 25% | MTD P-Mix 15% | Membership progress 25% | Rating 10%
// (The Daily Input sheet's live formula used different, inconsistent weights
// and referenced the raw membership count instead of a capped ratio — a bug
// in the source workbook that this intentionally does not reproduce.)

export function computeScore({ yesterdayConv, mtdConv, mtdPmix, membershipProgressRatio, currentRating }) {
  const conv1 = yesterdayConv ?? 0
  const conv2 = mtdConv ?? 0
  const pmix  = mtdPmix ?? 0
  const mem   = membershipProgressRatio ?? 0
  const rate  = currentRating ? currentRating / 5 : 0
  const raw = conv1 * 0.25 + conv2 * 0.25 + pmix * 0.15 + mem * 0.25 + rate * 0.10
  return Math.round(raw * 1000) / 10 // one decimal, 0-100ish scale
}

// Assigns dense ranks (ties share a rank, next rank continues sequentially —
// e.g. 1,2,2,3 not 1,2,2,4) to a list of { ...,score } objects, highest first.
export function rankByScore(rows) {
  const sorted = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  let rank = 0
  let lastScore = null
  return sorted.map((r, i) => {
    if (r.score !== lastScore) { rank = i + 1; lastScore = r.score }
    return { ...r, rank }
  })
}

export const pct1 = (frac) => frac == null ? '—' : (frac * 100).toFixed(1) + '%'
