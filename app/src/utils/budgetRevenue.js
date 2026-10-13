// Entry date is the morning AFTER the business date. Keep date arithmetic in
// UTC so browser timezone and daylight-saving changes cannot shift a day.
export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const revenueMonthStart = date => `${date.slice(0, 7)}-01`

// Presentation fallback is a dated cumulative figure, NEVER a partial daily
// subtotal or a sum of overlapping reported/verified amounts.
export function revenuePresentation(revenue, historical) {
  if (revenue.complete) return { amount: revenue.total, throughDate: revenue.throughDate,
    reportingDate: shiftDate(revenue.throughDate, 1), provisional: false, source: 'automatic' }
  if (revenue.startingBalance) return { amount: Number(revenue.startingBalance.amount),
    throughDate: revenue.startingBalance.cutoff_business_date,
    reportingDate: shiftDate(revenue.startingBalance.cutoff_business_date, 1), provisional: true, source: 'verified balance' }
  if (historical && revenueCents(historical.amount) != null) return { amount: Number(historical.amount),
    throughDate: shiftDate(historical.entryDate, -1), reportingDate: historical.entryDate,
    provisional: true, source: 'reported MTD' }
  return { amount: null, reportingDate: null, throughDate: null, provisional: false, source: null }
}

// Historical references belong to the selected month/site and never enter totals.
export function latestHistoricalRevenue(entries, locationId, entryDate, activeStartingBalance = null) {
  // A verified balance is authoritative; do not substitute or combine an
  // overlapping reported cumulative figure, even when later daily days are missing.
  if (activeStartingBalance?.location_id === locationId
    && activeStartingBalance.revenue_month === revenueMonthStart(entryDate)
    && entryDate > activeStartingBalance.cutoff_business_date) return null
  const monthStart = revenueMonthStart(entryDate)
  const latest = entries.filter(row => row.location_id === locationId
    && (row.entry_date > monthStart || (row.entry_date === monthStart && revenueCents(row.mtd_revenue_actual) === 0)) && row.entry_date <= entryDate
    && revenueCents(row.mtd_revenue_actual) != null)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0]
  return latest ? { amount: Number(latest.mtd_revenue_actual), entryDate: latest.entry_date } : null
}

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

export const TRANSITION_MONTH = '2026-10-01'
export const DEFAULT_TRANSITION_CUTOFF = '2026-10-10'

export function startingBalanceCutoffError(cutoff, month = TRANSITION_MONTH, lastCompletedDate = null) {
  if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)
    || !Number.isFinite(Date.parse(`${cutoff}T00:00:00Z`))
    || new Date(`${cutoff}T00:00:00Z`).toISOString().slice(0, 10) !== cutoff) return 'Choose a valid cutoff business date.'
  if (revenueMonthStart(cutoff) !== month) return 'The cutoff must be within October 2026.'
  if (lastCompletedDate && cutoff > lastCompletedDate) return 'The cutoff cannot be later than the last completed business day.'
  return null
}

export function lastCompletedBusinessDate(timeZone = 'America/Chicago', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = type => parts.find(value => value.type === type).value
  return shiftDate(`${part('year')}-${part('month')}-${part('day')}`, -1)
}

export function calculateMtdRevenue(entries, locationId, entryDate, startingBalance = null) {
  const monthStart = revenueMonthStart(entryDate)
  const baseline = monthStart === TRANSITION_MONTH && startingBalance?.location_id === locationId
    && startingBalance?.revenue_month === TRANSITION_MONTH ? startingBalance : null
  if (baseline && (startingBalanceCutoffError(baseline.cutoff_business_date) || revenueCents(baseline.amount) == null)) {
    throw new Error('Invalid October revenue starting balance.')
  }
  // A later cutoff cannot describe an earlier historical as-of date.
  const activeBaseline = baseline && entryDate > baseline.cutoff_business_date ? baseline : null
  const firstBusinessDate = activeBaseline ? shiftDate(activeBaseline.cutoff_business_date, 1) : monthStart
  const byDate = new Map()
  for (const row of entries) {
    if (row.location_id !== locationId) continue
    const businessDate = shiftDate(row.entry_date, -1)
    if (businessDate < firstBusinessDate || businessDate >= entryDate) continue
    if (byDate.has(businessDate)) throw new Error('Duplicate revenue business date.')
    byDate.set(businessDate, row)
  }
  let cents = activeBaseline ? revenueCents(activeBaseline.amount) : 0
  const missingDates = []
  for (let date = firstBusinessDate; date < entryDate; date = shiftDate(date, 1)) {
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
    startingBalance: activeBaseline,
  }
}

export async function fetchStartingBalances(client, locationIds, entryDate) {
  if (revenueMonthStart(entryDate) !== TRANSITION_MONTH || !locationIds.length) return []
  const { data, error } = await client.from('revenue_starting_balances').select('*')
    .in('location_id', locationIds).eq('revenue_month', TRANSITION_MONTH)
  if (error) throw error
  if (!data) throw new Error('Starting balances could not be loaded.')
  return data
}

// Live totals are derived, never written over historical cumulative values.
export function dailyPayload(form, locationId, entryDate) {
  if (form.yesterday_cash_counted !== '' && form.yesterday_cash_counted != null && revenueCents(form.yesterday_cash_counted) == null) {
    throw new Error('Invalid cash count.')
  }
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
