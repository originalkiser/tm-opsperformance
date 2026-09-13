import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { findMissingTargets } from '../utils/targetsNotifications'

// Locations this viewer could plausibly be reminded about: their assigned
// (or all, for admin) sites that have Budget Tracking turned on. Store users
// never set targets, so they never see this.
export function useMissingTargets() {
  const { profile, locations } = useAuth()
  const [missing, setMissing] = useState([])
  const [loading, setLoading] = useState(true)

  const canSetTargets = profile?.role === 'admin' || profile?.role === 'area_manager'
  const trackedLocations = canSetTargets ? locations.filter(l => l.show_budget_tracking) : []

  useEffect(() => {
    if (!canSetTargets || !trackedLocations.length) { setLoading(false); return }
    let cancelled = false
    supabase.from('budget_targets').select('location_id, target_month')
      .in('location_id', trackedLocations.map(l => l.id))
      .then(({ data }) => {
        if (cancelled) return
        setMissing(findMissingTargets(trackedLocations, data || []))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profile?.role, JSON.stringify(trackedLocations.map(l => l.id))])

  return { missing, loading, trackedLocations }
}
