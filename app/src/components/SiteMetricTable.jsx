import BudgetScoreDetails, { formatBudgetScore } from './BudgetScoreDetails'
import { displayMoney, displayCount } from '../utils/budgetDisplay'
import { pct1 } from '../utils/budgetMath'
import { REPORT_STATUS_CLS } from '../utils/metricColors'
import { netMembersCls } from '../utils/netMemberColors'
import { compareNetMembers } from '../utils/dashboardNetMembers'
import useBudgetPerformance from '../hooks/useBudgetPerformance'
import BudgetSourceNote from './BudgetSourceNote'
import { useState } from 'react'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { parsePct, agg, thCls } from '../utils/insightsHelpers'
import { exportCsv, exportXlsx, exportPdf } from '../utils/exportTable'
import { fmtDateRange } from './DateSelector'
import ExportMenu from './ExportMenu'

function SortIcon({ active, dir }) {
  if (!active) return <span className="ml-1 opacity-25 text-[10px]">↕</span>
  return <span className="ml-1 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
}

function useSortState(defaultCol, defaultDir = 'desc') {
  const [sort, setSort] = useState({ col: defaultCol, dir: defaultDir })
  const toggle = (col) => setSort(s => ({
    col,
    dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc',
  }))
  return [sort, toggle]
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

const COLS = [
  { key: 'name',       label: 'Location',        align: 'left'   },
  { key: 'tw',         label: 'Total Washes',     align: 'left'   },
  { key: 'mw',         label: 'Member Washes',    align: 'center' },
  { key: 'ms',         label: 'Memberships Sold', align: 'center' },
  { key: 'opp',        label: 'Opportunities',    align: 'center' },
  { key: 'gr',         label: 'Google Reviews',   align: 'center' },
  { key: 'p_mix',      label: 'P-Mix',            align: 'center' },
  { key: 'conversion', label: 'Conversion',       align: 'center' },
]

const BUDGET_COLS = [
  { key: 'rank', label: 'Rank' },
  { key: 'revenue', label: 'MTD Revenue' },
  { key: 'members', label: 'Total Members' },
  { key: 'revenuePct', label: 'Revenue %' },
  { key: 'planPct', label: 'MTD Goal %' },
  { key: 'growth', label: 'Membership Growth' },
  { key: 'expectedGrowth', label: 'Expected Growth' },
  { key: 'rating', label: 'Rating' },
  { key: 'score', label: 'Score' },
]
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

export default function SiteMetricTable({ data, locations, dateRange, title = 'Site Performance', companyRead = false, netMembers }) {
  const source = useBudgetPerformance(data, locations, dateRange, { companyRead })
  return <PerformanceTable source={source} locations={locations} dateRange={dateRange} title={title} netMembers={netMembers} />
}

// Shared compact, sortable presentation; source selection stays outside the table.
export function PerformanceTable({ source, locations, dateRange, title = 'Site Performance', daily = false, netMembers = source.netMembers, budgetRows }) {
  const [sort, toggleSort] = useSortState(budgetRows ? 'score' : 'tw', 'desc')
  const showNet = netMembers !== undefined
  const baseColumns = showNet ? [...COLS, { key: 'nm', label: 'Net Members', align: 'center' }] : COLS
  const columns = budgetRows ? [...baseColumns, ...BUDGET_COLS] : baseColumns
  const budgetById = new Map((budgetRows || []).map(r => [r.loc.id, r]))

  const dayData = source.totals
  const totals  = agg(dayData)
  const byLoc   = {}
  dayData.forEach(r => { ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r) })

  const rows = locations.map(loc => {
    const budget = budgetById.get(loc.id)
    return {
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
  const netIncomplete = showNet && rows.some(r => r.nm === null)
  const knownNets = rows.map(r => r.nm).filter(v => v !== null)
  const netTotal = knownNets.length ? knownNets.reduce((sum, v) => sum + v, 0) : null
  const incomplete = rows.some(r => r.missing || r.provisional)

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (budgetRows && BUDGET_COLS.some(c => c.key === sort.col)) {
      const av = a[sort.col], bv = b[sort.col]
      if (av == null || bv == null) return av == null ? bv == null ? a.name.localeCompare(b.name) : 1 : -1
      return dir * (Number(av) - Number(bv)) || a.name.localeCompare(b.name)
    }
    if (sort.col === 'nm') return compareNetMembers(a.nm, b.nm, sort.dir)
    if (sort.col === 'name')       return dir * a.name.localeCompare(b.name)
    if (sort.col === 'p_mix')      return dir * (parsePct(a.p_mix) - parsePct(b.p_mix))
    if (sort.col === 'conversion') return dir * (parsePct(a.conversion) - parsePct(b.conversion))
    return dir * ((a[sort.col] ?? 0) - (b[sort.col] ?? 0))
  })

  const maxWashes = Math.max(...sorted.map(r => r.tw), 1)

  const exportSpec = {
    filename: `${daily ? 'todays-performance' : title === 'MTD Performance' ? 'mtd-performance' : 'site-performance'}_${dateRange.start}_to_${dateRange.end}`,
    title,
    subtitle: fmtDateRange(dateRange.start, dateRange.end) + (source.active ? ' — Budget Tracking priority; stale/missing sites make totals provisional' : ''),
    columns: [
      { label: 'Location',         type: 'text' },
      { label: 'Total Washes',     type: 'num'  },
      { label: 'Member Washes',    type: 'num'  },
      { label: 'Memberships Sold', type: 'num'  },
      { label: 'Opportunities',    type: 'num'  },
      { label: 'Google Reviews',   type: 'num'  },
      { label: 'P-Mix',            type: 'pmix' },
      { label: 'Conversion',       type: 'conv' },
      ...(showNet ? [{label:'Net Members',type:'num'}, {label:'Net Members through',type:'text'}] : []),
      ...(budgetRows ? BUDGET_COLS.map(c => ({ label: c.label, type: 'text' })) : []),
    ],
    rows: sorted.map(r => [r.name + (r.missing ? ' (Unavailable)' : r.provisional ? ' (Provisional)' : ''), ...[r.tw, r.mw, r.ms, r.opp, r.gr, r.p_mix, r.conversion].map(v => r.missing ? '' : v), ...(showNet ? [r.nm ?? '', r.netStatus?.through ?? ''] : []), ...(budgetRows ? BUDGET_COLS.map(c => budgetCell(r, c.key)) : [])]),
    totalsRow: [incomplete ? 'Provisional subtotal' : 'Totals', totals.tw, totals.mw, totals.ms, totals.opp, totals.gr, totals.p_mix, totals.conversion, ...(showNet ? [netTotal ?? '', ''] : []), ...(budgetRows ? BUDGET_COLS.map(() => '') : [])],
  }

  return (
    <div>
      <BudgetSourceNote source={source} />
      {incomplete && <p className="text-xs mb-2 text-gray-700 dark:text-gray-200">Provisional subtotal: unavailable locations are excluded. {daily ? 'Sites without a reported Daily Log are shown below.' : 'See source details where available.'}</p>}
      {showNet && <p className="text-xs mb-2 text-gray-500">Net Members values use each location’s last supported date shown below; the subtotal combines those dated values.</p>}
      {netIncomplete && <p className="text-xs mb-2 text-gray-700 dark:text-gray-200">Net Members subtotal excludes unavailable locations; missing snapshots or daily losses are not treated as zero.</p>}
      <div className="flex justify-end mb-3">
        <ExportMenu items={[
          { label: 'Excel (.xlsx)', run: () => exportXlsx(exportSpec) },
          { label: 'PDF',           run: () => exportPdf(exportSpec)  },
          { label: 'CSV',           run: () => exportCsv(exportSpec)  },
        ]} />
      </div>
      <div className="overflow-x-auto">
        <table aria-label={title} className="w-full min-w-[800px] border-collapse text-xs">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              {columns.map(c => (
                <th key={c.key} scope="col" aria-sort={sort.col === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${thCls} ${c.align === 'left' ? 'text-left' : 'text-center'}`}>
                  <button className="w-full text-inherit" onClick={() => toggleSort(c.key)}>{c.label}<SortIcon active={sort.col === c.key} dir={sort.dir} /></button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.name} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 min-w-[180px] font-medium font-brand dark:text-tm-dark-text">{r.name}{daily && <div className="text-[10px] font-normal text-gray-500 dark:text-tm-dark-muted">{r.status?.date} · {r.missing ? 'No Update Yet' : 'Reported'}{!r.missing && <><br />Last Updated: {r.status?.updatedAt ? new Date(r.status.updatedAt).toLocaleTimeString('en-US', { timeZone: r.status.timezone, timeZoneName: 'short' }) : 'Unavailable'}</>}</div>}
                  {!daily && r.missing && <div className="text-[10px] font-normal">MTD unavailable</div>}
                </td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2">{r.missing ? '—' : <MiniBar value={r.tw} max={maxWashes} />}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.missing ? '—' : (fmtNum(r.mw) || '0')}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.missing ? '—' : (fmtNum(r.ms) || '0')}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.missing ? '—' : (fmtNum(r.opp) || '0')}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.missing || r.gr == null ? '—' : (fmtNum(r.gr) || '0')}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${r.budget ? REPORT_STATUS_CLS[r.budget.formatting.mtdPmix] : r.missing || r.provisional ? 'text-gray-600 dark:text-gray-300' : pmixCls(r.p_mix, r.thresholds)}`}>{r.missing ? '—' : r.p_mix}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${r.budget ? REPORT_STATUS_CLS[r.budget.formatting.mtdConversion] : r.missing || r.provisional ? 'text-gray-600 dark:text-gray-300' : convCls(r.conversion, r.thresholds)}`}>{r.missing ? '—' : r.conversion}</td>
                {showNet && <td title={r.netStatus?.message} className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${netMembersCls(r.nm)}`}>
                  {r.nm === null ? '—' : r.nm.toLocaleString('en-US')}
                  {r.netStatus?.through && <div className="text-[10px] font-normal max-w-[180px]">Last entry: {new Date(`${r.netStatus.through}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</div>}
                </td>}
                {budgetRows && BUDGET_COLS.map(c => <td key={c.key} className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">
                  {c.key === 'score' ? <BudgetScoreDetails result={r.budget?.scoringResult} /> : budgetCell(r, c.key)}
                  {c.key === 'revenuePct' && r.budget?.formatting.provisional && <span className="block text-[10px] font-normal">Provisional</span>}
                  {c.key === 'revenuePct' && r.budget?.formatting.stale && <span className="block text-[10px] font-normal">Stale entry</span>}
                </td>)}
              </tr>
            ))}
            <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">{incomplete ? 'Provisional subtotal' : 'Totals'}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.tw)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.mw)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.ms)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.opp)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.gr)}</td>
              <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${incomplete ? 'text-gray-600 dark:text-gray-300' : pmixTotalsCls(totals.p_mix)}`}>{totals.p_mix}</td>
              <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${incomplete ? 'text-gray-600 dark:text-gray-300' : convTotalsCls(totals.conversion)}`}>{totals.conversion}</td>
              {showNet && <td title={netIncomplete ? 'Provisional Net Members subtotal' : 'Net Members total'} className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${netMembersCls(netTotal)}`}>{netTotal === null ? '—' : netTotal.toLocaleString('en-US')}</td>}
              {budgetRows && BUDGET_COLS.map(c => <td key={c.key} className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center">—</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
