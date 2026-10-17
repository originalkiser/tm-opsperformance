import { shiftDate } from './budgetRevenue.js'

// Dashboard only. All entry/reporting consumers keep their existing table/RLS path.
// This endpoint exposes performance counts, never full Budget Tracking records.
export async function loadDashboardMtd(client, locations, range, cutoff) {
  const ids = locations.filter(l => l.show_budget_tracking).map(l => l.id)
  if (!ids.length || cutoff < range.start) return []
  const { data, error } = await client.rpc('dashboard_mtd_performance', {
    p_location_ids: ids,
    p_month_start: range.start,
    p_through_date: cutoff,
  })
  if (error) throw new Error('Company MTD performance is unavailable. The approved reporting endpoint may not be installed or access may be denied.')
  // Defensive whitelist: never forward other RPC fields into UI/export state.
  const fields = ['location_id', 'entry_date', 'mtd_washes', 'mtd_redemptions', 'mtd_basic', 'mtd_good', 'mtd_better', 'mtd_best', 'current_reviews']
  return (data || []).filter(row => ids.includes(row.location_id) && row.entry_date >= shiftDate(range.start, 1)
    && row.entry_date <= shiftDate(cutoff, 1))
    .map(row => Object.fromEntries(fields.map(field => [field, row[field]])))
}

// Reporting metadata only; never populate AuthContext or operational selectors.
export async function loadCompanyReportingLocations(client) {
  const sites = []
  for (let offset = 0;; offset += 1000) {
    const { data, error } = await client.from('locations')
      .select('id,name,site_code,market,timezone,exclude_from_reporting,show_budget_tracking,opportunities_formula,metric_thresholds')
      .order('id').range(offset, offset + 999)
    if (error) throw new Error('Company reporting locations could not be loaded.')
    sites.push(...(data || []))
    if (!data || data.length < 1000) return sites.filter(site => !site.exclude_from_reporting)
  }
}
