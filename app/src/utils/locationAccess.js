// Read current assignments using the signed-in client. RLS remains authoritative.
export async function fetchLocationAccess(client, userId) {
  const { data: profile, error } = await client.from('user_profiles')
    .select('*, locations(*)').eq('id', userId).single()
  if (error) throw error
  if (!profile) throw new Error('Your account could not be loaded. Ask an Admin to check your account.')
  let locations = []
  if (profile.role === 'admin') {
    const result = await client.from('locations').select('*').order('site_code')
    if (result.error) throw result.error
    locations = result.data || []
  } else if (profile.role === 'area_manager') {
    const result = await client.from('manager_locations').select('locations(*)').eq('manager_id', userId)
    if (result.error) throw result.error
    if (result.data?.some(row => !row.locations)) throw new Error('An assigned location is unavailable. Ask an Admin to check your access.')
    locations = (result.data || []).map(row => row.locations)
  } else if (profile.role === 'store' && profile.location_id) {
    if (!profile.locations || profile.locations.id !== profile.location_id) {
      throw new Error('Your assigned location is unavailable. Ask an Admin to check your access.')
    }
    locations = [profile.locations]
  }
  return { profile, locations }
}

const sessionError = error => error?.status === 401 || ['PGRST301', 'PGRST303', 'bad_jwt', 'session_expired', 'refresh_token_not_found'].includes(error?.code)

export async function recoverLocationAccess(client, userId) {
  try { return await fetchLocationAccess(client, userId) }
  catch (error) {
    if (!sessionError(error)) throw error
    // Retry once only for an authentication failure, never for missing assignments.
    const result = await client.auth.refreshSession()
    if (result.error || !result.data?.session || result.data.session.user.id !== userId) {
      throw new Error('Your session could not be recovered. Save any work, then sign in again.')
    }
    return fetchLocationAccess(client, userId)
  }
}

export function locationFailureMessage(error) {
  if (error instanceof Error && /^(Your account|Your assigned|An assigned|Your session)/.test(error.message)) return error.message
  return 'We could not reload your locations. Check your connection and try again. If this continues, ask an Admin to check your access.'
}

// Remove only entry selection preferences, never authentication or reporting data.
export function clearLocationSelection(storage) {
  try {
    const target = storage || window.localStorage
    for (const key of ['tm_selected_location', 'tm_market_filter', 'tm_entry_market_filter']) target.removeItem(key)
  } catch { /* Storage may be blocked in Edge. Repair can still fetch assignments. */ }
}

export function resolveEntryLocation(locations, savedId) {
  return locations.some(site => site.id === savedId) ? savedId : locations.length === 1 ? locations[0].id : null
}

export function entryLocationOptions(profile, locations, market) {
  const canFilter = ['admin', 'area_manager'].includes(profile?.role)
  return canFilter && market && locations.some(site => site.market === market)
    ? locations.filter(site => site.market === market) : locations
}
