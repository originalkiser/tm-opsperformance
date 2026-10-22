import { shiftDate } from '../utils/budgetRevenue.js'
import useBudgetReport from '../hooks/useBudgetReport'
import SiteMetricTable, { PerformanceTable } from './SiteMetricTable'
import TmLoader from './TmLoader'
import { budgetReportPeriod } from '../utils/budgetReportRows.js'
import { selectPerformanceSources, budgetPerformanceRow } from '../utils/budgetPerformanceSource.js'

export default function SitePerformanceReport({ data, locations, scoringLocations, dateRange }) {
  const { reportingDate, supported } = budgetReportPeriod(dateRange)
  const report = useBudgetReport(scoringLocations, supported ? reportingDate : null)
  if (!supported) return <><p className="text-xs mb-3 text-gray-500">Budget scoring is unavailable for this range. Select a month-to-date range ending on a morning reporting date no later than today to compare with Budget Tracking. Existing range metrics remain below.</p><SiteMetricTable data={data} locations={locations} dateRange={dateRange} /></>
  if (report.loading) return <div className="flex justify-center py-12"><TmLoader /></div>
  if (report.error) return <p role="alert" className="text-red-600">{report.error}</p>
  const legacy = selectPerformanceSources(data, [], locations.filter(l => !l.show_budget_tracking), dateRange, reportingDate)
  const visibleIds = new Set(locations.map(l => l.id))
  const budgetRows = report.rows.filter(r => visibleIds.has(r.loc.id))
  const snapshots = budgetRows.map(r => budgetPerformanceRow(r.entry, 'mtd', r.scoringResult.businessDate)).filter(Boolean)
  const source = { ...legacy, active: budgetRows.length > 0, cutoff: shiftDate(reportingDate, -1), totals: [...legacy.totals, ...snapshots], notes: budgetRows.map(r => ({ id: r.loc.id, name: r.loc.name, complete: !r.formatting.stale && r.formatting.mtdAvailable, through: r.entry ? shiftDate(r.entry.entry_date, -1) : null, message: r.formatting.stale ? 'Stale Budget entry; no official score.' : `Budget Tracking MTD through ${shiftDate(r.entry.entry_date, -1)}.` })) }
  return <><p className="text-xs mb-3 text-gray-500">Morning reporting entry: {reportingDate}. MTD covers through the prior business day, matching Budget Tracking. Rankings use all accessible eligible Budget sites; site/market filters only hide rows. Non-Budget and excluded sites have no Budget score.</p><PerformanceTable source={source} locations={locations} dateRange={dateRange} budgetRows={budgetRows} /></>
}
