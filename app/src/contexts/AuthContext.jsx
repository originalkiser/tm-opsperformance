import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setLocations([])
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('*, locations(*)')
      .eq('id', userId)
      .single()

    setProfile(prof)

    if (prof?.role === 'admin') {
      const { data: locs } = await supabase
        .from('locations')
        .select('*')
        .order('site_code')
      setLocations(locs || [])
    } else if (prof?.role === 'area_manager') {
      const { data: ml } = await supabase
        .from('manager_locations')
        .select('locations(*)')
        .eq('manager_id', userId)
      setLocations((ml || []).map(m => m.locations).filter(Boolean))
    } else if (prof?.location_id) {
      setLocations([prof.locations].filter(Boolean))
    }

    setLoading(false)
  }

  const signOut = () => supabase.auth.signOut()

  const updateProfileSettings = async (updates) => {
    if (!user) return
    const newSettings = { ...(profile?.settings || {}), ...updates }
    await supabase.from('user_profiles').update({ settings: newSettings }).eq('id', user.id)
    setProfile(prev => prev ? { ...prev, settings: newSettings } : prev)
  }

  return (
    <AuthContext.Provider value={{ user, profile, locations, loading, signOut, updateProfileSettings }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
