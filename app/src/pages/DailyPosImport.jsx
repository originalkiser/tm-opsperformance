import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PosHistoricalReview from '../components/PosHistoricalReview'
import NavBar from '../components/NavBar'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { comparePosMetric, comparisonLabels, groupPosReviewByDate, isProvisionalPosMetric,
  posComparisonValues, posManagerStatus, summarizePosReview } from '../utils/dailyPosImport'
import { commitPosWorkbook, preparePosWorkbook, processPosFiles } from '../utils/posImportStorage'

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
  ['reportBalance', 'Report Balance', 'money'], ['washes', 'Total Washes'], ['governmentWashes', 'Government Car Washes'], ['policeWashes', 'Police Washes'], ['employeeWashes', 'Employee Washes'], ['redemptions', 'Redemptions'],
  ['rawOverrides', 'Raw Wash Override Quantity'], ['overrides', 'Qualifying Wash Overrides'],
  ['basic', 'Basic Memberships Sold'], ['good', 'Good Memberships Sold'], ['better', 'Better Memberships Sold'],
  ['best', 'Best Memberships Sold'], ['unclassified', 'Unclassified Memberships Sold'], ['nonTier', 'Non-tier Memberships Sold'], ['memberships', 'Total Memberships Sold'], ['recharges', 'Membership Recharges'],
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
    {row.system === 'DRB' && <p className="my-2 text-sm">
      POS conversion excludes Government Car, Police Wash, and Employee Wash activity. The manual Budget Tracking calculation uses Total Washes.
    </p>}
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
          const differentRules = row.system === 'DRB' && saved && ['opportunities', 'conversion'].includes(key)
          const difference = differentRules || provisional || imported[key] == null || saved?.[key] == null ? null : imported[key] - saved[key]
          const comparison = !differentRules && !provisional && saved && Object.hasOwn(saved, key) && key !== 'other'
            ? comparePosMetric(key, imported[key], saved[key]) : null
          return <tr key={key} className="border-b border-gray-100 dark:border-tm-dark-border">
            <th scope="row" className="py-1.5 text-left font-medium">{label}</th>
            <td className="px-2 text-right tabular-nums">{format(imported[key], type)}</td>
            <td className="px-2 text-right tabular-nums">{format(saved?.[key], type)}</td>
            <td className={'px-2 text-right tabular-nums ' + (difference ? 'font-semibold text-amber-800 dark:text-amber-300' : '')}>
              {format(difference, type)}
            </td>
            <td className="px-2 text-right">{provisional ? 'Provisional · unreconciled' : differentRules ? 'Different calculation' : comparisonLabels[comparison] || '—'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {row.reportMetrics && <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">POS Performance source metrics</summary>
      <p>Retail Revenue {format(row.reportMetrics.retailRevenue, 'money')} · Member Revenue {format(row.reportMetrics.memberRevenue, 'money')}</p>
      <p>Premium retail purchases {format(row.reportMetrics.premiumRetail)} of {format(row.reportMetrics.eligibleRetail)} mapped purchases</p>
      {!!row.reportMetrics.unresolved.length && <ul className="list-disc pl-5">{row.reportMetrics.unresolved.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    </details>}
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
  const [jobs, setJobs] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const files = useRef(new Map())
  const nextId = useRef(0)
  const running = useRef(false)
  const mounted = useRef(true)
  const input = useRef(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; files.current.clear() } }, [])

  const update = (id, changes) => {
    if (mounted.current) setJobs(previous => previous.map(job => job.id === id ? { ...job, ...changes } : job))
  }
  async function run(task) {
    if (running.current) return
    running.current = true
    setBusy(true)
    try { await task() } finally { running.current = false; if (mounted.current) setBusy(false) }
  }
  function preview(ids) {
    return run(async () => {
      const queue = ids.flatMap(id => files.current.has(id) ? [{ id, file: files.current.get(id) }] : [])
      setProgress('Preparing ' + queue.length + ' workbooks…')
      await processPosFiles(queue, async ({ id, file }) => {
        if (!mounted.current) throw new Error('Review closed.')
        update(id, { status: 'Reading', error: null, result: null, reason: '' })
        return preparePosWorkbook(supabase, file, locations)
      }, ({ id }, outcome, done, total) => {
        update(id, { result: outcome.result, error: outcome.error, status: outcome.error ? 'Failed preview' : 'Previewed' })
        if (mounted.current) setProgress(done + ' / ' + total + ' workbooks reviewed')
      })
    })
  }
  function load(event) {
    event.preventDefault()
    if (running.current) return
    const queue = [...input.current.files].map(file => {
      const id = ++nextId.current
      files.current.set(id, file)
      return { id, name: file.name, status: 'Queued' }
    })
    if (!queue.length) return
    input.current.value = ''
    setJobs(previous => [...previous, ...queue])
    setActiveId(queue[0].id)
    preview(queue.map(job => job.id))
  }
  const canSave = job => job.result && !job.result.storageError && !job.result.issues.length && job.result.candidates.length &&
    ['Previewed','Save failed'].includes(job.status)
  const hasCorrection = job => job.result?.candidates.some(row => row.change === 'correction')

  function save(queue) {
    return run(async () => {
      let done = 0
      for (const job of queue) {
        if (!mounted.current) break
        update(job.id, { status: 'Saving', error: null })
        try {
          const saved = await commitPosWorkbook(supabase, job.result, job.reason)
          update(job.id, { saved, status: saved.imported || saved.replaced ? 'Saved' : 'Duplicate' })
          files.current.delete(job.id)
        } catch (error) {
          update(job.id, { status: 'Save failed', error: error.message })
        }
        if (mounted.current) setProgress(++done + ' / ' + queue.length + ' workbooks processed for saving')
      }
    })
  }
  const ready = jobs.filter(job => canSave(job) && !hasCorrection(job))
  const active = jobs.find(job => job.id === activeId)
  const dates = groupPosReviewByDate(active?.result?.rows ?? [])
  const recorded = jobs.reduce((n, job) => n + (job.saved?.imported ?? 0) + (job.saved?.replaced ?? 0), 0)
  const duplicates = jobs.reduce((n, job) => n + (job.saved?.duplicates ?? 0), 0)
  return <div className="min-h-screen bg-tm-cream text-gray-900 dark:bg-tm-dark-bg dark:text-tm-dark-text">
    <NavBar />
    <main className="mx-auto max-w-screen-xl space-y-4 p-4 sm:p-6">
      <header>
        <Link to="/pos-performance" className="text-sm font-semibold text-tm-blue dark:text-tm-teal">Back to POS Performance</Link>
        <h1 className="mt-2 font-brand text-2xl font-bold">Daily POS Import</h1>
        <p className="text-sm">Preview daily Micrologic and DRB workbooks, compare manager entries, and save verified source results. Only parsed metrics and audit details are saved.</p>
      </header>
      <form className={card + ' flex flex-wrap items-end gap-3'} onSubmit={load}>
        <label className="grid min-w-0 gap-1 text-sm font-semibold">
          Daily POS workbooks
          <input ref={input} type="file" accept=".xlsx" multiple required disabled={busy} className="max-w-full text-sm" />
        </label>
        <button disabled={busy} className="rounded bg-tm-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-tm-teal dark:text-tm-navy">
          {busy ? 'Reading workbooks…' : 'Review import'}
        </button>
        {jobs.length > 0 && <button type="button" disabled={busy} onClick={() => {
          setJobs([]); setActiveId(null); setProgress(''); files.current.clear()
        }} className="rounded border px-4 py-2 text-sm font-semibold">Clear review</button>}
      </form>
      <PosHistoricalReview jobs={jobs} busy={busy} run={run} />
      {!!jobs.length && <section className={card + ' space-y-3'} aria-label="Import workbooks">
        <p role="status" className="text-sm">{progress} · {recorded} records saved · {duplicates} duplicates · {jobs.filter(job => job.error).length} failed files</p>
        <button type="button" disabled={busy || !ready.length} onClick={() => save(ready)}
          className="rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50">Save ready workbooks ({ready.length})</button>
        <ul className="space-y-2">
          {jobs.map(job => <li key={job.id} className="flex flex-wrap items-start gap-2 border-t border-gray-200 pt-2 text-sm dark:border-tm-dark-border">
            <button type="button" aria-pressed={job.id === activeId} onClick={() => setActiveId(job.id)}
              className="min-w-0 break-all text-left font-semibold text-tm-blue dark:text-tm-teal">{job.name}</button>
            <span>{job.status}{job.result ? ' · ' + job.result.day + ' · ' + job.result.system : ''}</span>
            {job.saved && <span>{job.saved.imported} new · {job.saved.replaced} replaced · {job.saved.duplicates} duplicates</span>}
            {job.error && <span role="alert" className="text-red-700 dark:text-red-300">{job.error}</span>}
            {(job.error || job.result?.storageError) && files.current.has(job.id) &&
              <button type="button" disabled={busy} onClick={() => preview([job.id])} className="rounded border px-2">Retry this file</button>}
          </li>)}
        </ul>
      </section>}
      {active?.result && <section className={card + ' space-y-2'} aria-label="Selected workbook preview">
        <h2 className="font-brand font-semibold">Selected workbook · {active.result.day} · {active.result.system}</h2>
        {active.result.comparisonError && <p role="alert">{active.result.comparisonError} The manager comparison is unavailable.</p>}
        {active.result.storageError && <p role="alert">Could not verify existing POS revisions. Retry before saving.</p>}
        <p className="text-sm">{active.result.candidates.length} mapped results · {active.result.issues.length} blocking mapping or source issues</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {active.result.candidates.map(row => <li key={row.locationId}>
            {row.name} · {row.change === 'correction' ? 'Requires approval to replace revision ' + row.expectedRevision : row.change}
            {row.document.warnings.length + row.document.financialWarnings.length > 0 && ' · source warnings'}
          </li>)}
        </ul>
        {hasCorrection(active) && <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">Correction reason
            <input className="rounded border bg-transparent p-2" maxLength={500} value={active.reason || ''}
              onChange={event => update(active.id, { reason: event.target.value })} disabled={busy} />
          </label>
          <button type="button" disabled={busy || !canSave(active) || !active.reason?.trim()} className="rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={() => { if (window.confirm('Approve replacement of the listed revisions? Prior versions will be retained.')) save([active]) }}>
            Approve and save corrections
          </button>
        </div>}
      </section>}
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
