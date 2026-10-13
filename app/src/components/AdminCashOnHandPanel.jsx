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
  const location = locations.find(site => site.id === locationId)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: location?.timezone || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  useEffect(() => {
    let cancelled = false
    setLoadedLocation(null); setVersions([]); setAmount(''); setEffectiveDate(''); setNote(''); setConfirmed(false); setError(''); setMessage('')
    if (profile?.role !== 'admin' || !locationId) return
    supabase.from('cash_on_hand_versions').select('*').eq('location_id', locationId).order('effective_date', { ascending: false }).order('id', { ascending: false }).limit(20)
      .then(({ data, error }) => { if (!cancelled) { if (error) setError('Unable to load settings. Reload before saving.'); else { setVersions(data || []); setLoadedLocation(locationId) } } })
      .catch(() => { if (!cancelled) setError('Unable to load settings. Reload before saving.') })
    return () => { cancelled = true }
  }, [locationId, profile?.role])
  if (profile?.role !== 'admin') return null
  const minimum = versions.length ? (versions[0].effective_date > today ? versions[0].effective_date : today) : undefined
  async function save() {
    const cents = revenueCents(amount)
    if (cents == null || !effectiveDate || !note.trim() || !confirmed || loadedLocation !== locationId || (minimum && effectiveDate < minimum)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const { data, error } = await supabase.from('cash_on_hand_versions').insert({ location_id: locationId, effective_date: effectiveDate, amount_cents: cents, verification_note: note.trim() }).select().single()
      if (error || !data) throw error || new Error('Save unconfirmed')
      setVersions(old => [data, ...old].slice(0, 20)); setConfirmed(false); setMessage('Cash on Hand saved. Previously submitted reconciliations keep their snapshots.')
    } catch { setError('Setting was not saved. Reload to check the latest effective date before retrying.') }
    finally { setSaving(false) }
  }
  const inputClass = 'block w-full border rounded-lg p-2 bg-white dark:bg-tm-dark-surface border-gray-300 dark:border-tm-dark-border'
  return <section className="mb-3 rounded-lg border p-3 bg-white dark:bg-tm-dark-card text-gray-800 dark:text-gray-100 text-sm">
    <h3 className="font-bold">Admin Cash on Hand</h3>
    <p className="text-xs">Changes apply to future business dates. Saved reconciliations retain their original setting. For initial setup, choose the first business date the verified amount was in effect.</p>
    <fieldset disabled={saving} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
      <label>Location<select aria-label="Cash on Hand location" value={locationId} onChange={e => setLocationId(e.target.value)} className={inputClass}>{locations.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label>Cash on Hand ($)<input aria-label="Admin Cash on Hand amount" type="number" min="0" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setConfirmed(false) }} className={inputClass} /></label>
      <label>Effective business date<input aria-label="Cash on Hand effective business date" type="date" min={minimum} value={effectiveDate} onChange={e => { setEffectiveDate(e.target.value); setConfirmed(false) }} className={inputClass} /></label>
      <label className="sm:col-span-3">Verification source / reason<input aria-label="Cash on Hand verification source" maxLength={1000} value={note} onChange={e => { setNote(e.target.value); setConfirmed(false) }} className={inputClass} /></label>
      <label className="sm:col-span-3"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified this fixed amount and its effective business date.</label>
    </fieldset>
    <button type="button" onClick={save} disabled={saving || loadedLocation !== locationId || revenueCents(amount) == null || !effectiveDate || (minimum && effectiveDate < minimum) || !note.trim() || !confirmed} className="mt-2 px-3 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save Cash on Hand'}</button>
    {error && <p role="alert" className="text-red-800 dark:text-red-300">{error}</p>}{message && <p role="status">{message}</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Cash on Hand history · latest 20 versions</summary>{versions.map(version => <p key={version.id} className="mt-1">${(Number(version.amount_cents) / 100).toFixed(2)} · effective {version.effective_date} · {version.verification_note} · {version.created_at} · user {version.created_by}</p>)}</details>
  </section>
}
