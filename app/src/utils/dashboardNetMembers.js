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

export function selectMtdNetMembers(logs, snapshots, locations, range, now = new Date()) {
  const result = {}
  for (const loc of locations) {
    const unavailable = message => ({ value: null, message, through: null })
    const snapshot = snapshots.find(s => s.location_id === loc.id)
    if (!count(snapshot?.starting_members) || !count(snapshot?.active_members)) {
      result[loc.id] = unavailable('Missing month-start or current active-member snapshot.')
      continue
    }
    const through = snapshot.covered_through
    const end = range.end < businessToday(loc, now) ? range.end : businessToday(loc, now)
    if (!through || through < range.start || through > end || through >= businessToday(loc, now)) {
      result[loc.id] = unavailable('Membership snapshot coverage is outside the reporting range.')
      continue
    }
    let value = Number(snapshot.active_members) - Number(snapshot.starting_members)
    let missing = null
    for (let date = shiftDate(through, 1); date <= end; date = shiftDate(date, 1)) {
      const rows = logs.filter(r => r.location_id === loc.id && r.log_date === date)
      const net = dashboardDailyNet(rows, loc.opportunities_formula)
      if (net === null) { missing = date; break }
      value += net
    }
    result[loc.id] = missing ? unavailable(`Daily Net Members unreported for ${missing}; snapshot covers through ${through}.`)
      : { value, through: end, snapshotThrough: through, message: `Budget active members through ${through}; subsequent Daily Logs through ${end}.` }
  }
  return result
}

// Only counts and coverage metadata leave the dedicated company-read RPC.
export async function loadMembershipSnapshots(client, locations, range) {
  if (!locations.length) return []
  const { data, error } = await client.rpc('dashboard_membership_snapshots', {
    p_location_ids: locations.map(l => l.id), p_month_start: range.start, p_through_date: range.end,
  })
  if (error) throw new Error('Net Members unavailable: the approved membership reporting endpoint is missing or access was denied.')
  const fields = ['location_id', 'starting_members', 'active_members', 'covered_through']
  return (data || []).filter(r => locations.some(l => l.id === r.location_id))
    .map(r => Object.fromEntries(fields.map(key => [key, r[key]])))
}

export function compareNetMembers(a, b, direction) {
  if (a == null) return b == null ? 0 : 1
  if (b == null) return -1
  return (direction === 'asc' ? 1 : -1) * (a - b)
}
