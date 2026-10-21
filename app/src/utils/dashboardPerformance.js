import { dashboardDailyNet } from './dashboardNetMembers.js'
import { lastCompletedBusinessDate, shiftDate } from './budgetRevenue.js'
import { toDayTotals } from './insightsHelpers.js'

export const businessToday = (location, now = new Date()) => shiftDate(lastCompletedBusinessDate(location.timezone, now), 1)

export function currentMtdRange(locations, now = new Date()) {
  const end = (locations.length ? locations : [{}]).map(l => businessToday(l, now)).sort()[0]
  return { start: `${end.slice(0, 7)}-01`, end }
}

// Read-only, paginated query. A failed page must never become a partial company total.
export async function loadPerformanceLogs(client, locations, range) {
  if (!locations.length) return []
  const rows = []
  for (let offset = 0;; offset += 1000) {
    const { data, error } = await client.from('daily_logs').select('*')
      .in('location_id', locations.map(l => l.id)).gte('log_date', range.start)
      .lte('log_date', range.end).order('id').range(offset, offset + 999)
    if (error) throw new Error('Daily Logs could not be loaded. Previously displayed data may be stale.')
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}

export function selectTodayPerformance(logs, locations, now = new Date()) {
  const statuses = {}, totals = [], netMembers = {}
  for (const location of locations) {
    const date = businessToday(location, now)
    const rows = logs.filter(r => r.location_id === location.id && r.log_date === date)
    const net = dashboardDailyNet(rows, location.opportunities_formula)
    netMembers[location.id] = { value: net, through: date, message: net === null ? 'Daily Net Members unreported.' : `Daily running balance for ${date}.` }
    // Ignore untouched future slots; explicit zero entries with an author count.
    const entered = rows.filter(r => r.plans_lost_today != null || Number(r.reactivations) > 0 || Number(r.net_members) !== 0 && r.net_members != null || r.employee_name?.trim() || r.created_by ||
      ['total_washes', 'member_washes', 'google_reviews', 'basic', 'good', 'better', 'best'].some(k => Number(r[k]) > 0))
    const latest = toDayTotals(entered)[0]
    if (latest) {
      const n = key => Math.max(0, Number(latest[key]) || 0)
      const sales = n('basic') + n('good') + n('better') + n('best')
      totals.push({ ...latest, memberships_sold: sales,
        opportunities: Math.max(0, n('total_washes') - n('member_washes') + (location.opportunities_formula === 'simple' ? 0 : sales)) })
    }
    const updatedAt = entered.map(r => r.updated_at).filter(t => t && Number.isFinite(Date.parse(t))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)
    statuses[location.id] = { date, timezone: location.timezone || 'America/Chicago', updatedAt }
  }
  return { totals, statuses, netMembers, notes: [], active: false }
}
