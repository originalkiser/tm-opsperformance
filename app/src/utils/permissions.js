// UI scope only. PostgreSQL RLS remains the authority for all writes.
export const isSupportedRole = role => role === 'admin' || role === 'store'
export const isActiveProfile = profile => !!profile && profile.is_active === true && !profile.deleted_at
export const canAdminister = profile => isActiveProfile(profile) && profile.role === 'admin'
export const canReadCompanyPerformance = profile => isActiveProfile(profile) && isSupportedRole(profile.role)

export function assignedStoreLocations(profile, mappings = []) {
  if (!isActiveProfile(profile) || profile.role !== 'store') return []
  const sites = [profile.locations, ...mappings.map(row => row.locations)].filter(Boolean)
  return [...new Map(sites.map(site => [site.id, site])).values()]
    .sort((a, b) => (a.site_code || '').localeCompare(b.site_code || ''))
}

export function canEditOperationalLocation(profile, assignedLocations, locationId) {
  return !!locationId && (canAdminister(profile) || (
    isActiveProfile(profile) && profile.role === 'store' && assignedLocations.some(site => site.id === locationId)
  ))
}

// Reporting filters never participate in operational entry scope.
export function entryLocations(profile, assignedLocations, market = '') {
  return canAdminister(profile) && market
    ? assignedLocations.filter(site => site.market === market)
    : assignedLocations
}
