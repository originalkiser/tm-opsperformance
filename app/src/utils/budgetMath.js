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

// Fraction of the month elapsed (day 1 of 30 → 1/30, last day → 1).
export function monthProgress(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDate() / daysInMonth(dateStr)
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
