import { useDisplayAuth as useAuth } from '../contexts/AuthContext'

export function useChecklistAccess() {
  const { profile, user, locations } = useAuth()
  return !!user && profile?.is_active === true && !profile.deleted_at &&
    (profile.role === 'admin' || (['store'].includes(profile.role) && locations.length > 0))
}
