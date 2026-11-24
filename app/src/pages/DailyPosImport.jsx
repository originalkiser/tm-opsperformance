import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { comparePosMetric, comparisonLabels, groupPosReviewByDate, isProvisionalPosMetric, matchPosLocations, parseDailyPosFile,
  posComparisonValues, posManagerStatus, readPosComparisons, summarizePosReview } from '../utils/dailyPosImport'

const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-tm-dark-border dark:bg-tm-dark-surface'
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 4 })
const format = (value, type) => value == null ? '—' : type === 'money' ? money.format(value / 100)
  : type === 'percent' ? percent.format(value) : value.toLocaleString('en-US')

const metrics = [
  ['revenue', 'Total Revenue', 'money'], ['payments', 'Total to Account For', 'money'],
  ['cards', 'Credit Card Revenue', 'money'], ['house', 'House Charges / A/R', 'money'],
  ['other', 'Other Tenders', 'money'], ['budgetOther', 'House / Other Included in Budget Tracking', 'money'],
  ['cash', 'Calculated Cash Revenue', 'money'], ['reportedCash', 'Independent POS Cash', 'money'],
  ['reportBalance', 'Report Balance', 'money'], ['washes', 'Total Washes'], ['redemptions', 'Redemptions'],
  ['rawOverrides', 'Raw Wash Override Quantity'], ['overrides', 'Qualifying Wash Overrides'],
  ['basic', 'Basic Memberships Sold'], ['good', 'Good Memberships Sold'], ['better', 'Better Memberships Sold'],
  ['best', 'Best Memberships Sold'], ['unclassified', 'Unclassified Memberships Sold'], ['memberships', 'Total Memberships Sold'], ['recharges', 'Membership Recharges'],
  ['terminations', 'Membership Terminations'], ['opportunities', 'Conversion Opportunities'],
  ['conversion', 'Conversion', 'percent'], ['pmix', 'Membership P-Mix', 'percent'],
]

function Audit({ row }) {
  const { tenders, ...amounts } = row.signedAmounts
  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer font-medium">Signed source amounts</summary>
    <dl className="mt-2 grid gap-x-4 sm:grid-cols-2">
      {[...Object.entries(amounts), ...(tenders || []).map(line => [line.label, line.amount])].map(([label, amount], i) =>
        <div key={i} className="flex justify-between gap-3 border-b border-gray-100 py-1 dark:border-tm-dark-border">
          <dt>{label || '(blank tender)'}</dt><dd className="tabular-nums">{format(amount, 'money')}</dd>
        </div>)}
    </dl>
    {!!row.metrics.membershipAmounts.length && <>
      <h4 className="mt-3 font-semibold">New membership items</h4>
      <ul>{row.metrics.membershipAmounts.filter(item => item.label || item.quantity || item.amount).map((item, i) =>
        <li key={i}>{item.label || '(blank item)'} · {item.quantity} · {format(item.amount, 'money')}</li>)}</ul>
    </>}
  </details>
}

function Comparison({ row }) {
  const { imported, saved } = posComparisonValues(row)
  const { washCount } = row
  return <>
    {row.provisionalFinancial && <p className="my-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
      Provisional revenue and cash use recognized categories only. Unmapped financial categories must be reviewed before these totals can be reconciled.
    </p>}
    {row.system === 'DRB' && !row.provisionalFinancial && !row.financialWarnings?.length && row.metrics.reportBalance === 0 &&
      <p className="my-2 text-sm font-medium">DRB revenue reconciled to a zero report balance and matching POS cash.</p>}
    {!saved && <p className="my-2 text-sm">{row.managerMissing
      ? 'No saved Budget Tracking entry for this site and business date.' : 'Budget Tracking comparison unavailable.'}</p>}
    {washCount && <details className="my-2 text-sm">
      <summary className="cursor-pointer font-medium">Total Washes source · {washCount.source}</summary>
      <p>Reported Car Count Total: {format(washCount.reported)}.</p>
      <p>Wash Sales {format(washCount.washSales)} + Unlimited Signup {format(washCount.signupCount)}
        {' + Unlimited Redemption '}{format(washCount.redemptions)} = {format(washCount.calculated)}.</p>
      {washCount.confirmedZero && <p>Signup treated as zero because the signup category is absent from both the sections and totals, and the revenue-summary quantity ties.</p>}
    </details>}
    {!!row.quantityDifferences?.length && <details className="my-2 text-sm">
      <summary className="cursor-pointer font-medium">DRB Count versus Quantity</summary>
      <p>Operational figures use Quantity.</p>
      <ul className="list-disc pl-5">{row.quantityDifferences.map((item, index) =>
        <li key={index}>{item.category} · {item.label} · Count {item.count}, Quantity {item.quantity}</li>)}</ul>
    </details>}
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b dark:border-tm-dark-border">
          <th scope="col" className="py-2 text-left">Metric</th>
          {['POS', 'Budget Tracking', 'Difference', 'Status'].map(header => <th scope="col" key={header} className="px-2 text-right">{header}</th>)}
        </tr></thead>
        <tbody>{metrics.map(([key, label, type]) => {
          const provisional = isProvisionalPosMetric(row, key)
          const difference = provisional || imported[key] == null || saved?.[key] == null ? null : imported[key] - saved[key]
          const comparison = !provisional && saved && Object.hasOwn(saved, key) && key !== 'other'
            ? comparePosMetric(key, imported[key], saved[key]) : null
          return <tr key={key} className="border-b border-gray-100 dark:border-tm-dark-border">
            <th scope="row" className="py-1.5 text-left font-medium">{label}</th>
            <td className="px-2 text-right tabular-nums">{format(imported[key], type)}</td>
            <td className="px-2 text-right tabular-nums">{format(saved?.[key], type)}</td>
            <td className={'px-2 text-right tabular-nums ' + (difference ? 'font-semibold text-amber-800 dark:text-amber-300' : '')}>
              {format(difference, type)}
            </td>
            <td className="px-2 text-right">{provisional ? 'Provisional · unreconciled' : comparisonLabels[comparison] || '—'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <Audit row={row} />
  </>
}

export default function DailyPosImport() {
  const { user, profile, locations } = useAuth()
  if (profile?.role !== 'admin' || !profile.is_active || profile.deleted_at) {
    return <><NavBar /><main className="p-4"><p role="alert">An active Admin account is required.</p></main></>
  }
  return <PosReview key={user.id} locations={locations} />
}

function PosReview({ locations }) {
  const [reports, setReports] = useState([])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const [compared, setCompared] = useState({ report: null, rows: [] })
  const generation = useRef(0)
  const reading = useRef(false)
  const input = useRef(null)

  useEffect(() => () => { generation.current++ }, [])

  async function load(event) {
    event.preventDefault()
    if (reading.current) return
    const files = [...input.current.files]
    if (!files.length) return
    if (files.length > 2) { setErrors(['Choose up to two workbooks per upload.']); return }
    reading.current = true
    setBusy(true); setErrors([])
    const request = ++generation.current
    const outcomes = await Promise.allSettled(files.map(parseDailyPosFile))
    if (request !== generation.current) return
    const parsed = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? outcome.value : [])
    const failures = outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
      ? ['Workbook ' + (index + 1) + ': ' + outcome.reason.message] : [])
    setErrors(failures)
    if (parsed.length) {
      setReports(previous => [
        ...previous.filter(row => !parsed.some(newRow => row.system === newRow.system && row.sourceId === newRow.sourceId && row.businessDate === newRow.businessDate)),
        ...parsed,
      ])
    }
    input.current.value = ''
    reading.current = false
    setBusy(false)
  }

  useEffect(() => {
    if (!reports.length) return
    const matched = matchPosLocations(reports, locations)
    let active = true
    readPosComparisons(supabase, matched).then(rows => {
      if (active) setCompared({ report: reports, locations, rows })
    }).catch(error => {
      if (active) setCompared({ report: reports, locations, rows: matched, error: error.message })
    })
    return () => { active = false }
  }, [reports, locations])

  const ready = compared.report === reports && compared.locations === locations
  const rows = ready ? compared.rows : []
  const dates = groupPosReviewByDate(rows)
  return <div className="min-h-screen bg-tm-cream text-gray-900 dark:bg-tm-dark-bg dark:text-tm-dark-text">
    <NavBar />
    <main className="mx-auto max-w-screen-xl space-y-4 p-4 sm:p-6">
      <header>
        <Link to="/reports" className="text-sm font-semibold text-tm-blue dark:text-tm-teal">Back to Reports</Link>
        <h1 className="mt-2 font-brand text-2xl font-bold">Daily POS Import</h1>
        <p className="text-sm">Review Micrologic and DRB exports against saved Budget Tracking entries. Files stay in this browser session.</p>
      </header>
      <form className={card + ' flex flex-wrap items-end gap-3'} onSubmit={load}>
        <label className="grid min-w-0 gap-1 text-sm font-semibold">
          Daily POS workbooks
          <input ref={input} type="file" accept=".xlsx" multiple required disabled={busy} className="max-w-full text-sm" />
        </label>
        <button disabled={busy} className="rounded bg-tm-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-tm-teal dark:text-tm-navy">
          {busy ? 'Reading workbooks…' : 'Review import'}
        </button>
        {reports.length > 0 && <button type="button" disabled={busy} onClick={() => { setReports([]); setCompared({ report: null, rows: [] }); setErrors([]) }}
          className="rounded border px-4 py-2 text-sm font-semibold">Clear review</button>}
      </form>
      {!!errors.length && <ul role="alert" className={card + ' list-disc space-y-1 pl-8 text-sm'}>{errors.map(error => <li key={error}>{error}</li>)}</ul>}
      {reports.length > 0 && !ready && <p role="status">Loading Budget Tracking comparisons…</p>}
      {ready && compared.error && <p role="alert">{compared.error} POS figures are still available.</p>}
      {dates.length > 1 && <p className="text-sm font-semibold">{dates.length} business dates in this review. Coverage and comparisons are counted separately for each date.</p>}
      {dates.map(([date, dateRows]) => {
        const summary = summarizePosReview(dateRows)
        return <section key={date} className="space-y-3" aria-labelledby={'pos-date-' + date}>
          <h2 id={'pos-date-' + date} className="font-brand text-lg font-bold">Business date {date}</h2>
          <div className={card}>
            <h3 className="font-brand font-semibold">Network summary for {date}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              {[
                ['Mapped locations', summary.mapped], ['DRB zero balances', summary.drbZero],
                ['Matched POS cash', summary.cashMatched], ['Exact manager matches', summary.exact],
                ['Locations with rounding differences', summary.anyRounding], ['Substantive discrepancies or unresolved tiers', summary.substantive],
                ['Missing manager entries', summary.missing], ['Unavailable comparisons', summary.unavailable],
                ['Calculated POS wash counts', summary.calculated], ['Financial warnings', summary.financial],
              ].map(([label, count]) => <div key={label}><dt>{label}</dt><dd className="text-xl font-bold tabular-nums">{count}</dd></div>)}
            </dl>
          </div>
          {dateRows.map((row, index) => <details key={row.system + row.sourceId + row.businessDate + index} className={card}>
            <summary className="cursor-pointer">
              <span className="font-brand font-semibold">{row.location?.name || row.sourceId}</span>
              <span className="ml-2 text-sm">{row.system} · {row.businessDate}{' · ' + comparisonLabels[posManagerStatus(row)]}{row.washCount?.source === 'calculated' ? ' · Calculated washes' : ''}{row.financialWarnings?.length ? ' · Financial warning' : ''}</span>
            </summary>
            {!!row.warnings.length && <ul className="my-2 list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">
              {row.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
            </ul>}
            {!!row.financialWarnings?.length && <div className="my-2 text-sm text-amber-800 dark:text-amber-300">
              <p className="font-semibold">Financial reconciliation</p>
              <ul className="list-disc pl-5">{row.financialWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
            </div>}
            {row.location && row.metrics && <Comparison row={row} />}
          </details>)}
        </section>
      })}
    </main>
  </div>
}
