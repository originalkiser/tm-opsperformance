import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { applicableCashCents, cashBusinessDate, cashCountError, fetchCashSetting, reconcileCash } from '../utils/cashReconciliation.js'
import { budgetFieldWording } from '../utils/budgetLabels.js'

const money = cents => cents == null ? '—' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export default function CashReconciliationSection({ locationId, entryDate, form, entry, set, disabled, attemptedSave = false, showExpected = false, timeZone = 'America/Chicago', labels }) {
  const [setting, setSetting] = useState(null)
  const [loadedScope, setLoadedScope] = useState(null)
  const [error, setError] = useState('')
  const [audit, setAudit] = useState({ scope: null, rows: [] })
  const [auditError, setAuditError] = useState('')
  const scope = `${locationId}|${entryDate}|${entry?.updated_at || ''}`
  const businessDate = cashBusinessDate(entryDate)
  useEffect(() => {
    let cancelled = false
    setLoadedScope(null); setSetting(null); setError(''); setAudit({ scope: null, rows: [] }); setAuditError('')
    fetchCashSetting(supabase, locationId, businessDate).then(data => {
      if (!cancelled) { setSetting(data); setLoadedScope(scope) }
    }).catch(() => { if (!cancelled) { setError('Unable to load Cash on Hand. Reconciliation is unavailable.'); setLoadedScope(scope) } })
    return () => { cancelled = true }
  }, [scope, locationId, businessDate])
  const cents = !error && loadedScope === scope ? applicableCashCents(entry, setting) : null
  const result = reconcileCash(form, cents)
  const showCashResults = showExpected || !!entry?.cash_first_submitted_at
  const validation = cashCountError(form.yesterday_cash_counted) || (attemptedSave && (form.yesterday_cash_counted == null || form.yesterday_cash_counted === '') ? 'Enter TOTAL CASH ONSITE to complete this daily entry.' : '')
  async function loadAudit(event) {
    if (!event.currentTarget.open) return
    const { data, error } = await supabase.from('cash_reconciliation_audit').select('*')
      .eq('location_id', locationId).eq('business_date', businessDate)
      .order('id', { ascending: false }).limit(20)
    if (error) setAuditError('Unable to load cash audit history.')
    else { setAudit({ scope, rows: data || [] }); setAuditError('') }
  }
  const currentAudit = audit.scope === scope ? audit.rows : []
  const stamp = value => new Date(value).toLocaleString('en-US', { timeZone, timeZoneName: 'short' })
  const statusClass = result.status === 'green' ? 'text-green-800 dark:text-green-300' : result.status === 'red' ? 'text-red-800 dark:text-red-300' : 'text-gray-700 dark:text-gray-200'
  const wording = field => budgetFieldWording(field, labels)
  const heading = wording('reconciliationHeading')
  const count = wording('yesterday_cash_counted')
  const deposit = wording('reconciliationDeposit')
  const variance = wording('reconciliationVariance')
  const metrics = [['reconciliationRevenue', result.revenue], ...(showExpected
    ? [['reconciliationHand', result.hand], ['reconciliationExpected', result.expected]] : [])]
  return <section className="my-3 p-3 rounded-lg border border-gray-200 dark:border-tm-dark-border bg-gray-50 dark:bg-tm-dark-card text-sm text-gray-800 dark:text-gray-100">
    <h3 className="font-bold">{heading.label} · business date {businessDate}</h3>
    <label className="block text-xs font-semibold mt-3">{count.label}
      <input aria-label={count.label} required aria-required="true" type="number" step="0.01" min="0" value={form.yesterday_cash_counted ?? ''} onChange={event => set('yesterday_cash_counted', event.target.value)} disabled={disabled} aria-invalid={!!validation}
        className="block w-full border rounded-lg p-2 mt-1 bg-white dark:bg-tm-dark-surface border-gray-300 dark:border-tm-dark-border focus:outline-none focus:ring-2 focus:ring-tm-teal" />
      {count.helper && <span className="block whitespace-pre-line text-xs font-normal">{count.helper}</span>}
    </label>
    <div className={`grid grid-cols-1 ${showExpected ? 'sm:grid-cols-3' : ''} gap-2 mt-2`}>
      {metrics.map(([field, value]) => {
        const { label, helper } = wording(field)
        return <div key={field}>
          <div className="text-xs">{label}</div>
          <strong>{money(value)}</strong>
          {helper && <p className="whitespace-pre-line text-xs">{helper}</p>}
        </div>
      })}
    </div>
    {validation && <p role="alert" className="text-red-800 dark:text-red-300">{validation}</p>}
    {error && <p role="alert">{error}</p>}
    {loadedScope === scope && !error && cents == null && <p className="text-xs mt-1">Cash on Hand not configured for this date.</p>}
    {showCashResults && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      <div>{deposit.label}: <strong>{money(result.deposit)}</strong>{deposit.helper && <p className="whitespace-pre-line text-xs">{deposit.helper}</p>}</div>
      <div className={statusClass} role="status">{variance.label}: <strong>{money(result.variance)}</strong> · {result.status === 'green' ? 'Reconciled' : result.status === 'red' ? `${result.variance < 0 ? 'Shortage' : 'Overage'} ${money(Math.abs(result.variance))}` : 'Incomplete or invalid'}{variance.helper && <p className="whitespace-pre-line text-xs">{variance.helper}</p>}</div>
    </div>}
    {heading.helper && <p className="mt-1 whitespace-pre-line text-xs">{heading.helper}</p>}
    {entry?.cash_edited_after_submission && <p className="text-xs font-bold text-amber-800 dark:text-amber-300">Edited After Submission</p>}
    {entry?.cash_first_submitted_at && <p className="text-xs">Original submitted count: {money(Math.round(Number(entry.cash_original_count) * 100))} · {stamp(entry.cash_first_submitted_at)}</p>}
    <details onToggle={loadAudit} className="mt-2 text-xs"><summary className="cursor-pointer">Cash audit history · latest 20 changes</summary>
      {auditError && <p role="alert">{auditError}</p>}
      {currentAudit.map(change => <p key={change.id} className="mt-1">{change.event_type} · count {change.old_value?.yesterday_cash_counted ?? '—'} → {change.new_value?.yesterday_cash_counted ?? '—'} · {stamp(change.changed_at)} · user {change.changed_by}</p>)}
      {!currentAudit.length && !auditError && <p>No changes recorded for this business date.</p>}
    </details>
  </section>
}
