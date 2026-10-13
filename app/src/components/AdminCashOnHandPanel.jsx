import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { revenueCents } from '../utils/budgetRevenue.js'

export default function AdminCashOnHandPanel({ locations }) {
  const { profile } = useAuth()
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [amount, setAmount] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [note, setNote] = useState('')
  const [versions, setVersions] = useState([])
  const [loadedLocation, setLoadedLocation] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState(null)
  const [correctionConfirmed, setCorrectionConfirmed] = useState(false)
  const [reviewRevision, setReviewRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoadedLocation(null); setVersions([]); setAmount(''); setEffectiveDate(''); setNote(''); setConfirmed(false); setError(''); setMessage('')
    if (profile?.role !== 'admin' || !locationId) return
    supabase.from('cash_on_hand_versions').select('*').eq('location_id', locationId).order('effective_date', { ascending: false }).order('id', { ascending: false }).limit(20)
      .then(({ data, error }) => { if (!cancelled) { if (error) setError('Unable to load settings. Reload before saving.'); else { setVersions(data || []); setLoadedLocation(locationId) } } })
      .catch(() => { if (!cancelled) setError('Unable to load settings. Reload before saving.') })
    return () => { cancelled = true }
  }, [locationId, profile?.role])
  useEffect(() => {
    let cancelled = false
    setReview(null); setCorrectionConfirmed(false); setConfirmed(false)
    if (profile?.role !== 'admin' || !locationId || !effectiveDate) return
    supabase.rpc('preview_cash_on_hand_change', { loc_id: locationId, business_date: effectiveDate })
      .then(({ data, error }) => { if (!cancelled) { if (error || !data) setError('Unable to review this date. Reload before saving.'); else { setReview({ ...data, locationId, effectiveDate }); setError('') } } })
      .catch(() => { if (!cancelled) setError('Unable to review this date. Reload before saving.') })
    return () => { cancelled = true }
  }, [locationId, effectiveDate, profile?.role, reviewRevision])
  if (profile?.role !== 'admin') return null
  const reviewed = review?.locationId === locationId && review?.effectiveDate === effectiveDate
  const correctionReady = !review?.requires_correction || (correctionConfirmed && note.trim().length >= 10)
  async function save() {
    const cents = revenueCents(amount)
    if (cents == null || !effectiveDate || !note.trim() || !confirmed || loadedLocation !== locationId || !reviewed || !correctionReady) return
    setSaving(true); setError(''); setMessage('')
    try {
      const { data, error } = await supabase.from('cash_on_hand_versions').insert({ location_id: locationId, effective_date: effectiveDate, amount_cents: cents, verification_note: note.trim(), correction_confirmed: correctionConfirmed, correction_review_token: review.token }).select().single()
      if (error || !data) throw error || new Error('Save unconfirmed')
      setVersions(old => [data, ...old].sort((a,b) => b.effective_date.localeCompare(a.effective_date) || Number(b.id)-Number(a.id)).slice(0, 20)); setConfirmed(false); setCorrectionConfirmed(false); setReview(null); setReviewRevision(value => value+1); setMessage('Cash on Hand saved. Previously submitted reconciliations keep their snapshots.')
    } catch { setError('Setting was not saved. Reload to check the latest effective date before retrying.') }
    finally { setSaving(false) }
  }
  const inputClass = 'block w-full border rounded-lg p-2 bg-white dark:bg-tm-dark-surface border-gray-300 dark:border-tm-dark-border'
  return <section className="mb-3 rounded-lg border p-3 bg-white dark:bg-tm-dark-card text-gray-800 dark:text-gray-100 text-sm">
    <h3 className="font-bold">Admin Cash on Hand</h3>
    <p className="text-xs">Choose when the verified fixed amount was actually in effect, including past business dates. Saved cash counts and reconciliation snapshots remain unchanged.</p>
    <fieldset disabled={saving} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
      <label>Location<select aria-label="Cash on Hand location" value={locationId} onChange={e => setLocationId(e.target.value)} className={inputClass}>{locations.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label>Cash on Hand ($)<input aria-label="Admin Cash on Hand amount" type="number" min="0" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setConfirmed(false); setCorrectionConfirmed(false) }} className={inputClass} /></label>
      <label>Effective business date<input aria-label="Cash on Hand effective business date" type="date" value={effectiveDate} onChange={e => { setEffectiveDate(e.target.value); setConfirmed(false) }} className={inputClass} /></label>
      <label className="sm:col-span-3">Verification source / reason<input aria-label="Cash on Hand verification source" maxLength={1000} value={note} onChange={e => { setNote(e.target.value); setConfirmed(false); setCorrectionConfirmed(false) }} className={inputClass} /></label>
      {effectiveDate && !reviewed && <p className="sm:col-span-3 text-xs">Reviewing effective business date before saving.</p>}
      {reviewed && <div className="sm:col-span-3 text-xs rounded border p-2 border-gray-300 dark:border-tm-dark-border">
        <p>Applies from {effectiveDate} {review.next_date ? `until the next setting on ${review.next_date} (not including that date)` : 'until a later setting takes effect'}.</p>
        <p>{review.active_id ? `Overlaps the setting of $${(Number(review.active_cents)/100).toFixed(2)} in effect on this date.` : 'No earlier setting covers this date.'}</p>
        <p>{review.saved_count} previously submitted cash entries in this period keep their saved snapshots.</p>
        {!!review.saved_business_dates?.length && <details><summary className="cursor-pointer">View affected business dates</summary>{review.saved_business_dates.join(', ')}</details>}
        {review.requires_correction && <><p className="font-semibold text-amber-800 dark:text-amber-300">Verified correction required. Explain the change (at least 10 characters). This changes the setting for new submissions only; existing reconciliations are not recalculated.</p><label><input type="checkbox" checked={correctionConfirmed} onChange={e => setCorrectionConfirmed(e.target.checked)} /> I reviewed the overlap and saved entries and authorize this audited setting correction.</label></>}
      </div>}
      <label className="sm:col-span-3"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified this fixed amount and its effective business date.</label>
    </fieldset>
    <button type="button" onClick={save} disabled={saving || loadedLocation !== locationId || revenueCents(amount) == null || !effectiveDate || !reviewed || !correctionReady || !note.trim() || !confirmed} className="mt-2 px-3 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save Cash on Hand'}</button>
    {error && <p role="alert" className="text-red-800 dark:text-red-300">{error}</p>}{message && <p role="status">{message}</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Cash on Hand history · latest 20 versions</summary>{versions.map(version => <p key={version.id} className="mt-1">${(Number(version.amount_cents) / 100).toFixed(2)} · effective {version.effective_date} · {version.verification_note} · {version.created_at} · user {version.created_by}</p>)}</details>
  </section>
}
