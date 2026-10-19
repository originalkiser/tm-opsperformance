import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { clearLocationSelection, locationFailureMessage, recoverLocationAccess } from '../utils/locationAccess'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [locationError, setLocationError] = useState('')
  const [repairingLocation, setRepairingLocation] = useState(false)
  const [locationRepairMessage, setLocationRepairMessage] = useState('')
  const [locationSelectionVersion, setLocationSelectionVersion] = useState(0)
  const repair = useRef(null)

  useEffect(() => {
    let alive = true, currentId = null, loadedId = null, pendingId = null, generation = 0
    let authEventSeen = false, scheduled
    const load = async (userId, manual = false) => {
      const request = ++generation
      pendingId = userId
      setLocationError('')
      if (manual) {
        setRepairingLocation(true); setLocationRepairMessage(''); setLocations([])
        clearLocationSelection()
        setLocationSelectionVersion(value => value + 1)
      }
      try {
        const result = await recoverLocationAccess(supabase, userId)
        if (!alive || generation !== request || currentId !== userId) return
        setProfile(result.profile); setLocations(result.locations)
        loadedId = userId // Failed reads must remain retryable for the same user.
        if (manual) setLocationRepairMessage(result.locations.length
          ? 'Your locations have been reloaded. Return to Site Entry to continue.'
          : result.profile.role === 'store'
          ? 'No location is assigned to your account. An Admin must assign your location.'
          : 'No locations are available to your account. Ask an Admin to check your access.')
      } catch (error) {
        if (!alive || generation !== request || currentId !== userId) return
        loadedId = null
        setLocations([]); setLocationError(locationFailureMessage(error))
      } finally {
        if (alive && generation === request) {
          pendingId = null; setLoading(false); setRepairingLocation(false)
        }
      }
    }
    const acceptSession = session => {
      if (!alive) return
      const next = session?.user || null
      setUser(next)
      if (next?.id !== currentId || !next) {
        currentId = next?.id || null
        generation++; loadedId = null; pendingId = null
        clearTimeout(scheduled)
        setProfile(null); setLocations([]); setLocationError(''); setLocationRepairMessage(''); setRepairingLocation(false)
        setLoading(!!next)
      }
      if (!next) return
      // Keep healthy token refreshes from reloading forms. Query outside the auth callback.
      if (loadedId === next.id || pendingId === next.id) return
      clearTimeout(scheduled)
      scheduled = setTimeout(() => { if (alive && currentId === next.id) load(next.id) }, 0)
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventSeen = true
      acceptSession(session)
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || authEventSeen) return
      if (error) throw error
      acceptSession(data?.session)
    }).catch(() => {
      if (alive && !authEventSeen) {
        setLocationError('Your session could not be loaded. Try Reload My Location, or sign in again.'); setLoading(false)
      }
    })
    repair.current = async () => {
      if (pendingId || !alive) return
      if (!currentId) {
        try {
          const { data, error } = await supabase.auth.getSession()
          if (error) throw error
          if (!alive) return
          if (!data?.session?.user) throw new Error('Your session could not be recovered. Save any work, then sign in again.')
          acceptSession(data.session)
          clearTimeout(scheduled)
        } catch (error) {
          if (alive) setLocationError(locationFailureMessage(error))
          return
        }
      }
      clearTimeout(scheduled)
      return load(currentId, true)
    }
    return () => {
      alive = false; generation++; clearTimeout(scheduled); repair.current = null; subscription.unsubscribe()
    }
  }, [])

  const reloadMyLocation = () => repair.current?.()
  const signOut = () => supabase.auth.signOut()

  const updateProfileSettings = async (updates) => {
    if (!user) return
    const newSettings = { ...(profile?.settings || {}), ...updates }
    await supabase.from('user_profiles').update({ settings: newSettings }).eq('id', user.id)
    setProfile(prev => prev ? { ...prev, settings: newSettings } : prev)
  }

  return (
    <AuthContext.Provider value={{ user, profile, locations, loading, signOut, updateProfileSettings,
      locationError, repairingLocation, locationRepairMessage, locationSelectionVersion, reloadMyLocation }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
