import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { localChecklistDate } from '../utils/checklistRules'

export function useChecklistAccess() {
  const { profile, user, locations } = useAuth()
  const [grants, setGrants] = useState([])
  useEffect(() => {
    let alive = true
    setGrants([])
    if (user && profile && profile.role !== 'admin') supabase.from('checklist_pilot_access').select('location_id,enabled_from').eq('is_active', true)
      .then(({ data, error }) => { if (alive && !error) setGrants(data || []) })
    return () => { alive = false }
  }, [user?.id, profile?.role, locations])
  return profile?.is_active === true && !profile.deleted_at && (profile.role === 'admin' || grants.some(g => {
    const site = locations.find(l => l.id === g.location_id)
    try { return site && g.enabled_from <= localChecklistDate(site.timezone) } catch { return false }
  }))
}
