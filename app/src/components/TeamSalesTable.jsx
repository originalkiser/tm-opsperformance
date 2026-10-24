import { useState } from 'react'
import { buildEmployeePerformance, sortEmployeeRows, employeeRankLabel } from '../utils/employeePerformance.js'
import EmployeeScoreDetails from './EmployeeScoreDetails'
import { pmixCls, convCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { thCls } from '../utils/insightsHelpers'
import { exportCsv, exportXlsx, exportPdf } from '../utils/exportTable'
import { fmtDateRange } from './DateSelector'
import ExportMenu from './ExportMenu'

const COLS = [
  { key: 'rank', label: 'Rank', type: 'text' },
  { key: 'name', label: 'Employee', type: 'text' },
  { key: 'site', label: 'Site', type: 'text' },
  { key: 'ms', label: 'Total Sales', type: 'num' },
  { key: 'opp', label: 'Total Opportunities', type: 'num' },
  { key: 'conversion', label: 'Conversion %', type: 'conv' },
  { key: 'p_mix', label: 'P-Mix %', type: 'pmix' },
  { key: 'score', label: 'Total Points', type: 'num' },
]
const cell = 'border border-gray-200 dark:border-tm-dark-border px-3 py-2 dark:text-tm-dark-text'
const countLabel = value => value == null ? '—' : fmtNum(value) || '0'
const ratioLabel = (num, den) => num == null || den == null ? '—' : den > 0 ? `${(num / den * 100).toFixed(1)}%` : num === 0 ? '0.0%' : '—'

function totals(rows) {
  const sum = key => rows.some(r => r[key] == null) ? null : rows.reduce((n, r) => n + r[key], 0)
  const known = key => rows.reduce((n, r) => n + (r[key] ?? 0), 0)
  const ms = sum('ms'), opp = sum('opp')
  return [
    '', rows.some(r => r.ms == null || r.opp == null) ? 'Known attributed subtotal' : 'Totals', '',
    known('ms'), known('opp'), ratioLabel(ms, opp), ratioLabel(ms == null ? null : known('better') + known('best'), ms), '',
  ]
}

export default function TeamSalesTable({ data, locations, dateRange, dataComplete = true }) {
  const [splitByShop, setSplitByShop] = useState(false)
  const [sort, setSort] = useState({ col: 'rank', dir: 'asc' })
  const toggleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))

  if (!dataComplete) return <p role="alert" className="text-sm text-red-600">Team Sales data is incomplete or still loading. Reload the report before scoring.</p>
  if (!data.length) return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>

  const { rows: allRows, attributionNotes, cutoffs, qualificationSize, population } = buildEmployeePerformance(data, locations, dateRange)
  if (!allRows.length) return <div role="status" className="text-sm text-gray-500 dark:text-tm-dark-muted py-4">No named employee data for this period. {attributionNotes.map(day => <p key={`${day.locationId}:${day.date}`}>{day.site} · {day.issues.join('; ')}</p>)}</div>

  const exportSpec = {
    filename: `team-member-sales_${dateRange.start}_to_${dateRange.end}`,
    title: 'Team Member Sales',
    subtitle: `${fmtDateRange(dateRange.start, dateRange.end)} · Top 50% by sales OR opportunities; cutoff ties included · employee/site identities`,
    columns: [...COLS, { label: 'Data status', type: 'text' }],
    rows: sortEmployeeRows(allRows, sort).map(r => [employeeRankLabel(r), r.name, r.site, r.ms ?? '', r.opp ?? '', r.conversion, r.p_mix, r.score ?? '', r.issues.join('; ') || 'Complete recorded data']),
    totalsRow: [...totals(allRows), ''],
  }

  const TableHead = ({ cols }) => <thead><tr className="bg-tm-blue dark:bg-tm-navy text-white">
    {cols.map(c => <th key={c.key} scope="col" aria-sort={sort.col === c.key ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none'} className={`${thCls} text-left`}>
      <button type="button" className="w-full text-left focus-visible:outline focus-visible:outline-2" onClick={() => toggleSort(c.key)}>{c.label}<span aria-hidden="true" className="ml-1 text-[10px]">{sort.col === c.key ? sort.dir === 'asc' ? '↑' : '↓' : '↕'}</span></button>
    </th>)}
  </tr></thead>

  const Table = ({ rows, showSite }) => {
    const cols = showSite ? COLS : COLS.filter(c => c.key !== 'site')
    const total = totals(rows).filter((_, i) => showSite || i !== 2)
    return <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">
      <caption className="sr-only">Team Member Sales leaderboard, {fmtDateRange(dateRange.start, dateRange.end)}</caption>
      <TableHead cols={cols} />
      <tbody>
        {sortEmployeeRows(rows, sort).map((r, i) => <tr key={r.key} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
          <td className={`${cell} whitespace-nowrap`}>{employeeRankLabel(r)}</td>
          <td className={`${cell} font-medium font-brand`}>{r.name}</td>
          {showSite && <td className={`${cell} text-xs`}>{r.site}</td>}
          <td className={`${cell} text-center font-mono`}>{countLabel(r.ms)}</td>
          <td className={`${cell} text-center font-mono`}>{countLabel(r.opp)}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
          <td className={`${cell} text-center`}><EmployeeScoreDetails row={r} /></td>
        </tr>)}
        <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">{total.map((v, i) => <td key={i} className={`${cell} text-center`}>{v === '' ? '—' : v}</td>)}</tr>
      </tbody>
    </table></div>
  }

  return <div>
    <p className="text-xs mb-2 text-gray-600 dark:text-gray-300">Total Points = Total Sales + Conversion % + P-Mix %. Qualification: top 50% by sales OR opportunities, including cutoff ties.</p>
    <p className="text-xs mb-3 text-gray-600 dark:text-gray-300">{population} employee/site identities · Top {qualificationSize} cutoff: {countLabel(cutoffs.sales)} sales or {countLabel(cutoffs.opportunities)} opportunities. Same names at different sites remain separate.</p>
    {allRows.some(r => r.ms == null || r.opp == null) && <p role="status" className="text-xs mb-3 text-amber-800 dark:text-amber-300">Qualification compares known totals only; missing values cannot establish qualification. An incomplete score has no official rank.</p>}
    {attributionNotes.length > 0 && <details className="text-xs mb-3 text-amber-800 dark:text-amber-300">
      <summary className="cursor-pointer">Attribution notes · {attributionNotes.length} site-days</summary>
      {attributionNotes.map(day => <p key={`${day.locationId}:${day.date}`}>{day.site} · {day.date}: {day.issues.join('; ')}</p>)}
    </details>}
    <div className="flex flex-wrap justify-end gap-2 mb-3">
      <ExportMenu items={[
        { label: 'Excel (.xlsx)', run: () => exportXlsx(exportSpec) },
        { label: 'PDF', run: () => exportPdf(exportSpec) },
        { label: 'CSV', run: () => exportCsv(exportSpec) },
      ]} />
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-tm-dark-border shadow-sm">
        {[{ label: 'Combined', val: false }, { label: 'By Site', val: true }].map(({ label, val }) => <button key={label} type="button" aria-pressed={splitByShop === val} onClick={() => setSplitByShop(val)} className={`px-3 py-1.5 text-xs font-brand font-semibold ${splitByShop === val ? 'bg-tm-blue dark:bg-tm-navy text-white' : 'bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted'}`}>{label}</button>)}
      </div>
    </div>
    {splitByShop ? <div className="space-y-5">{locations.map(loc => {
      const rows = allRows.filter(r => r.locationId === loc.id)
      return rows.length ? <section key={loc.id} aria-label={loc.name}><h3 className="text-xs font-semibold text-tm-blue dark:text-tm-teal mb-1.5">{loc.name}</h3><Table rows={rows} showSite={false} /></section> : null
    })}</div> : <Table rows={allRows} showSite />}
  </div>
}
