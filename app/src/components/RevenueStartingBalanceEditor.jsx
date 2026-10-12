import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { revenueCents, TRANSITION_MONTH, DEFAULT_TRANSITION_CUTOFF, startingBalanceCutoffError, lastCompletedBusinessDate } from '../utils/budgetRevenue'

export default function RevenueStartingBalanceEditor({ locationId, timeZone, balance, disabled, onSaved }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [cutoff, setCutoff] = useState(DEFAULT_TRANSITION_CUTOFF)
  const [verified, setVerified] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [audit, setAudit] = useState([])
  const [auditError, setAuditError] = useState(false)
  const lastCompletedDate = lastCompletedBusinessDate(timeZone)
  const maxCutoff = lastCompletedDate < '2026-10-31' ? lastCompletedDate : '2026-10-31'
  const cutoffError = startingBalanceCutoffError(cutoff, TRANSITION_MONTH, lastCompletedDate)
  useEffect(() => {
    setAmount(balance?.amount == null ? '' : String(balance.amount))
    setNote(balance?.verification_note || '')
    setCutoff(balance?.cutoff_business_date || (DEFAULT_TRANSITION_CUTOFF > maxCutoff ? maxCutoff : DEFAULT_TRANSITION_CUTOFF))
    setVerified(false)
    setMessage('')
    setAudit([])
    setAuditError(false)
    let cancelled = false
    supabase.from('revenue_starting_balance_audit').select('*').eq('location_id', locationId)
      .order('id', { ascending: false }).limit(20).then(({ data, error }) => {
        if (!cancelled) { setAudit(data || []); setAuditError(!!error) }
      })
    return () => { cancelled = true }
  }, [locationId, balance])
  const save = async () => {
    if (saving || disabled || !verified || revenueCents(amount) == null || !note.trim() || cutoffError
      || startingBalanceCutoffError(cutoff, TRANSITION_MONTH, lastCompletedBusinessDate(timeZone))) return
    setSaving(true)
    setMessage('')
    try {
      const payload = { location_id: locationId, revenue_month: TRANSITION_MONTH,
        cutoff_business_date: cutoff, amount: revenueCents(amount) / 100, verification_note: note.trim() }
      const query = balance
        ? supabase.from('revenue_starting_balances').update(payload).eq('location_id', locationId).eq('updated_at', balance.updated_at)
        : supabase.from('revenue_starting_balances').insert(payload)
      const { data, error } = await query.select('*').single()
      if (error || !data) throw new Error('Save failed')
      onSaved(data)
    } catch { setMessage('Save not confirmed. Reload before retrying; another Admin may have changed this balance.') }
    finally { setSaving(false) }
  }
  return <section className="rounded-lg border p-3 space-y-2 text-xs text-gray-800 dark:text-gray-100 dark:border-tm-dark-border">
    <h3 className="font-bold">Admin: October 2026 starting balance</h3>
    <p>The verified balance includes October revenue through the selected cutoff. Daily entries on or before that date are preserved but excluded from MTD; only later business revenue is added. This balance never carries into November.</p>
    <fieldset disabled={disabled || saving} className="space-y-2">
      <label className="block">Verified MTD balance ($)<input aria-label="Verified October MTD starting balance" type="number" min="0" step="0.01" value={amount} onChange={event => { setAmount(event.target.value); setVerified(false) }} className="block border rounded p-2 bg-white dark:bg-tm-dark-surface" /></label>
      <label className="block">Cutoff business date<input aria-label="Starting balance cutoff business date" type="date" min={TRANSITION_MONTH} max={maxCutoff} value={cutoff} onChange={event => { setCutoff(event.target.value); setVerified(false) }} aria-invalid={!!cutoffError} className="block border rounded p-2 bg-white dark:bg-tm-dark-surface" /></label>
      <p>Last completed business day at this site: {lastCompletedDate}.</p>
      {cutoffError && <p role="alert" className="text-red-700 dark:text-red-300">{cutoffError}</p>}
      <label className="block">Verification source / reason for correction<textarea aria-label="Starting balance verification note" maxLength={1000} value={note} onChange={event => { setNote(event.target.value); setVerified(false) }} className="block w-full border rounded p-2 bg-white dark:bg-tm-dark-surface" /></label>
      <label className="block"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} /> I verified the amount includes all October business revenue through {cutoff || 'the selected cutoff'}.</label>
      <button onClick={save} disabled={!verified || revenueCents(amount) == null || !note.trim() || !!cutoffError} className="rounded bg-tm-teal text-tm-navy px-3 py-2 font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save verified starting balance'}</button>
    </fieldset>
    {message && <p role="alert" className="text-red-600 dark:text-red-400">{message}</p>}
    <details><summary>Starting balance audit — latest 20 changes</summary>
      {auditError ? <p>Audit could not be loaded.</p> : audit.length ? <ul>{audit.map(change => <li key={change.id} className="py-2">{change.changed_at} · Admin ID {change.changed_by} · {change.old_value?.amount ?? 'New'} → {change.new_value.amount} · Cutoff {change.old_value?.cutoff_business_date && <>{change.old_value.cutoff_business_date} → </>}{change.new_value.cutoff_business_date} · {change.new_value.verification_note}</li>)}</ul> : <p>No recorded changes.</p>}
    </details>
  </section>
}
