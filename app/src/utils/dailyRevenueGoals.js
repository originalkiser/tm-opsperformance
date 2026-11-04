import { shiftDate, revenueMonthStart, budgetMonthStart, usesReportedMtd } from './budgetRevenue.js'

// Decimal strings retain workbook precision through transport and aggregation.
export async function fetchDailyRevenueGoals(client, locationIds, reportingDate) {
  if (!locationIds.length || !usesReportedMtd(reportingDate)) return []
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('budget_daily_revenue_goals')
      .select('location_id,business_date,total:total_revenue_goal::text,retail:retail_revenue_goal::text,recurring:recurring_revenue_goal::text')
      .in('location_id', locationIds).gte('business_date', budgetMonthStart(reportingDate))
      .lte('business_date', shiftDate(reportingDate, -1))
      .order('business_date').order('location_id').range(offset, offset + 499)
    if (error) throw error
    if (!data) throw new Error('Daily revenue goals could not be loaded.')
    if (data.some(row => !['total', 'retail', 'recurring'].every(k => typeof row[k] === 'string'))) throw new Error('Daily goals must be transported as exact decimal strings.')
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

export function sumDailyRevenueGoals(goals, locationId, throughDate) {
  const month = revenueMonthStart(throughDate), missingDates = [], invalidDates = []
  const amounts = []
  for (let date = month; date <= throughDate; date = shiftDate(date, 1)) {
    const rows = (goals || []).filter(r => r.location_id === locationId && r.business_date === date)
    if (!rows.length) { missingDates.push(date); continue }
    if (rows.length !== 1 || !['total', 'retail', 'recurring'].every(k => /^\d+(\.\d+)?$/.test(String(rows[0][k])))) {
      invalidDates.push(date); continue
    }
    amounts.push(rows[0].total)
  }
  if (missingDates.length || invalidDates.length) return { amount: null, decimal: null, missingDates, invalidDates }
  const scale = Math.max(0, ...amounts.map(v => String(v).split('.')[1]?.length || 0))
  const units = amounts.reduce((sum, value) => {
    const [whole, fraction = ''] = String(value).split('.')
    return sum + BigInt(whole + fraction.padEnd(scale, '0'))
  }, 0n)
  const text = units.toString().padStart(scale + 1, '0')
  const decimal = scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text
  return { amount: Number(decimal), decimal, missingDates, invalidDates }
}
