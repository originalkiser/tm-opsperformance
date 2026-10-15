import { shiftDate, lastCompletedBusinessDate } from './budgetRevenue.js'
import { toDayTotals } from './insightsHelpers.js'

const count = v => v !== null && v !== '' && v !== undefined && typeof v !== 'boolean' && Number.isSafeInteger(Number(v)) && Number(v) >= 0
export const isMtdRange = range => !!range?.start && range.start === `${range.end.slice(0, 7)}-01`
export function completedCutoff(range, today) {
  return range.end < today ? range.end : shiftDate(today, -1)
}
export function commonReportingToday(locations, now = new Date()) {
  const completed = (locations.length ? locations : [{}]).map(l => lastCompletedBusinessDate(l.timezone, now)).sort()[0]
  return shiftDate(completed, 1)
}

// A cumulative snapshot replaces a site's entire covered MTD, never adds to it.
// Daily chart points come only from explicit Yesterday counts, not allocation
// of cumulative totals. Employee/hourly rows are deliberately not handled here.
export function budgetPerformanceRow(entry, prefix, date) {
  const fields = ['washes', 'redemptions', 'basic', 'good', 'better', 'best']
  if (!entry || !fields.every(f => count(entry[`${prefix}_${f}`]))) return null
  const n = f => Number(entry[`${prefix}_${f}`])
  const sales = n('basic') + n('good') + n('better') + n('best')
  if (n('redemptions') > n('washes')) return null
  return { location_id: entry.location_id, log_date: date, time_slot: '23:59',
    total_washes: n('washes'), member_washes: n('redemptions'),
    basic: n('basic'), good: n('good'), better: n('better'), best: n('best'),
    memberships_sold: sales, opportunities: n('washes') - n('redemptions'),
    google_reviews: prefix === 'mtd' && count(entry.current_reviews) ? Number(entry.current_reviews) : null,
    budget_source: true }
}

export function selectPerformanceSources(logs, entries, locations, range, today) {
  if (!isMtdRange(range)) return { totals: toDayTotals(logs), daily: toDayTotals(logs), notes: [], active: false }
  const cutoff = completedCutoff(range, today)
  const budgetIds = new Set(locations.filter(l => l.show_budget_tracking).map(l => l.id))
  const raw = toDayTotals(logs.filter(r => r.log_date <= cutoff && !budgetIds.has(r.location_id)))
  const totals = [...raw], daily = [...raw], notes = []
  for (const loc of locations.filter(l => budgetIds.has(l.id))) {
    const eligible = entries.filter(e => e.location_id === loc.id && shiftDate(e.entry_date, -1) >= range.start
      && shiftDate(e.entry_date, -1) <= cutoff).sort((a, b) => b.entry_date.localeCompare(a.entry_date))
    const latest = eligible[0]
    const through = latest ? shiftDate(latest.entry_date, -1) : null
    const snapshot = budgetPerformanceRow(latest, 'mtd', through)
    if (snapshot) totals.push(snapshot)
    notes.push({ id: loc.id, name: loc.name, through, complete: !!snapshot && through === cutoff,
      message: !snapshot ? 'MTD unavailable — missing or invalid Budget Tracking totals.'
        : through !== cutoff ? `Provisional Budget Tracking MTD through ${through}; expected ${cutoff}.`
          : `Budget Tracking MTD through ${through}.` })
    for (const entry of eligible) {
      const point = budgetPerformanceRow(entry, 'yesterday', shiftDate(entry.entry_date, -1))
      if (point) daily.push(point)
    }
  }
  return { totals, daily, notes, cutoff, active: budgetIds.size > 0 }
}
