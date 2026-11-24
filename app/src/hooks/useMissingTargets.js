import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useDisplayAuth as useAuth } from '../contexts/AuthContext'
import { findMissingTargets, isTargetReminderLocation, targetReminderMonths, TARGETS_SAVED_EVENT } from '../utils/targetsNotifications'

export function useMissingTargets() {
  const { profile, locations } = useAuth()
  const [result, setResult] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const canSetTargets = profile?.role === 'admin'
  const trackedLocations = canSetTargets ? locations.filter(isTargetReminderLocation) : []
  const scope = JSON.stringify([profile?.id, trackedLocations.map(location => location.id)])
  const refetch = useCallback(() => setRefresh(n => n + 1), [])

  useEffect(() => {
    const [, ids] = JSON.parse(scope)
    if (!ids.length) return
    let active = true
    const today = new Date()
    supabase.from('budget_targets').select('location_id, target_month')
      .in('location_id', ids).in('target_month', targetReminderMonths(today))
      .then(({ data, error }) => {
        if (active && !error) setResult({ scope, today, targets: data || [] })
      })
    return () => { active = false }
  }, [scope, refresh])

  useEffect(() => {
    if (!canSetTargets) return
    let timer
    const schedule = () => {
      clearTimeout(timer)
      const midnight = new Date()
      midnight.setHours(24, 0, 0, 0)
      timer = setTimeout(() => { refetch(); schedule() }, midnight - Date.now())
    }
    const onVisible = () => { if (!document.hidden) { refetch(); schedule() } }
    schedule()
    window.addEventListener(TARGETS_SAVED_EVENT, refetch)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(TARGETS_SAVED_EVENT, refetch)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [canSetTargets, refetch])

  const ready = result?.scope === scope
  return {
    missing: ready ? findMissingTargets(trackedLocations, result.targets, result.today) : [],
    loading: trackedLocations.length > 0 && !ready,
    refetch,
    scope,
  }
}
