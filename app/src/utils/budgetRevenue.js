// Entry date is the morning AFTER the business date. Keep date arithmetic in
// UTC so browser timezone and daylight-saving changes cannot shift a day.
export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const revenueMonthStart = date => `${date.slice(0, 7)}-01`

// Parse exact cents: reject fractional cents, whitespace, exponent notation,
// negative values and values beyond numeric(12,2), rather than rounding input.
export function revenueCents(value) {
  if (value == null || value === '') return null
  const text = String(value)
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= 999999999999 ? cents : null
}

export const REVENUE_KEYS = ['yesterday_total_revenue', 'yesterday_cc_revenue', 'yesterday_house_revenue']

export function cashRevenue(form) {
  const amounts = REVENUE_KEYS.map(key => revenueCents(form[key]))
  if (amounts.some(amount => amount == null)) return null
  return (amounts[0] - amounts[1] - amounts[2]) / 100
}

export function revenueError(form) {
  // Validate entered amounts even while the other inputs are still blank.
  if (REVENUE_KEYS.some(key => form[key] !== '' && form[key] != null && revenueCents(form[key]) == null)) {
    return 'Enter non-negative revenue amounts with no more than two decimal places (maximum $9,999,999,999.99).'
  }
  if (cashRevenue(form) < 0) return 'Credit card and house account revenue exceed total revenue.'
  return null
}

export function calculateMtdRevenue(entries, locationId, entryDate) {
  const monthStart = revenueMonthStart(entryDate)
  const byDate = new Map()
  for (const row of entries) {
    if (row.location_id !== locationId) continue
    const businessDate = shiftDate(row.entry_date, -1)
    if (businessDate < monthStart || businessDate >= entryDate) continue
    if (byDate.has(businessDate)) throw new Error('Duplicate revenue business date.')
    byDate.set(businessDate, row)
  }
  let cents = 0
  const missingDates = []
  for (let date = monthStart; date < entryDate; date = shiftDate(date, 1)) {
    const row = byDate.get(date)
    const amount = row && revenueCents(row.yesterday_total_revenue)
    if (amount == null || REVENUE_KEYS.some(key => revenueCents(row[key]) == null) || revenueError(row)) missingDates.push(date)
    else cents += amount
  }
  return {
    complete: missingDates.length === 0,
    total: missingDates.length ? null : cents / 100,
    recordedTotal: cents / 100,
    missingDates,
    throughDate: shiftDate(entryDate, -1),
  }
}

// Live totals are derived, never written over historical cumulative values.
export function dailyPayload(form, locationId, entryDate) {
  const error = revenueError(form)
  if (error) throw new Error(error)
  return {
    ...Object.fromEntries(Object.entries(form)
      .filter(([key]) => key !== 'mtd_revenue_actual')
      .map(([key, value]) => [key, value === '' || value == null ? null : Number(value)])),
    location_id: locationId,
    entry_date: entryDate,
    updated_at: new Date().toISOString(),
  }
}

// Supabase can cap each response. Page explicitly so many sites never silently
// lose days; fail the whole read on an error instead of presenting a partial sum.
export async function fetchRevenueEntries(client, locationIds, entryDate) {
  if (!locationIds.length) return []
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('budget_daily_entries').select('*')
      .in('location_id', locationIds)
      .gte('entry_date', revenueMonthStart(entryDate)).lte('entry_date', entryDate)
      .order('entry_date').order('location_id').range(offset, offset + 499)
    if (error) throw error
    if (!data) throw new Error('Revenue entries could not be loaded.')
    rows.push(...data)
    if (data.length < 500) return rows
  }
}
