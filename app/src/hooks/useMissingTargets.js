import { useState, useEffect, useCallback } from 'react'
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
  const trackedIds = trackedLocations.map(l => l.id)

  const refetch = useCallback(() => {
    if (!canSetTargets || !trackedIds.length) { setMissing([]); setLoading(false); return }
    setLoading(true)
    supabase.from('budget_targets').select('location_id, target_month')
      .in('location_id', trackedIds)
      .then(({ data }) => {
        setMissing(findMissingTargets(trackedLocations, data || []))
        setLoading(false)
      })
  }, [canSetTargets, JSON.stringify(trackedIds)])

  useEffect(() => { refetch() }, [refetch])

  return { missing, loading, trackedLocations, refetch }
}
