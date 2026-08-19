import { useState } from 'react'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { toInt, pct, pctN, parsePct, agg, toDayTotals, thCls } from '../utils/insightsHelpers'
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

export default function SiteMetricTable({ data, locations, dateRange }) {
  const [sort, toggleSort] = useSortState('tw', 'desc')

  if (!data.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  const dayData = toDayTotals(data)
  const totals  = agg(dayData)
  const byLoc   = {}
  dayData.forEach(r => { ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r) })

  const rows = Object.entries(byLoc).map(([locId, rows]) => ({
    name: locations.find(l => l.id === locId)?.name || locId,
    ...agg(rows),
  }))

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.col === 'name')       return dir * a.name.localeCompare(b.name)
    if (sort.col === 'p_mix')      return dir * (parsePct(a.p_mix) - parsePct(b.p_mix))
    if (sort.col === 'conversion') return dir * (parsePct(a.conversion) - parsePct(b.conversion))
    return dir * ((a[sort.col] ?? 0) - (b[sort.col] ?? 0))
  })

  const maxWashes = Math.max(...sorted.map(r => r.tw), 1)

  const exportSpec = {
    filename: `site-performance_${dateRange.start}_to_${dateRange.end}`,
    title:    'Site Performance',
    subtitle: fmtDateRange(dateRange.start, dateRange.end),
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
    rows: sorted.map(r => [r.name, r.tw, r.mw, r.ms, r.opp, r.gr, r.p_mix, r.conversion]),
    totalsRow: ['Totals', totals.tw, totals.mw, totals.ms, totals.opp, totals.gr, totals.p_mix, totals.conversion],
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <ExportMenu items={[
          { label: 'Excel (.xlsx)', run: () => exportXlsx(exportSpec) },
          { label: 'PDF',           run: () => exportPdf(exportSpec)  },
          { label: 'CSV',           run: () => exportCsv(exportSpec)  },
        ]} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              {COLS.map(c => (
                <th key={c.key} className={`${thCls} text-${c.align}`} onClick={() => toggleSort(c.key)}>
                  {c.label}<SortIcon active={sort.col === c.key} dir={sort.dir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.name} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-medium font-brand dark:text-tm-dark-text">{r.name}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2"><MiniBar value={r.tw} max={maxWashes} /></td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.mw)}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.ms)}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.opp)}</td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.gr)}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
              </tr>
            ))}
            <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">Totals</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.tw)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.mw)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.ms)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.opp)}</td>
              <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.gr)}</td>
              <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${pmixTotalsCls(totals.p_mix)}`}>{totals.p_mix}</td>
              <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${convTotalsCls(totals.conversion)}`}>{totals.conversion}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
