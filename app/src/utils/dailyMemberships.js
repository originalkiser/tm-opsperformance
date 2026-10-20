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
export function dailyNetMembers(rows) {
  const lost = plansLost(rows)
  if (lost === null) return null
  const latest = membershipSnapshot(rows)
  return ['basic', 'good', 'better', 'best'].reduce((sum, key) => sum + (Number(latest?.[key]) || 0), 0) - lost
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
