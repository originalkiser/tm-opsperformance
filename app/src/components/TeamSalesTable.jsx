import { useState } from 'react'
import { buildEmployeePerformance, sortEmployeeRows, employeeRankLabel, MIN_EMPLOYEE_OPPORTUNITIES } from '../utils/employeePerformance.js'
import EmployeeScoreDetails from './EmployeeScoreDetails'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { pct, thCls } from '../utils/insightsHelpers'
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

function SalesRows({ rows, showSite, sort }) {
  const sorted = sortEmployeeRows(rows, sort)

  return (
    <>
      {sorted.map((r, i) => (
        <tr key={r.key} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-medium font-brand dark:text-tm-dark-text">{r.name}{r.partial && <span className="block text-[10px] text-amber-700 dark:text-amber-300">Partial · unreliable days excluded</span>}</td>
          {showSite && (
            <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-gray-500 dark:text-tm-dark-muted font-brand text-xs">{r.site}</td>
          )}
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-mono dark:text-tm-dark-text">{r.ms == null ? '—' : fmtNum(r.ms) || '0'}</td>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-mono dark:text-tm-dark-text">{r.gr == null ? '—' : fmtNum(r.gr) || '0'}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center"><EmployeeScoreDetails row={r} /></td>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center whitespace-nowrap">{employeeRankLabel(r)}</td>
        </tr>
      ))}
    </>
  )
}

function TotalsRow({ rows, showSite }) {
  let totMS = 0, totGR = 0, totBetter = 0, totBest = 0, totOpp = 0
  rows.forEach(r => {
    totMS     += r.ms      || 0
    totGR     += r.gr      || 0
    totBetter += r.better  || 0
    totBest   += r.best    || 0
    totOpp    += r.opp     || 0
  })
  const p_mix      = pct(totBetter + totBest, totMS)
  const conversion = pct(totMS, totOpp)
  return (
    <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">{rows.some(r => r.partial) ? 'Known-day subtotal' : 'Totals'}</td>
      {showSite && <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2" />}
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totMS)}</td>
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totGR)}</td>
      <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${pmixTotalsCls(p_mix)}`}>{p_mix}</td>
      <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${convTotalsCls(conversion)}`}>{conversion}</td>
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center">—</td>
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center">—</td>
    </tr>
  )
}

const COLS_COMBINED = [
  { key: 'name',       label: 'Employee'       },
  { key: 'site',       label: 'Site'           },
  { key: 'ms',         label: 'Memberships'    },
  { key: 'gr',         label: 'Google Reviews' },
  { key: 'p_mix',      label: 'P-Mix'          },
  { key: 'conversion', label: 'Conversion'     },
  { key: 'score', label: 'Score' },
  { key: 'rank', label: 'Rank' },
]
const COLS_SPLIT = COLS_COMBINED.filter(c => c.key !== 'site')

export default function TeamSalesTable({ data, locations, dateRange, dataComplete = true }) {
  const [splitByShop, setSplitByShop] = useState(false)
  const [sort, toggleSort]            = useSortState('ms', 'desc')

  if (!dataComplete) return <p role="alert" className="text-sm text-red-600">Team Sales data is incomplete or still loading. Reload the report before scoring.</p>

  if (!data.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  const { rows: allRows, excludedDays } = buildEmployeePerformance(data, locations, dateRange)

  if (!allRows.length) return (
    <div role="status" className="text-sm text-gray-500 dark:text-tm-dark-muted py-4">No reliably attributed employee data for this period. {excludedDays.map(day => <p key={`${day.locationId}:${day.date}`}>{day.site} · {day.issues.join('; ')}</p>)}</div>
  )

  const TableHead = ({ cols }) => (
    <thead>
      <tr className="bg-tm-blue dark:bg-tm-navy text-white">
        {cols.map(c => (
          <th key={c.key} scope="col" aria-sort={sort.col === c.key ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none'} className={`${thCls} text-left`}>
            <button type="button" className="w-full text-left" onClick={() => toggleSort(c.key)}>{c.label}<SortIcon active={sort.col === c.key} dir={sort.dir} /></button>
          </th>
        ))}
      </tr>
    </thead>
  )

  let totMS = 0, totGR = 0, totBetter = 0, totBest = 0, totOpp = 0
  allRows.forEach(r => {
    totMS += r.ms || 0; totGR += r.gr || 0
    totBetter += r.better || 0; totBest += r.best || 0; totOpp += r.opp || 0
  })

  const exportSpec = {
    filename: `team-member-sales_${dateRange.start}_to_${dateRange.end}`,
    title:    'Team Member Sales',
    subtitle: fmtDateRange(dateRange.start, dateRange.end),
    columns: [
      { label: 'Employee',       type: 'text' },
      { label: 'Site',           type: 'text' },
      { label: 'Memberships',    type: 'num'  },
      { label: 'Google Reviews', type: 'num'  },
      { label: 'P-Mix',          type: 'pmix' },
      { label: 'Conversion',     type: 'conv' },
      { label: 'Score', type: 'num' },
      { label: 'Rank (formula cohort)', type: 'text' },
      { label: 'Scoring / attribution status', type: 'text' },
    ],
    rows: sortEmployeeRows(allRows, sort).map(r => [r.name, r.site, r.ms ?? '', r.gr ?? '', r.p_mix, r.conversion, r.score ?? '', employeeRankLabel(r), r.issues.join('; ') || 'Eligible']),
    totalsRow: [excludedDays.length ? 'Known-day subtotal' : 'Totals', '', totMS, totGR, pct(totBetter + totBest, totMS), pct(totMS, totOpp), '', '', ''],
  }

  return (
    <div>
      <p className="text-xs mb-3 text-gray-600 dark:text-gray-300">Recorded employee/site activity: Sales 33.33 + Conversion 33.33 + P-Mix 33.34 = 100 points. Official eligibility requires {MIN_EMPLOYEE_OPPORTUNITIES} opportunities, membership sales, and reliable attribution. Conversion benchmarks and ranks are separate for Simple/Detailed formulas. Display filters define the comparison pool. Google Reviews do not affect scoring.</p>
      {excludedDays.length > 0 && <div role="status" className="text-xs mb-3 text-amber-800 dark:text-amber-300">
        Unreliable site-days are excluded from employee totals; all employee scores for the affected site/period are withheld. Totals below are known-day subtotals, not complete shop totals.
        <details><summary className="cursor-pointer">Attribution issues · {excludedDays.length} excluded site-days</summary>{excludedDays.map(day => <p key={`${day.locationId}:${day.date}`}>{day.site} · {day.date}: {day.issues.join('; ')}</p>)}</details>
      </div>}
      <div className="flex justify-end gap-2 mb-3">
        <ExportMenu items={[
          { label: 'Excel (.xlsx)', run: () => exportXlsx(exportSpec) },
          { label: 'PDF',           run: () => exportPdf(exportSpec)  },
          { label: 'CSV',           run: () => exportCsv(exportSpec)  },
        ]} />
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-tm-dark-border shadow-sm">
          {[
            { label: 'Combined', val: false },
            { label: 'By Site',  val: true  },
          ].map(({ label, val }) => (
            <button
              key={label}
              onClick={() => setSplitByShop(val)}
              className={`px-3 py-1.5 text-xs font-brand font-semibold transition-colors border-r last:border-r-0 border-gray-200 dark:border-tm-dark-border
                ${splitByShop === val
                  ? 'bg-tm-blue dark:bg-tm-navy text-white'
                  : 'bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue dark:hover:text-white'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {splitByShop ? (
        <div className="space-y-5">
          {locations.map(loc => {
            const locRows = allRows.filter(r => r.locationId === loc.id)
            if (!locRows.length) return null
            return (
              <div key={loc.id}>
                <p className="text-xs font-brand font-semibold text-tm-blue dark:text-tm-teal mb-1.5 uppercase tracking-wide">{loc.name}</p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <TableHead cols={COLS_SPLIT} />
                    <tbody>
                      <SalesRows rows={locRows} showSite={false} sort={sort} />
                      <TotalsRow rows={locRows} showSite={false} />
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <TableHead cols={COLS_COMBINED} />
            <tbody>
              <SalesRows rows={allRows} showSite sort={sort} />
              <TotalsRow rows={allRows} showSite />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
