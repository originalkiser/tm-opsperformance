import { usePosMembershipReport } from '../components/PosMembershipComparison'
import { membershipCoverage, topMembershipSeller } from '../utils/posMembership'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { toDateStr } from '../utils/budgetMath'
import { shiftDate } from '../utils/budgetRevenue'
import { REPORT_STATUS_CLS, reportThresholdStatus } from '../utils/metricColors'
import { POS_START, readStoredPos } from '../utils/posImportStorage'
import { buildPosPerformance, isPosReportingLocation, posPeriod, posPeriods, readPosTargets } from '../utils/posPerformance'

const controls = 'rounded-md border border-gray-300 bg-white p-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-card'
const panel = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-tm-dark-border dark:bg-tm-dark-surface'
const locationClass = 'sticky left-0 z-10 min-w-44 border-r border-tm-teal/30 bg-inherit px-3 py-2 text-left'
const headClass = 'whitespace-nowrap px-2 py-2 text-right'
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const pct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })
const columns = [
  ['retail','Retail Rev','cents','Total revenue less signed member revenue.'],
  ['member','Member Rev','cents','New and recurring membership revenue, reactivations, and applicable signed discounts and refunds.'],
  ['total','Total Rev','cents','Micrologic TOTAL REVENUE or DRB Total to Account For. Unsupported revenue is excluded.'],
  ['target','Revenue Target','dollars','Sum of daily TM Ops revenue targets for the entire effective period.'],
  ['comparison','vs Target (%)','percent','(Total revenue − target) ÷ target. Requires complete coverage, daily targets and independently supported revenue.'],
  ['opportunities','Retail Washes','quantity','Conversion opportunities. DRB subtracts Government Car, Police Wash and Employee Wash quantities from Total Washes. Micrologic subtracts redemptions and qualifying overrides. This metric does not necessarily add to Member Washes to make Total Washes.'],
  ['retailMix','Retail P-Mix','percent','Net Better and Best individual purchases ÷ all eligible net individual purchases.'],
  ['redemptions','Member Washes','quantity','Membership redemptions.'],
  ['redeemMix','Member Redeem P-Mix','percent','Better and Best membership redemptions ÷ all tier-based membership redemptions.'],
  ['washes','Total Washes','quantity','Imported total washes. Micrologic uses its calculated fallback when the reported count is absent and source subtotals agree.'],
  ['memberships','Memberships Sold','quantity','All new memberships, including promotional, free and unclassified sales.'],
  ['soldMix','Membership Sold P-Mix','percent','Better and Best new memberships ÷ all tier-based new memberships.'],
  ['conversion','Conversion %','percent','New memberships ÷ POS-specific conversion opportunities. The manual DRB Budget Tracking calculation still uses Total Washes.'],
  ['seller','Top Seller','text','Verified employee-attributed new memberships. Provisional when source coverage or attribution remains incomplete.'],
]

function coverageText(coverage) {
  if (!coverage) return 'Partial result'
  const { usable, expected, denominator, knownDenominator, knownDenominatorDays } = coverage
  return `Partial result. ${usable} of ${expected} location-days.` +
    (denominator == null ? '' : ` Matched denominator ${denominator} of ${knownDenominator} known across ${knownDenominatorDays} days.`)
}
function format(value, type) {
  if (value == null) return '—'
  if (type === 'cents') return currency.format(value / 100)
  if (type === 'dollars') return currency.format(value)
  if (type === 'percent') return pct.format(value)
  return value.toLocaleString('en-US')
}
function tone(key, value) {
  if (value == null) return ''
  if (key === 'comparison') return REPORT_STATUS_CLS[value > 0 ? 'green' : value < 0 ? 'red' : 'neutral']
  if (key === 'conversion' || key === 'soldMix') return REPORT_STATUS_CLS[reportThresholdStatus(value, key === 'conversion' ? 'conv_yellow' : 'pmix_green')]
  return ''
}

export default function PosPerformance() {
  const { user, profile, locations } = useAuth()
  if (profile?.role !== 'admin' || profile.is_active !== true || profile.deleted_at) {
    return <><NavBar /><main className="p-4"><p role="alert">An active Admin account is required.</p></main></>
  }
  return <PerformanceReview key={user.id} locations={locations} />
}

function PerformanceReview({ locations }) {
  const today = toDateStr(new Date())
  const yesterday = shiftDate(today, -1)
  const [period, setPeriod] = useState('Yesterday')
  const [customStart, setCustomStart] = useState(yesterday)
  const [customEnd, setCustomEnd] = useState(yesterday)
  const [market, setMarket] = useState('')
  const [locationId, setLocationId] = useState('')
  const [sort, setSort] = useState({ key: 'location', descending: false })
  const [loaded, setLoaded] = useState(null)
  const [history, setHistory] = useState(null)
  const historyScope = useRef(0)
  const eligible = useMemo(() => locations.filter(isPosReportingLocation), [locations])
  const markets = [...new Set(eligible.map(location => location.market).filter(Boolean))].sort()
  const inMarket = eligible.filter(location => !market || location.market === market)
  const visible = inMarket.filter(location => !locationId || location.id === locationId)
  const { start, end, empty, error } = posPeriod(period, today, customStart, customEnd)
  const membership = usePosMembershipReport(visible, start, end)
  const scope = start + ':' + end

  useEffect(() => {
    if (!start || !end || empty) return
    let current = true
    Promise.allSettled([readStoredPos(supabase, start, end), readPosTargets(supabase, eligible, start, end)]).then(([records, goals]) => {
      if (!current) return
      setLoaded({ scope, locations: eligible, records: records.status === 'fulfilled' ? records.value : [],
        goals: goals.status === 'fulfilled' ? goals.value : [],
        error: records.status === 'rejected' ? records.reason.message : null,
        goalError: goals.status === 'rejected' ? goals.reason.message : null,
      })
    })
    return () => { current = false }
  }, [start, end, empty, scope, eligible])

  async function viewHistory(location, date) {
    const request = ++historyScope.current
    setHistory({ location, date })
    try {
      const { data, error: failure } = await supabase.rpc('pos_daily_history', { p_location: location.id, p_day: date })
      if (request === historyScope.current) setHistory({ location, date, revisions: data ?? [], error: failure?.message })
    } catch {
      if (request === historyScope.current) setHistory({ location, date, error: 'POS history could not be loaded.' })
    }
  }
  const current = loaded?.scope === scope && loaded.locations === eligible ? loaded : null
  const report = useMemo(() => current && buildPosPerformance(visible, current.records, current.goals, start, end),
    [current, visible, start, end])
  const sorted = report?.rows.slice().sort((a, b) => {
    if (sort.key === 'location') return a.location.name.localeCompare(b.location.name) * (sort.descending ? -1 : 1)
    if (a[sort.key] == null || b[sort.key] == null) return Number(a[sort.key] == null) - Number(b[sort.key] == null)
    return (a[sort.key] - b[sort.key]) * (sort.descending ? -1 : 1)
  })
  const changeSort = key => setSort(previous => ({ key, descending: previous.key === key ? !previous.descending : key !== 'location' }))
  const direction = key => sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'
  function seller(row) {
    if (!row.location || !membership?.result) return null
    const leader = topMembershipSeller(membership.result.people.filter(p => p.location_id === row.location.id))
    if (!leader) return null
    const coverage = membershipCoverage(membership.result.coverage.filter(d => d.loc === row.location.id))
    return { ...leader, ...coverage }
  }
  const cells = row => columns.map(([key, , type]) => {
    if (key === 'seller') {
      const top = seller(row)
      return <td key={key} className="min-w-40 px-2 py-2 text-right">{top ? <details>
        <summary>{top.names.join(' / ')} · {top.count}{top.provisional && ' · Provisional'}</summary>
        <p>{top.names.length > 1 && 'Co-leaders · '}{top.verified}/{top.expected} GSR-matched days · {top.unresolved} unresolved attributions</p>
      </details> : '—'}</td>
    }
    return <td key={key} className={'whitespace-nowrap px-2 py-2 text-right tabular-nums ' + (row[key + 'Partial'] ? '' : tone(key, row[key]))}>
    {format(row[key], type)}
    {row[key + 'Partial'] && row[key] != null && <span tabIndex={0} title={coverageText(row.coverage[key])}
      aria-label={coverageText(row.coverage[key])}> *</span>}
  </td>})

  return <div className="min-h-screen bg-tm-cream text-gray-900 dark:bg-tm-dark-bg dark:text-tm-dark-text">
    <NavBar />
    <main className="mx-auto max-w-screen-2xl space-y-4 p-4 sm:p-6">
      <header>
        <Link to="/reports" className="text-sm font-semibold text-tm-blue dark:text-tm-teal">Back to Reports</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-brand text-2xl font-bold">POS Performance</h1>
            {!error && !empty && <p className="text-sm">{period} · Business dates {start} through {end}{['WTD','MTD'].includes(period) && ' · completed days'}</p>}
          </div>
          <Link to="/daily-pos-import" className="inline-flex min-h-11 max-w-full items-center rounded-md border border-tm-blue px-3 py-2 text-sm font-semibold text-tm-blue hover:bg-tm-sky/30 dark:border-tm-teal dark:text-tm-teal dark:hover:bg-tm-dark-card">Daily POS Import</Link>
        </div>
      </header>
      <div className={panel + ' flex flex-wrap items-end gap-3'}>
        <label className="grid gap-1 text-sm">Period<select className={controls} value={period} onChange={event => setPeriod(event.target.value)}>
          {posPeriods.map(value => <option key={value}>{value}</option>)}
        </select></label>
        {period === 'Selected Date Range' && <>
          <label className="grid gap-1 text-sm">Start<input type="date" className={controls} min={POS_START} max={today} value={customStart} onChange={event => setCustomStart(event.target.value)} /></label>
          <label className="grid gap-1 text-sm">End<input type="date" className={controls} min={POS_START} max={today} value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label>
        </>}
        <label className="grid gap-1 text-sm">Market<select className={controls} value={market} onChange={event => { setMarket(event.target.value); setLocationId('') }}>
          <option value="">All markets</option>{markets.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm">Location<select className={controls} value={locationId} onChange={event => setLocationId(event.target.value)}>
          <option value="">All locations</option>{inMarket.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select></label>
      </div>
      {error && <p role="alert">{error}</p>}
      {empty && <p>No completed business days in this period.</p>}
      {!error && !empty && !current && <p role="status">Loading POS results and daily targets…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {current?.goalError && <p role="alert">{current.goalError}</p>}
      {report && !error && !empty && !current.error && <>
        <section className={panel + ' space-y-2'} aria-label="POS coverage">
          <p className="font-semibold">{report.network.imported} / {report.network.expected} location-days imported</p>
          <p className="text-sm">{report.network.incomplete} incomplete · {report.network.financial} financial warnings · {report.network.provisional} provisional tender results · {report.network.revenueProvisional} unsupported revenue results · {report.network.unclassified} unclassified · {report.network.calculated} calculated wash counts</p>
          {report.network.imported === 0 && period === 'Today' && <p className="text-sm">No POS results have been imported for today.</p>}
          {(columns.some(([key]) => report.network[key + 'Partial']) || report.network.financial > 0) &&
            <p className="text-sm">* Partial results include only supported inputs. Revenue comparisons require complete supported revenue and daily targets. Reconciliation warnings remain visible.</p>}
        </section>
        <div className="max-h-[65vh] overflow-auto rounded-lg border border-gray-200 dark:border-tm-dark-border"
          role="region" aria-label="Scrollable POS Performance results" tabIndex={0}>
          <table className="w-full min-w-[72rem] border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20 bg-tm-navy text-white dark:bg-tm-dark-nav">
              <tr className="bg-inherit">
                <th scope="col" rowSpan={2} className={locationClass} aria-sort={direction('location')}>
                  <button onClick={() => changeSort('location')}>Location</button>
                </th>
                {[['Revenue Performance',5],['Wash Performance',5],['Membership Performance',4]].map(([label,span]) =>
                  <th key={label} scope="colgroup" colSpan={span} className="border-l border-white/20 px-2 py-2 text-left">{label}</th>)}
              </tr>
              <tr>{columns.map(([key,label,,definition]) => <th key={key} scope="col" className={headClass} aria-sort={key === 'seller' ? undefined : direction(key)} title={definition}>
                {key === 'seller' ? label : <button onClick={() => changeSort(key)}>{label}{sort.key === key && (sort.descending ? ' ↓' : ' ↑')}</button>}
              </th>)}</tr>
            </thead>
            <tbody>{sorted.map((row,index) => <tr key={row.location.id} className={index % 2
              ? 'bg-gray-50 dark:bg-tm-dark-card' : 'bg-white dark:bg-tm-dark-surface'}>
              <th scope="row" className={locationClass}>
                {row.location.name}<small className="block font-normal">{row.imported}/{row.expected}{row.financial ? ' · Financial warning' : row.incomplete ? ' · Incomplete' : ''}</small>
              </th>{cells(row)}
            </tr>)}</tbody>
            <tfoot className="bg-tm-sky/30 font-bold dark:bg-tm-dark-card"><tr className="bg-gray-100 dark:bg-tm-dark-card">
              <th scope="row" className={locationClass}>Network Total</th>{cells(report.network)}
            </tr></tfoot>
          </table>
        </div>
        <details className={panel}>
          <summary className="cursor-pointer font-semibold">Missing dates, source warnings and revisions</summary>
          <div className="mt-3 space-y-3">
            {sorted.map(row => <details key={row.location.id} className="border-t border-gray-200 pt-2 text-sm dark:border-tm-dark-border">
              <summary className="cursor-pointer">{row.location.name} · {row.missing.length} missing dates</summary>
              {!!row.missing.length && <p className="my-2 break-words">Missing: {row.missing.join(', ')}</p>}
              <ul className="mt-2 space-y-2">{row.records.map(record => <li key={record.business_date}>
                <button className="font-semibold text-tm-blue underline dark:text-tm-teal" onClick={() => viewHistory(row.location, record.business_date)}>
                  {record.business_date} · Revision {record.revision}
                </button> · {record.validation} · {record.financial_status}
                {record.document.quality && ` · Revenue ${record.document.quality.revenueStatus} · Tender ${record.document.quality.tenderStatus}`}
                {record.document.quality?.revenueStatus === 'supported' && record.document.metrics.member == null &&
                  <p>Unallocated revenue {format(record.document.metrics.total, 'cents')}</p>}
                {record.document.sources?.washCount?.source === 'calculated' && ' · Calculated wash count'}
                {[...record.document.warnings, ...record.document.financialWarnings].map((warning,i) => <p key={i}>{warning}</p>)}
              </li>)}</ul>
            </details>)}
          </div>
        </details>
      </>}
      {history && <section className={panel + ' space-y-3'} aria-label="POS revision history">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-brand font-bold">{history.location.name} · {history.date} · Revision history</h2>
          <button className="rounded border px-2 py-1" onClick={() => { historyScope.current++; setHistory(null) }}>Close</button>
        </div>
        {history.error ? <p role="alert">{history.error}</p> : !history.revisions ? <p role="status">Loading history…</p> :
          history.revisions.map(revision => <details key={revision.revision} className="rounded border p-3 text-sm">
            <summary className="cursor-pointer">Revision {revision.revision} · {revision.validation} · {revision.financial_status}</summary>
            <p>{revision.batch.file_name} · {revision.batch.imported_at} · {revision.batch.parser_version}</p>
            <p>Imported by {revision.batch.imported_by}</p>
            <p className="break-all">SHA-256 {revision.batch.file_sha256}</p>
            {revision.replacement_reason && <p>Correction: {revision.replacement_reason}</p>}
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(revision.document, null, 2)}</pre>
          </details>)}
      </section>}
    </main>
  </div>
}
