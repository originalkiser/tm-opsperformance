import { useTeamSalesIdentities } from '../hooks/useTeamSalesIdentities'
import { usePosMembershipReport } from '../hooks/usePosMembershipReport'
import { joinTeamSalesPos, summarizeTeamSalesCoverage, teamSalesPosTotals } from '../utils/teamSalesPos.js'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readMappings } from '../utils/historicalEmployeeMappings.js'
import { buildTeamSalesPerformance, sortEmployeeRows, employeeRankLabel } from '../utils/employeePerformance.js'
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
  { key: 'ms', label: 'TM Ops Sales', type: 'num' },
  { key: 'posSales', label: 'POS Verified Sales', type: 'num' },
  { key: 'difference', label: 'Difference', type: 'num' },
  { key: 'opp', label: 'Total Opportunities', type: 'num' },
  { key: 'conversion', label: 'Conversion %', type: 'conv' },
  { key: 'p_mix', label: 'P-Mix %', type: 'pmix' },
  { key: 'score', label: 'Total Points', type: 'num' },
]
const cell = 'border border-gray-200 dark:border-tm-dark-border px-3 py-2 dark:text-tm-dark-text'
const countLabel = value => value == null ? '—' : fmtNum(value) || '0'
const ratioLabel = (num, den, zeroMix = false) => num == null || den == null ? '—' : den > 0 ? `${(num / den * 100).toFixed(1)}%` : zeroMix && den === 0 && num === 0 ? '0.0%' : '—'

const rankLabel = row => row.posOnly ? '—' : employeeRankLabel(row)
const posLabel = value => value == null ? 'Unavailable' : countLabel(value)
const signedDifference = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' })
const differenceLabel = value => value == null ? 'Unavailable' : signedDifference.format(value)
const differenceColor = value => value == null ? '' : value === 0
  ? 'font-semibold text-green-700 dark:text-green-300' : 'font-semibold text-red-700 dark:text-red-300'

const posMixLabel = row => row.posMix || row.posUnknownTiers
  ? 'POS P-Mix: ' + (row.posMix ?? 'Unavailable') + (row.posUnknownTiers ? ' · Incomplete tiers' : '') : ''

function totals(rows) {
  const pos = teamSalesPosTotals(rows)
  rows = rows.filter(row => !row.posOnly)
  const sum = key => rows.some(r => r[key] == null) ? null : rows.reduce((n, r) => n + r[key], 0)
  const known = key => rows.reduce((n, r) => n + (r[key] ?? 0), 0)
  const ms = sum('ms'), opp = sum('opp')
  return [
    '', rows.some(r => r.ms == null || r.opp == null) ? 'Known attributed subtotal' : 'Totals', '',
    rows.length ? known('ms') : '—', pos.value, pos.difference, rows.length ? known('opp') : '—', ratioLabel(ms, opp), ratioLabel(!rows.length || ms == null ? null : known('better') + known('best'), ms, true), '',
  ]
}

export default function TeamSalesTable({ data, locations, dateRange, dataComplete = true }) {
  const pos = usePosMembershipReport(locations, dateRange.start, dateRange.end)
  const mappingKey = JSON.stringify(locations.map(row => row.id).sort())
  const [mappingState, setMappingState] = useState({ key: '', rows: [], error: '' })
  const [mappingReload, setMappingReload] = useState(0)
  const identities = useTeamSalesIdentities(mappingKey, mappingReload)
  useEffect(() => {
    let active = true
    setMappingState({ key: '', rows: [], error: '' })
    readMappings(supabase, JSON.parse(mappingKey), true).then(rows => {
      if (active) setMappingState({ key: mappingKey, rows, error: '' })
    }).catch(error => {
      if (active) setMappingState({ key: mappingKey, rows: [], error: error.message || 'Could not load approved mappings.' })
    })
    return () => { active = false }
  }, [mappingKey, mappingReload, data])
  const [splitByShop, setSplitByShop] = useState(false)
  const [sort, setSort] = useState({ col: 'rank', dir: 'asc' })
  const toggleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))

  if (mappingState.error) return <div role="alert">Historical mappings could not be verified: {mappingState.error} <button onClick={() => setMappingReload(n => n + 1)}>Reload mappings</button></div>
  if (mappingState.key !== mappingKey) return <p role="status">Loading approved employee mappings…</p>
  if (!dataComplete) return <p role="alert" className="text-sm text-red-600">Team Sales data is incomplete or still loading. Reload the report before scoring.</p>

  let performance
  try { performance = buildTeamSalesPerformance(data, locations, dateRange, mappingState.rows, identities?.sites, pos?.result?.people) }
  catch (error) { return <p role="alert">Employee mapping conflict: {error.message} Reload after Admin review.</p> }
  const { attributionNotes, population } = performance
  const { rows: allRows, coverage } = joinTeamSalesPos(performance.rows, pos?.result, locations, identities?.sites)
  const summary = summarizeTeamSalesCoverage(coverage)
  const reportPeriod = fmtDateRange(dateRange.start, dateRange.end)
  const importPeriod = summary.firstImported ? fmtDateRange(summary.firstImported, summary.lastImported) : 'None in this period'
  const coverageText = pos?.result
    ? `POS imports: ${importPeriod} (${summary.imported}/${summary.expected} site-days). ${summary.verified}/${summary.expected} site-days match saved GSRs. ${summary.unresolved} unresolved POS sales.`
    : pos?.error || 'Loading POS membership sales…'
  const commissionScopes = pos?.result?.commissionScopes ?? []
  const provisionalText = summary.provisional ? 'Differences may be provisional where imports, GSR coverage, or attribution are incomplete.' : ''
  if (!allRows.length) return <div role="status" className="text-sm text-gray-500 dark:text-tm-dark-muted py-4">No named employee data for this period.{!pos && locations.length > 0 && ' Loading POS membership sales…'}{pos?.error && ' ' + pos.error} {attributionNotes.map(day => <p key={`${day.locationId}:${day.date}`}>{day.site} · {day.issues.join('; ')}</p>)}</div>

  const exportSpec = {
    filename: `team-member-sales_${dateRange.start}_to_${dateRange.end}`,
    title: 'Team Member Sales',
    subtitle: `${reportPeriod} · All complete, valid employee data qualifies · employee/site identities · ${coverageText} ${provisionalText}`,
    columns: [...COLS, { label: 'Data status', type: 'text' }],
    rows: sortEmployeeRows(allRows, sort).map(r => [rankLabel(r), r.name, r.site, r.ms ?? '', r.posSales ?? '', r.difference ?? '', r.opp ?? '', r.conversion, r.p_mix, r.score ?? '', [...new Set([...r.issues, r.posIssue, r.differenceIssue, posMixLabel(r)].filter(Boolean))].join('; ')]),
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
          <td className={`${cell} whitespace-nowrap`}>{rankLabel(r)}</td>
          <td className={`${cell} font-medium font-brand`}>{r.name}</td>
          {showSite && <td className={`${cell} text-xs`}>{r.site}</td>}
          <td className={`${cell} text-center font-mono`}>{countLabel(r.ms)}</td>
          <td className={`${cell} text-center`}>{posLabel(r.posSales)}{r.posIssue && <span className="block text-xs">{r.posIssue}</span>}{posMixLabel(r) && <span className="block text-xs">{posMixLabel(r)}</span>}</td>
          <td className={`${cell} text-center`}><span className={differenceColor(r.difference)}>{differenceLabel(r.difference)}</span>{r.differenceIssue && <span className="block text-xs">{r.differenceIssue}</span>}</td>
          <td className={`${cell} text-center font-mono`}>{countLabel(r.opp)}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
          <td className={`${cell} text-center`}>{r.posOnly ? '—' : <EmployeeScoreDetails row={r} />}</td>
        </tr>)}
        <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">{total.map((v, i) => <td key={cols[i].key} className={`${cell} text-center`}>
          {cols[i].key === 'difference' ? <span className={differenceColor(v)}>{differenceLabel(v)}</span> :
            cols[i].key === 'posSales' ? posLabel(v) : v === '' ? '—' : v}
        </td>)}</tr>
      </tbody>
    </table></div>
  }

  return <div>
    <p className="text-xs mb-1">Report period: {reportPeriod}. {coverageText}</p>
    {pos?.result && provisionalText && <p role="status" className="text-xs mb-2 text-amber-800 dark:text-amber-300">{provisionalText}</p>}
    {commissionScopes.length > 0 && <details className="text-xs mb-2">
      <summary className="cursor-pointer">Micrologic commission report periods</summary>
      {commissionScopes.map(scope => <p key={scope.location_id + scope.starts}>
        {locations.find(site => site.id === scope.location_id)?.name} · {fmtDateRange(scope.starts, scope.ends)} · {scope.reported} reported signups
        {' · '}{scope.included ? `${scope.unresolved} unresolved in commission report` : 'Select the full period to include aggregate sales'}
        {scope.active_only && ' · Active POS users only'}
      </p>)}
    </details>}
    <p className="text-xs mb-2">Difference = TM Ops Sales − POS Verified Sales.</p>
    {identities?.incomplete && <p role="status" className="text-xs mb-2">Some roster identities could not be verified.</p>}
    <p className="text-xs mb-2">Approved historical mappings affect attribution only. Unmapped names retain existing reporting rules. <button className="underline" onClick={() => setMappingReload(n => n + 1)}>Refresh mappings</button></p>
    <p className="text-xs mb-2 text-gray-600 dark:text-gray-300">Total Points = TM Ops Sales + Conversion % + P-Mix %. Every employee with complete, valid data and positive opportunities qualifies; there is no sales or opportunity volume cutoff.</p>
    <p className="text-xs mb-3 text-gray-600 dark:text-gray-300">{population} employee/site identities. Same names at different sites remain separate.</p>
    {performance.rows.some(r => !r.qualified) && <p role="status" className="text-xs mb-3 text-amber-800 dark:text-amber-300">Incomplete or invalid data has no score or official rank. See each unranked employee’s data issue for the reason.</p>}
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
