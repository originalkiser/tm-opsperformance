import BudgetScoreDetails, { formatBudgetScore } from './BudgetScoreDetails'
import { displayMoney, displayCount } from '../utils/budgetDisplay'
import { pct1 } from '../utils/budgetMath'
import { REPORT_STATUS_CLS } from '../utils/metricColors'
import { netMembersCls } from '../utils/netMemberColors'
import { useAuth } from '../contexts/AuthContext'
import useKpiTablePreferences from '../hooks/useKpiTablePreferences'
import KpiTableControls from './KpiTableControls'
import { KPI_COLUMNS, visibleColumns, filterRows, activeFilter, compareRows } from '../utils/performanceColumns.js'
import useBudgetPerformance from '../hooks/useBudgetPerformance'
import BudgetSourceNote from './BudgetSourceNote'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { agg, thCls } from '../utils/insightsHelpers'
import { exportCsv, exportXlsx, exportPdf } from '../utils/exportTable'
import { fmtDateRange } from './DateSelector'
import ExportMenu from './ExportMenu'

function SortIcon({ active, dir }) {
  if (!active) return <span className="ml-1 opacity-25 text-[10px]">↕</span>
  return <span className="ml-1 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
}

function MiniBar({ value, max }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 bg-gray-100 dark:bg-tm-dark-border rounded-full h-1.5 min-w-[40px]">
        <div className="bg-tm-teal h-1.5 rounded-full" style={{ width: max > 0 ? `${Math.min(100, value / max * 100)}%` : '0%' }} />
      </div>
      <span className="text-xs w-12 text-right dark:text-tm-dark-text">{fmtNum(value) || value}</span>
    </div>
  )
}

const budgetValues = b => ({
  rank: b?.rank ?? null, revenue: b?.rev.reported.amount ?? null,
  members: b?.entry?.mtd_membership_actual === '' ? null : b?.entry?.mtd_membership_actual ?? null,
  revenuePct: b?.rev.pct ?? null, planPct: b?.plan.progress ?? null,
  growth: b?.scoringResult.growth ?? null, expectedGrowth: b?.scoringResult.expectedGrowth ?? null,
  rating: b?.entry?.current_rating === '' ? null : b?.entry?.current_rating ?? null, score: b?.score ?? null,
})
const budgetCell = (r, key) => key === 'rank' ? r.rank ?? 'Unranked'
  : key === 'score' ? formatBudgetScore(r.budget?.scoringResult)
  : key === 'revenue' ? displayMoney(r.revenue)
  : key === 'revenuePct' || key === 'planPct' ? pct1(r[key])
  : key === 'rating' ? r.budget?.entry?.current_rating ?? '—' : displayCount(r[key])

export default function SiteMetricTable({ data, locations, dateRange, title = 'Site Performance', companyRead = false, netMembers, tableId }) {
  const source = useBudgetPerformance(data, locations, dateRange, { companyRead })
  return <PerformanceTable source={source} locations={locations} dateRange={dateRange} title={title} netMembers={netMembers} tableId={tableId} />
}

// Shared compact, sortable presentation; source selection stays outside the table.
export function PerformanceTable({ source, locations, dateRange, title = 'Site Performance', daily = false, netMembers = source.netMembers, budgetRows, tableId = daily ? 'dashboard-today' : title === 'MTD Performance' ? 'dashboard-mtd' : 'reports-sites' }) {
  const { user, profile } = useAuth()
  const preferences = useKpiTablePreferences(tableId, user?.id || profile?.id, budgetRows ? 'score' : 'tw')
  const { config, update, reset } = preferences
  const sort = config.sort
  const toggleSort = col => update(previous => ({ ...previous, sort: { col, dir: previous.sort.col === col && previous.sort.dir === 'desc' ? 'asc' : 'desc' } }))
  const showNet = netMembers !== undefined
  const allColumns = KPI_COLUMNS.filter(c => (!c.budget || budgetRows) && (c.key !== 'nm' || showNet))
  const columns = visibleColumns(allColumns, config)
  const budgetById = new Map((budgetRows || []).map(r => [r.loc.id, r]))

  const dayData = source.totals
  const byLoc   = {}
  dayData.forEach(r => { ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r) })

  const rows = locations.map(loc => {
    const budget = budgetById.get(loc.id)
    return {
      id: loc.id,
      name: loc.name,
      nm: netMembers?.[loc.id]?.value ?? null,
      netStatus: netMembers?.[loc.id],
      ...agg(byLoc[loc.id] || []),
      missing: !byLoc[loc.id]?.length,
      ...(budget ? {
        p_mix: pct1(budget.formatting.mtdAvailable ? budget.mtd.pmix : null),
        conversion: pct1(budget.formatting.mtdAvailable ? budget.mtd.conversion : null),
      } : {}),
      budget,
      ...(budget && budget.entry?.current_reviews == null ? { gr: null } : {}),
      ...(budgetRows ? budgetValues(budget) : {}),
      thresholds: loc.metric_thresholds,
      status: source.statuses?.[loc.id],
      provisional: source.notes.some(n => n.id === loc.id && !n.complete),
    }
  })
  const filtered = columns.some(c => activeFilter(config.filters[c.key], c))
  const displayedRows = filterRows(rows, columns, config.filters)
  const sortColumn = allColumns.find(c => c.key === sort.col) || allColumns[1] || allColumns[0]
  const sorted = [...displayedRows].sort((a, b) => compareRows(a, b, sortColumn, sort.dir))
  const fullSorted = [...rows].sort((a, b) => compareRows(a, b, sortColumn, sort.dir))
  const incomplete = rows.some(r => r.missing || r.provisional)
  const netIncomplete = showNet && rows.some(r => r.nm === null)
  const maxWashes = Math.max(...rows.map(r => r.tw), 1)
  const summarize = selected => {
    const ids = new Set(selected.map(r => r.id))
    const known = selected.map(r => r.nm).filter(v => v !== null)
    return { ...agg(dayData.filter(r => ids.has(r.location_id))),
      incomplete: selected.some(r => r.missing || r.provisional),
      netIncomplete: showNet && selected.some(r => r.nm === null),
      netTotal: known.length ? known.reduce((sum, v) => sum + v, 0) : null }
  }
  const totals = summarize(rows), filteredTotals = summarize(displayedRows)
  const fullLabel = filtered ? (incomplete ? 'Full-data provisional subtotal' : 'Full-data totals') : incomplete ? 'Provisional subtotal' : 'Totals'
  const filteredLabel = filteredTotals.incomplete ? 'Filtered provisional subtotal' : 'Filtered subtotal'
  const exportValue = (r, key) => key === 'name' ? r.name + (r.missing ? ' (Unavailable)' : r.provisional ? ' (Provisional)' : '')
    : key === 'nm' ? r.nm ?? '' : KPI_COLUMNS.find(c => c.key === key)?.budget ? budgetCell(r, key)
      : r.missing ? '' : r[key] ?? ''
  const totalValue = (summary, key, label) => key === 'name' ? label : key === 'nm' ? summary.netTotal ?? ''
    : KPI_COLUMNS.find(c => c.key === key)?.budget ? '' : summary[key]
  const buildExport = (exportColumns, exportRows, summary, label, visible) => {
    const fields = exportColumns.flatMap(c => [
      { key: c.key, label: c.label, type: c.key === 'p_mix' ? 'pmix' : c.key === 'conversion' ? 'conv' : c.type === 'text' || c.budget ? 'text' : 'num' },
      ...(c.key === 'nm' ? [{ key: 'netThrough', label: 'Net Members through', type: 'text' }] : []),
    ])
    return {
      filename: `${daily ? 'todays-performance' : title === 'MTD Performance' ? 'mtd-performance' : 'site-performance'}_${dateRange.start}_to_${dateRange.end}${visible ? '_visible' : ''}`,
      title,
      subtitle: fmtDateRange(dateRange.start, dateRange.end) + (source.active ? ' — Budget Tracking priority; stale/missing sites make totals provisional' : '')
        + (visible && filtered ? ` — Filtered: ${displayedRows.length} of ${rows.length} locations; companywide ranks unchanged` : ''),
      columns: fields.map(({ label, type }) => ({ label, type })),
      rows: exportRows.map(r => fields.map(c => c.key === 'netThrough' ? r.netStatus?.through ?? '' : exportValue(r, c.key))),
      totalsRow: fields.map(c => c.key === 'netThrough' ? '' : totalValue(summary, c.key, label)),
    }
  }
  const exportSpec = buildExport(allColumns, fullSorted, totals, incomplete ? 'Provisional subtotal' : 'Totals', false)
  const visibleExport = buildExport(columns, sorted, filteredTotals, filtered ? filteredLabel : fullLabel, true)

  const cell = (r, key) => {
    const cls = 'border border-gray-200 dark:border-tm-dark-border px-3 py-2'
    if (key === 'name') return <td key={key} data-column={key} className={`${cls} sticky left-0 z-10 bg-inherit min-w-[180px] font-medium font-brand dark:text-tm-dark-text`}>{r.name}{daily && <div className="text-[10px] font-normal text-gray-500 dark:text-tm-dark-muted">{r.status?.date} · {r.missing ? 'No Update Yet' : 'Reported'}{!r.missing && <><br />Last Updated: {r.status?.updatedAt ? new Date(r.status.updatedAt).toLocaleTimeString('en-US', { timeZone: r.status.timezone, timeZoneName: 'short' }) : 'Unavailable'}</>}</div>}
      {!daily && r.missing && <div className="text-[10px] font-normal">MTD unavailable</div>}
    </td>
    if (key === 'tw') return <td key={key} data-column={key} className={cls}>{r.missing ? '—' : <MiniBar value={r.tw} max={maxWashes} />}</td>
    if (key === 'nm') return <td key={key} data-column={key} title={r.netStatus?.message} className={`${cls} text-center font-semibold ${netMembersCls(r.nm)}`}>
      {r.nm === null ? '—' : r.nm.toLocaleString('en-US')}
      {r.netStatus?.through && <div className="text-[10px] font-normal max-w-[180px]">Last entry: {new Date(`${r.netStatus.through}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</div>}
    </td>
    if (key === 'p_mix' || key === 'conversion') {
      const color = r.budget ? REPORT_STATUS_CLS[r.budget.formatting[key === 'p_mix' ? 'mtdPmix' : 'mtdConversion']]
        : r.missing || r.provisional ? 'text-gray-600 dark:text-gray-300' : key === 'p_mix' ? pmixCls(r.p_mix, r.thresholds) : convCls(r.conversion, r.thresholds)
      return <td key={key} data-column={key} className={`${cls} text-center font-semibold ${color}`}>{r.missing ? '—' : r[key]}</td>
    }
    if (KPI_COLUMNS.find(c => c.key === key)?.budget) return <td key={key} data-column={key} className={`${cls} text-center dark:text-tm-dark-text`}>
      {key === 'score' ? <BudgetScoreDetails result={r.budget?.scoringResult} /> : budgetCell(r, key)}
      {key === 'revenuePct' && r.budget?.formatting.provisional && <span className="block text-[10px] font-normal">Provisional</span>}
      {key === 'revenuePct' && r.budget?.formatting.stale && <span className="block text-[10px] font-normal">Stale entry</span>}
    </td>
    return <td key={key} data-column={key} className={`${cls} text-center dark:text-tm-dark-text`}>{r.missing || r[key] == null ? '—' : (fmtNum(r[key]) || '0')}</td>
  }
  const totalsRow = (summary, label) => <tr key={label} className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
    {columns.map(c => {
      const key = c.key
      const cls = 'border border-gray-300 dark:border-tm-dark-border px-3 py-2'
      if (key === 'name') return <td key={key} data-column={key} className={`${cls} sticky left-0 z-10 bg-tm-cream dark:bg-tm-dark-surface font-brand dark:text-tm-dark-text`}>{label}</td>
      if (key === 'nm') return <td key={key} data-column={key} title={summary.netIncomplete ? 'Provisional Net Members subtotal' : 'Net Members total'} className={`${cls} text-center ${netMembersCls(summary.netTotal)}`}>{summary.netTotal === null ? '—' : summary.netTotal.toLocaleString('en-US')}</td>
      if (key === 'p_mix' || key === 'conversion') return <td key={key} data-column={key} className={`${cls} text-center ${summary.incomplete ? 'text-gray-600 dark:text-gray-300' : key === 'p_mix' ? pmixTotalsCls(summary.p_mix) : convTotalsCls(summary.conversion)}`}>{summary[key]}</td>
      return <td key={key} data-column={key} className={`${cls} text-center dark:text-tm-dark-text`}>{c.budget ? '—' : fmtNum(summary[key])}</td>
    })}
  </tr>

  return (
    <div>
      <BudgetSourceNote source={source} />
      {incomplete && <p className="text-xs mb-2 text-gray-700 dark:text-gray-200">Provisional subtotal: unavailable locations are excluded. {daily ? 'Sites without a reported Daily Log are shown below.' : 'See source details where available.'}</p>}
      {showNet && <p className="text-xs mb-2 text-gray-500">Net Members values use each location’s last supported date shown below; the subtotal combines those dated values.</p>}
      {netIncomplete && <p className="text-xs mb-2 text-gray-700 dark:text-gray-200">Net Members subtotal excludes unavailable locations; missing snapshots or daily losses are not treated as zero.</p>}
      <KpiTableControls columns={allColumns} config={config} update={update} reset={reset} unsaved={preferences.unsaved} />
      <p role="status" className="text-xs mb-2 dark:text-tm-dark-text">{filtered ? `Filtered: ${displayedRows.length} of ${rows.length} locations. Filtered subtotals and full-data totals are shown separately. Companywide ranks are unchanged.` : `${rows.length} locations. Totals include all locations in the selected site/market scope.`} Sorted by {sortColumn.label} ({sort.dir === 'asc' ? 'ascending' : 'descending'}{!columns.some(c => c.key === sortColumn.key) ? '; hidden column' : ''}).</p>
      <div className="flex justify-end mb-3">
        <ExportMenu items={[
          { label: 'Excel (.xlsx) — all data & columns', run: () => exportXlsx(exportSpec) },
          { label: 'PDF — all data & columns', run: () => exportPdf(exportSpec) },
          { label: 'CSV — all data & columns', run: () => exportCsv(exportSpec) },
          { label: 'Excel (.xlsx) — visible filtered table', run: () => exportXlsx(visibleExport) },
          { label: 'PDF — visible filtered table', run: () => exportPdf(visibleExport) },
          { label: 'CSV — visible filtered table', run: () => exportCsv(visibleExport) },
        ]} />
      </div>
      <div role="region" aria-label={`${title} scrollable table`} tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-tm-teal">
        <table aria-label={title} className={`w-full ${columns.length > 4 ? 'min-w-[800px]' : ''} border-collapse text-xs`}>
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              {columns.map(c => (
                <th key={c.key} data-column={c.key} scope="col" aria-sort={sortColumn.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${thCls} ${c.align === 'left' ? 'text-left' : 'text-center'} ${c.key === 'name' ? 'sticky left-0 z-20 bg-tm-blue dark:bg-tm-navy' : ''}`}>
                  <button type="button" className="w-full min-h-[40px] text-inherit focus-visible:outline focus-visible:outline-2 focus-visible:outline-tm-teal" onClick={() => toggleSort(c.key)}>{c.label}<SortIcon active={sortColumn.key === c.key} dir={sort.dir} /></button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => <tr key={r.id} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>{columns.map(c => cell(r, c.key))}</tr>)}
            {!sorted.length && <tr><td colSpan={columns.length} className="p-4 text-center dark:text-tm-dark-text">No locations match the column filters.</td></tr>}
            {filtered && totalsRow(filteredTotals, filteredLabel)}
            {totalsRow(totals, fullLabel)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
