import { useState } from 'react'
import { employeeDeltasByDay } from '../utils/logMath'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { pct, pctN, thCls } from '../utils/insightsHelpers'
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
  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.col === 'name') return dir * a.name.localeCompare(b.name)
    if (sort.col === 'site') return dir * (a.site ?? '').localeCompare(b.site ?? '')
    if (sort.col === 'p_mix')      return dir * ((a.pmixN ?? -1) - (b.pmixN ?? -1))
    if (sort.col === 'conversion') return dir * ((a.convN ?? -1) - (b.convN ?? -1))
    return dir * ((a[sort.col] ?? 0) - (b[sort.col] ?? 0))
  })

  return (
    <>
      {sorted.map((r, i) => (
        <tr key={r.key} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-medium font-brand dark:text-tm-dark-text">{r.name}</td>
          {showSite && (
            <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-gray-500 dark:text-tm-dark-muted font-brand text-xs">{r.site}</td>
          )}
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-mono dark:text-tm-dark-text">{fmtNum(r.ms)}</td>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-mono dark:text-tm-dark-text">{fmtNum(r.gr)}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
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
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">Totals</td>
      {showSite && <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2" />}
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totMS)}</td>
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totGR)}</td>
      <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${pmixTotalsCls(p_mix)}`}>{p_mix}</td>
      <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${convTotalsCls(conversion)}`}>{conversion}</td>
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
]
const COLS_SPLIT = COLS_COMBINED.filter(c => c.key !== 'site')

export default function TeamSalesTable({ data, locations, dateRange }) {
  const [splitByShop, setSplitByShop] = useState(false)
  const [sort, toggleSort]            = useSortState('ms', 'desc')

  if (!data.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  const dayMap = {}
  data.forEach(r => {
    const key = `${r.location_id}::${r.log_date}`
    if (!dayMap[key]) dayMap[key] = { locationId: r.location_id, rows: [] }
    dayMap[key].rows.push(r)
  })

  const empAccum = {}
  Object.values(dayMap).forEach(({ locationId, rows }) => {
    const deltas = employeeDeltasByDay(rows)
    Object.entries(deltas).forEach(([name, d]) => {
      const key = `${locationId}::${name.toLowerCase()}`
      if (!empAccum[key]) {
        empAccum[key] = {
          key, name, locationId,
          site: locations.find(l => l.id === locationId)?.name ?? '',
          total_washes: 0, member_washes: 0, google_reviews: 0,
          basic: 0, good: 0, better: 0, best: 0,
        }
      }
      const e = empAccum[key]
      e.total_washes   += d.total_washes
      e.member_washes  += d.member_washes
      e.google_reviews += d.google_reviews
      e.basic          += d.basic
      e.good           += d.good
      e.better         += d.better
      e.best           += d.best
    })
  })

  const allRows = Object.values(empAccum).map(e => {
    const ms  = e.basic + e.good + e.better + e.best
    const formula = locations.find(l => l.id === e.locationId)?.opportunities_formula
    const opp = formula === 'simple'
      ? Math.max(0, e.total_washes - e.member_washes)
      : Math.max(0, e.total_washes - e.member_washes + ms)
    return {
      key:        e.key,
      name:       e.name,
      locationId: e.locationId,
      site:       e.site,
      ms, opp,
      gr:         e.google_reviews,
      better:     e.better,
      best:       e.best,
      pmixN:      pctN(e.better + e.best, ms),
      convN:      pctN(ms, opp),
      p_mix:      pct(e.better + e.best, ms),
      conversion: pct(ms, opp),
    }
  })

  if (!allRows.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No employee data entered for this period.</div>
  )

  const TableHead = ({ cols }) => (
    <thead>
      <tr className="bg-tm-blue dark:bg-tm-navy text-white">
        {cols.map(c => (
          <th key={c.key} className={`${thCls} text-left`} onClick={() => toggleSort(c.key)}>
            {c.label}<SortIcon active={sort.col === c.key} dir={sort.dir} />
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
    ],
    rows: [...allRows]
      .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
      .map(r => [r.name, r.site, r.ms, r.gr, r.p_mix, r.conversion]),
    totalsRow: ['Totals', '', totMS, totGR, pct(totBetter + totBest, totMS), pct(totMS, totOpp)],
  }

  return (
    <div>
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
