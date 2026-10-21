// Daily Log values are cumulative snapshots, never additive hourly sales.
export const LOSS_SLOT = '08:00:00'
export const isLossAnchor = row => row.time_slot === LOSS_SLOT && (row.split_index ?? 0) === 0
export const plansLost = rows => rows.find(isLossAnchor)?.plans_lost_today ?? null
export const hasLegacyNet = rows => rows.some(row => row.net_members_legacy === true || (Number(row.net_members) !== 0 && row.net_members !== '' && row.net_members != null))
export function parsePlansLost(value) {
  if (!/^\d+$/.test(String(value))) return null
  const n = Number(value)
  return Number.isInteger(n) && n <= 2147483647 ? n : null
}
export function membershipSnapshot(rows) {
  return [...rows].filter(r => ['basic', 'good', 'better', 'best', 'total_washes', 'member_washes'].some(k => Number(r[k]) > 0))
    .sort((a, b) => b.time_slot.localeCompare(a.time_slot) || (b.split_index ?? 0) - (a.split_index ?? 0))[0]
}
// Carry the last reported cumulative counts into blank hours/fields.
// Explicit zero remains zero; the daily loss is subtracted once per balance.
export function runningNetMembers(rows, formula = 'detailed') {
  const lost = plansLost(rows)
  const balances = new Map()
  const counts = { basic: 0, good: 0, better: 0, best: 0, reactivations: 0 }
  const fields = Object.keys(counts)
  const count = value => Math.max(0, Number(value) || 0)
  for (const row of [...rows].sort((a, b) => a.time_slot.localeCompare(b.time_slot) || (a.split_index ?? 0) - (b.split_index ?? 0))) {
    for (const key of fields) {
      if (row[key] != null && row[key] !== '') counts[key] = count(row[key])
    }
    const sales = counts.basic + counts.good + counts.better + counts.best
    balances.set(row, lost === null ? null : sales + (formula === 'simple' ? 0 : counts.reactivations) - lost)
  }
  return balances
}
export function dailyNetMembers(rows, formula = 'detailed') {
  if (plansLost(rows) === null) return null
  const values = [...runningNetMembers(rows, formula).values()]
  return values.at(-1) ?? null
}
// A per-component queue serializes rapid edits; each request captures its day/site.
export function lossWriter(client, locationId, logDate) {
  let queue = Promise.resolve()
  return value => {
    queue = queue.catch(() => {}).then(async () => {
      const { error } = await client.from('daily_logs').upsert({
        location_id: locationId, log_date: logDate, time_slot: LOSS_SLOT,
        split_index: 0, plans_lost_today: value,
      }, { onConflict: 'location_id,log_date,time_slot,split_index' })
      if (error) throw error
    })
    return queue
  }
}
