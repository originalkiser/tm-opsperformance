import { loadMembershipSnapshots, selectMtdNetMembers, latestDailyNetMembers } from '../utils/dashboardNetMembers.js'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { watchBudgetReport } from '../utils/budgetReportRefresh.js'
import { businessToday, currentMtdRange, loadPerformanceLogs, loadDailyNetHistory, selectTodayPerformance } from '../utils/dashboardPerformance.js'
import SiteMetricTable, { PerformanceTable } from './SiteMetricTable'

export default function DashboardPerformance({ locations, daily = false, companyRead = false }) {
  const [state, setState] = useState({ key: null, logs: [], range: null, updated: null, error: null, netMembers: {}, netError: null })
  const ids = locations.map(l => l.id).sort().join(',')
  const locationKey = locations.map(l => `${l.id}:${l.timezone}:${l.opportunities_formula}`).sort().join(',')
  useEffect(() => {
    let live = true, busy = false
    async function load() {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const now = new Date()
        const dates = locations.map(l => businessToday(l, now)).sort()
        const range = daily ? { start: dates[0], end: dates.at(-1) } : currentMtdRange(locations, now)
        const logs = await loadPerformanceLogs(supabase, locations, range)
        let netMembers = {}, netError = null
        if (daily) {
          try {
            const history = await loadDailyNetHistory(supabase, locations, range.end, now)
            netMembers = Object.fromEntries(locations.map(loc => [loc.id, latestDailyNetMembers(history, loc, businessToday(loc, now), now)]))
          } catch (error) { netError = error.message }
        } else {
          try {
            const snapshots = await loadMembershipSnapshots(supabase, locations, range)
            netMembers = selectMtdNetMembers(logs, snapshots, locations, range, now)
          } catch (error) { netError = error.message }
        }
        if (live) setState({ key: ids, logs, range, updated: new Date(), error: null, netMembers, netError })
      } catch (error) {
        if (live) setState(prev => ({ ...prev, error: error.message }))
      } finally { busy = false }
    }
    load()
    const stop = watchBudgetReport(load)
    return () => { live = false; stop() }
  }, [ids, locationKey, daily])
  const source = useMemo(() => ({ ...selectTodayPerformance(state.logs, locations), netMembers: state.netMembers }), [state.logs, state.netMembers, locations])
  if (!locations.length) return <p className="text-sm py-3">No locations match the filters.</p>
  const current = state.key === ids
  return <div>
    <p className="text-xs text-gray-500 dark:text-tm-dark-muted mb-3" role="status">
      Last Refreshed: {current && state.updated ? state.updated.toLocaleString() : 'Not loaded yet'} · Refreshes every 60 seconds while this Dashboard is visible.
      {daily ? ' Current business day in each location’s time zone; Net Members retains the latest reported daily balance with its date.' : ' Current month to date; other metrics use the completed business-day cutoff. Net Members adds reported uncovered daily activity.'}
    </p>
    {state.netError && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{state.netError}</p>}
    {state.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{state.error}</p>}
    {current && state.range ? daily
      ? <PerformanceTable source={source} locations={locations} dateRange={state.range} title="Today's Performance" daily />
      : <SiteMetricTable data={state.logs} locations={locations} dateRange={state.range} title="MTD Performance" companyRead={companyRead} netMembers={state.netMembers} />
      : !state.error && <p className="text-sm py-3">Loading performance…</p>}
  </div>
}
