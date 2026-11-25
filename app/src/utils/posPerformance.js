import { shiftDate } from './budgetRevenue.js'
import { POS_START } from './posImportStorage.js'

export const posPeriods = ['Today', 'Yesterday', 'WTD', 'LW', 'MTD', 'Selected Date Range']
const iso = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

export function posPeriod(period, today, customStart, customEnd) {
  const yesterday = shiftDate(today, -1)
  const sunday = shiftDate(today, -new Date(today + 'T00:00:00Z').getUTCDay())
  let range
  switch (period) {
    case 'Today': range = [today, today]; break
    case 'Yesterday': range = [yesterday, yesterday]; break
    case 'WTD': range = [sunday, yesterday]; break
    case 'LW': range = [shiftDate(sunday, -7), shiftDate(sunday, -1)]; break
    case 'MTD': range = [today.slice(0, 7) + '-01', yesterday]; break
    default:
      if (![customStart, customEnd].every(iso) || customStart < POS_START || customEnd > today || customEnd < customStart ||
        Date.parse(customEnd) - Date.parse(customStart) > 366 * 86400000) return { error: 'Choose up to 367 business days from November 1, 2026 through today.' }
      range = [customStart, customEnd]
  }
  const start = range[0] < POS_START ? POS_START : range[0], end = range[1]
  return { start, end, empty: end < start }
}

export function isPosReportingLocation(location) {
  return !location.exclude_from_reporting && /^(1508|1511|1512|1515|1516|1517|1518|1519|1520|1521|1522|1524|1525|1526|1527|1528|1529|1530|1531|1532)(?:-|$)/.test(String(location.site_code))
}

export async function readPosTargets(client, locations, start, end) {
  if (!locations.length || end < start) return []
  const rows = []
  for (let offset = 0; ; offset += 250) {
    const { data, error } = await client.from('budget_daily_revenue_goals')
      .select('location_id,business_date,total:total_revenue_goal::text')
      .in('location_id', locations.map(l => l.id)).gte('business_date', start).lte('business_date', end)
      .order('business_date').order('location_id').range(offset, offset + 249)
    if (error || !data) throw new Error('Daily revenue targets could not be loaded.')
    rows.push(...data)
    if (data.length < 250) return rows
  }
}

const revenueMetrics = new Set(['total', 'retail', 'member'])
const totals = ['total', 'member', 'retail', 'washes', 'opportunities', 'redemptions', 'memberships']
const available = value => Number.isSafeInteger(value)
const field = (record, key) => record.financial_status === 'provisional' && revenueMetrics.has(key)
  ? null : record.document.metrics[key]
const hasFinancialWarning = record => record.financial_status !== 'reconciled'

function aggregate(records, expected, targets, targetComplete) {
  const values = {}
  for (const key of totals) {
    const amounts = records.map(row => field(row, key)).filter(available)
    values[key] = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null
    values[key + 'Partial'] = amounts.length !== expected
  }
  const weighted = (numerator, denominator, unresolved) => {
    if (!expected || records.length !== expected || records.some(row => !available(field(row,numerator)) ||
      !available(field(row,denominator)) || unresolved && field(row,unresolved) !== 0)) return null
    const denom = records.reduce((sum,row) => sum + field(row,denominator),0)
    return denom > 0 ? records.reduce((sum,row) => sum + field(row,numerator),0) / denom : null
  }
  // Scale the exact target strings together before adding. Convert once for display and ratios.
  const scale = Math.max(0, ...targets.map(target => target.split('.')[1]?.length || 0))
  const units = targets.reduce((sum, target) => {
    const [whole, fraction = ''] = target.split('.')
    return sum + BigInt(whole + fraction.padEnd(scale,'0'))
  }, 0n)
  const target = targets.length ? Number(units) / 10 ** scale : null
  const targetVerified = targetComplete && !values.totalPartial && !records.some(hasFinancialWarning)
  return { ...values, target, targetPartial: !targetComplete,
    comparison: target != null && target > 0 && targetVerified ? (values.total / 100 - target) / target : null,
    retailMix: weighted('premiumRetail','eligibleRetail'), redeemMix: weighted('premiumRedeemed','redemptions','unclassifiedRedeemed'),
    soldMix: weighted('premiumSold','memberships','unclassifiedSold'), conversion: weighted('memberships','opportunities'),
    imported: records.length, expected, incomplete: records.filter(row => row.validation !== 'validated').length,
    financial: records.filter(hasFinancialWarning).length,
    provisional: records.filter(row => row.financial_status === 'provisional').length,
    calculated: records.filter(row => row.document.sources?.washCount?.source === 'calculated').length,
    unclassified: records.filter(row => row.document.sources?.report?.unclassifiedRetail?.length ||
      row.document.metrics.unclassifiedSold > 0 || row.document.metrics.unclassifiedRedeemed > 0).length,
  }
}

export function buildPosPerformance(locations, entries, goals, start, end) {
  const dates = []
  for (let date = start; date && end && date <= end; date = shiftDate(date, 1)) dates.push(date)
  const dateSet = new Set(dates)
  const boolGoal = row => typeof row.total === 'string' && /^\d+(\.\d+)?$/.test(row.total) && row.total.length <= 60
  const bySite = locations.map(location => {
    const records = entries.filter(row => row.location_id === location.id && dateSet.has(row.business_date))
    const imported = new Set(records.map(row => row.business_date))
    const siteGoals = goals.filter(row => row.location_id === location.id && dateSet.has(row.business_date) && boolGoal(row))
    const goalsByDate = new Map()
    for (const row of siteGoals) goalsByDate.set(row.business_date, goalsByDate.has(row.business_date) ? null : row.total)
    const targets = [...goalsByDate.values()].filter(v => v != null)
    const targetComplete = targets.length === dates.length
    return { location, records, targets, targetComplete, missing: dates.filter(date => !imported.has(date)),
      ...aggregate(records, dates.length, targets, targetComplete) }
  })
  return { rows: bySite, network: aggregate(bySite.flatMap(row => row.records), bySite.length * dates.length,
    bySite.flatMap(row => row.targets), bySite.every(row => row.targetComplete)) }
}
