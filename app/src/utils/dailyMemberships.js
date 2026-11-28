import { dailyLogCounts, membershipTiers, positiveCount, runningDailyCounts } from './dailyLogCounts.js'
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
  let latest
  for (const [row, counts] of runningDailyCounts(rows)) {
    if (dailyLogCounts.some(field => positiveCount(row[field]))) latest = { ...row, ...counts }
  }
  return latest
}
// Carry each reported cumulative count through empty inputs. The daily loss
// is a separate entry and is subtracted once from each running balance.
export function runningNetMembers(rows, formula = 'detailed') {
  const lost = plansLost(rows)
  return new Map([...runningDailyCounts(rows, [...membershipTiers, 'reactivations'])].map(([row, counts]) => {
    const sales = membershipTiers.reduce((sum, field) => sum + counts[field], 0)
    return [row, lost === null ? null : sales + (formula === 'simple' ? 0 : counts.reactivations) - lost]
  }))
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
