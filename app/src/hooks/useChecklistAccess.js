import { useAuth } from '../contexts/AuthContext'

export function useChecklistAccess() {
  const { profile, user, locations } = useAuth()
  return !!user && profile?.is_active === true && !profile.deleted_at &&
    (profile.role === 'admin' || (['store', 'area_manager'].includes(profile.role) && locations.length > 0))
}
