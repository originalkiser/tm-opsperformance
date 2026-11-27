import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readLocationEmployees } from '../utils/employeeIdentity.js'
import { loadConsolidatedRoster } from '../utils/employeeRoster.js'

export function useTeamSalesIdentities(locationKey, refresh) {
  const [state, setState] = useState(null)
  useEffect(() => {
    let current = true
    const sites = JSON.parse(locationKey)
    Promise.allSettled(sites.map(async id => {
      const [roster, audits] = await Promise.all([
        readLocationEmployees(supabase, id), loadConsolidatedRoster(supabase, id),
      ])
      return { id, roster, audits }
    })).then(results => {
      if (current) setState({
        locationKey, refresh,
        sites: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
        incomplete: results.some(result => result.status !== 'fulfilled'),
      })
    })
    return () => { current = false }
  }, [locationKey, refresh])
  return state?.locationKey === locationKey && state.refresh === refresh ? state : null
}
