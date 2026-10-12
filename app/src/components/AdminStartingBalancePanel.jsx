import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { TRANSITION_MONTH } from '../utils/budgetRevenue'
import RevenueStartingBalanceEditor from './RevenueStartingBalanceEditor'

export default function AdminStartingBalancePanel({ locations, onSaved, onClose }) {
  const { profile } = useAuth()
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadedLocationId, setLoadedLocationId] = useState(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const activeLocation = useRef(locationId)
  activeLocation.current = locationId
  const location = locations.find(site => site.id === locationId)
  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setLoadedLocationId(null); setBalance(null); setError('')
    if (profile?.role !== 'admin' || !locationId) { setLoadedLocationId(locationId); setLoading(false); return }
    supabase.from('revenue_starting_balances').select('*').eq('location_id', locationId)
      .eq('revenue_month', TRANSITION_MONTH).maybeSingle().then(({ data, error: loadError }) => {
        if (generation.current !== current) return
        if (loadError) setError('Unable to load the starting balance. Reload before saving.')
        else setBalance(data)
        setLoadedLocationId(locationId); setLoading(false)
      }).catch(() => { if (generation.current === current) { setError('Unable to load the starting balance. Reload before saving.'); setLoadedLocationId(locationId); setLoading(false) } })
    return () => { generation.current++ }
  }, [locationId, profile?.role])
  if (profile?.role !== 'admin') return null
  return <section className="rounded-xl border p-4 space-y-3 bg-white dark:bg-tm-dark-card text-gray-800 dark:text-gray-100">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Admin starting balances · October 2026</h3><button onClick={onClose} aria-label="Close starting-balance editor">Close</button></div>
    <p className="text-xs">Save a verified balance independently. No daily-entry fields are required.</p>
    <label className="block text-sm">Location<select aria-label="Starting balance location" value={locationId} onChange={event => setLocationId(event.target.value)} className="block p-2 border rounded bg-white dark:bg-tm-dark-surface">{locations.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    {loading || loadedLocationId !== locationId ? <p>Loading starting balance…</p> : error ? <p role="alert">{error}</p> : location && <RevenueStartingBalanceEditor key={locationId} locationId={locationId} timeZone={location.timezone} balance={balance} onSaved={data => { if (activeLocation.current === data.location_id) setBalance(data); onSaved(data) }} />}
  </section>
}
