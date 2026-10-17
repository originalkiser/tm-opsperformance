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

export default function SiteMetricTable({ data, locations, dateRange, title = 'Site Performance', companyRead = false }) {
  const source = useBudgetPerformance(data, locations, dateRange, { companyRead })
  return <PerformanceTable source={source} locations={locations} dateRange={dateRange} title={title} />
}

// Shared compact, sortable presentation; source selection stays outside the table.
export function PerformanceTable({ source, locations, dateRange, title = 'Site Performance', daily = false }) {
  const [sort, toggleSort] = useSortState('tw', 'desc')

  const dayData = source.totals
  const totals  = agg(dayData)
  const byLoc   = {}
  dayData.forEach(r => { ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r) })

  const rows = locations.map(loc => ({
    name: loc.name,
    ...agg(byLoc[loc.id] || []),
    missing: !byLoc[loc.id]?.length,
    thresholds: loc.metric_thresholds,
    status: source.statuses?.[loc.id],
    provisional: source.notes.some(n => n.id === loc.id && !n.complete),
  }))
  const incomplete = rows.some(r => r.missing || r.provisional)

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
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
    ],
    rows: sorted.map(r => [r.name + (r.missing ? ' (Unavailable)' : r.provisional ? ' (Provisional)' : ''), ...[r.tw, r.mw, r.ms, r.opp, r.gr, r.p_mix, r.conversion].map(v => r.missing ? '' : v)]),
    totalsRow: [incomplete ? 'Provisional subtotal' : 'Totals', totals.tw, totals.mw, totals.ms, totals.opp, totals.gr, totals.p_mix, totals.conversion],
  }

  return (
    <div>
      <BudgetSourceNote source={source} />
      {incomplete && <p className="text-xs mb-2 text-gray-700 dark:text-gray-200">Provisional subtotal: unavailable locations are excluded. {daily ? 'Sites without a reported Daily Log are shown below.' : 'See source details where available.'}</p>}
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
              {COLS.map(c => (
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
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.missing ? '—' : (fmtNum(r.gr) || '0')}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${r.missing || r.provisional ? 'text-gray-600 dark:text-gray-300' : pmixCls(r.p_mix, r.thresholds)}`}>{r.missing ? '—' : r.p_mix}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${r.missing || r.provisional ? 'text-gray-600 dark:text-gray-300' : convCls(r.conversion, r.thresholds)}`}>{r.missing ? '—' : r.conversion}</td>
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
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
