import { dailyNetMembers } from './dailyMemberships.js'
import { lastCompletedBusinessDate } from './budgetRevenue.js'
const businessToday = (location, now) => shiftDate(lastCompletedBusinessDate(location.timezone, now), 1)
import { shiftDate } from './budgetRevenue.js'

const count = value => value != null && value !== '' && typeof value !== 'boolean' && Number.isSafeInteger(Number(value)) && Number(value) >= 0
const signed = value => value != null && value !== '' && typeof value !== 'boolean' && Number.isSafeInteger(Number(value))
const newest = (a, b) => b.time_slot.localeCompare(a.time_slot) || (b.split_index ?? 0) - (a.split_index ?? 0)

export function dashboardDailyNet(rows, formula = 'detailed') {
  const calculated = dailyNetMembers(rows, formula)
  if (calculated !== null) return calculated
  // Do not turn an untouched default net_members=0 into reported activity.
  const manual = rows.filter(r => signed(r.net_members) && (r.net_members_legacy === true || Number(r.net_members) !== 0)).sort(newest)[0]
  return manual ? Number(manual.net_members) : null
}

// A daily result is a single day's running balance, never an MTD total.
export function latestDailyNetMembers(logs, location, cutoff, now = new Date()) {
  const end = cutoff < businessToday(location, now) ? cutoff : businessToday(location, now)
  const eligible = logs.filter(r => r.location_id === location.id && r.log_date <= end)
  for (const date of [...new Set(eligible.map(r => r.log_date))].sort().reverse()) {
    const value = dashboardDailyNet(eligible.filter(r => r.log_date === date), location.opportunities_formula)
    if (value !== null) return { value, through: date, message: `Daily Net Members for ${date}.` }
  }
  return { value: null, through: null, message: 'No reported daily Net Members at or before the cutoff.' }
}

export function selectMtdNetMembers(logs, snapshots, locations, range, now = new Date(), reportingCutoff = range.end) {
  const result = {}
  for (const loc of locations) {
    const end = range.end < businessToday(loc, now) ? range.end : businessToday(loc, now)
    const monthStart = `${end.slice(0, 7)}-01`
    if (range.start !== monthStart) {
      result[loc.id] = { value: null, through: null, message: 'MTD requires a single month starting on its first day.' }
      continue
    }
    const snapshot = snapshots.filter(s => s.location_id === loc.id && count(s.starting_members) && count(s.active_members)
      && s.covered_through >= monthStart && s.covered_through <= end
      && s.covered_through < reportingCutoff && s.covered_through < businessToday(loc, now))
      .sort((a, b) => b.covered_through.localeCompare(a.covered_through))[0]
    let value = snapshot ? Number(snapshot.active_members) - Number(snapshot.starting_members) : null
    let through = snapshot?.covered_through ?? null
    // Without a snapshot, only a continuous sequence from month start supports MTD.
    for (let date = through ? shiftDate(through, 1) : monthStart; date <= end; date = shiftDate(date, 1)) {
      const rows = logs.filter(r => r.location_id === loc.id && r.log_date === date)
      const net = dashboardDailyNet(rows, loc.opportunities_formula)
      if (net === null) break
      value = (value ?? 0) + net
      through = date
    }
    result[loc.id] = { value, through, snapshotThrough: snapshot?.covered_through ?? null,
      message: through ? `MTD Net Members supported through ${through}; later missing days are not counted as zero.`
        : 'No supported MTD Net Members in this month.' }
  }
  return result
}

// Only counts and coverage metadata leave the dedicated company-read RPC.
export async function loadMembershipSnapshots(client, locations, range, reportingCutoff = range.end) {
  if (!locations.length) return []
  const found = []
  let pending = locations.filter(l => l.show_budget_tracking)
  // The endpoint exposes only its latest snapshot. Move its coverage cutoff back
  // to recover older valid headcounts when the latest entry omitted that field.
  // A morning entry covers yesterday: never request an entry after the reporting cutoff.
  for (let cutoff = range.end < reportingCutoff ? range.end : shiftDate(reportingCutoff, -1); cutoff >= range.start && pending.length; cutoff = shiftDate(cutoff, -1)) {
    const { data, error } = await client.rpc('dashboard_membership_snapshots', {
      p_location_ids: pending.map(l => l.id), p_month_start: range.start, p_through_date: cutoff,
    })
    if (error) throw new Error('Net Members unavailable: the approved membership reporting endpoint is missing or access was denied.')
    const valid = (data || []).filter(r => pending.some(l => l.id === r.location_id)
      && count(r.starting_members) && count(r.active_members)
      && r.covered_through >= range.start && r.covered_through <= cutoff)
    const fields = ['location_id', 'starting_members', 'active_members', 'covered_through']
    found.push(...valid.map(r => Object.fromEntries(fields.map(key => [key, r[key]]))))
    pending = pending.filter(l => !valid.some(r => r.location_id === l.id))
  }
  return found
}

export function compareNetMembers(a, b, direction) {
  if (a == null) return b == null ? 0 : 1
  if (b == null) return -1
  return (direction === 'asc' ? 1 : -1) * (a - b)
}
