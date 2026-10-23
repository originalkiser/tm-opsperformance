import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadPerformanceLogs, loadDailyNetHistory } from '../utils/dashboardPerformance.js'
import { latestDailyNetMembers, loadMembershipSnapshots, selectMtdNetMembers } from '../utils/dashboardNetMembers.js'
import { shiftDate } from '../utils/budgetRevenue.js'
import { watchBudgetReport } from '../utils/budgetReportRefresh.js'

// Reports' MTD ends the day before the selected morning reporting date.
// Other ranges show a dated daily balance, never label it an MTD aggregate.
export default function useReportNetMembers(locations, range, mtd) {
  const ids = locations.map(l => `${l.id}:${l.timezone}:${l.opportunities_formula}:${l.show_budget_tracking}`).sort().join(',')
  const key = `${ids}:${range.start}:${range.end}:${mtd}`
  const [state, setState] = useState({ key: null, values: {}, error: null })
  useEffect(() => {
    let live = true, generation = 0
    const load = async () => {
      const request = ++generation
      try {
        const cutoff = mtd ? shiftDate(range.end, -1) : range.end
        const netRange = { start: range.start, end: cutoff }
        const logs = mtd ? await loadPerformanceLogs(supabase, locations, netRange)
          : await loadDailyNetHistory(supabase, locations, cutoff)
        const snapshots = mtd && cutoff >= range.start ? await loadMembershipSnapshots(supabase, locations, netRange, range.end) : []
        const values = mtd ? selectMtdNetMembers(logs, snapshots, locations, netRange, new Date(), range.end)
          : Object.fromEntries(locations.map(loc => [loc.id, latestDailyNetMembers(logs, loc, cutoff)]))
        if (live && request === generation) setState({ key, values, error: null })
      } catch (error) {
        if (live && request === generation) setState({ key, values: {}, error: error.message })
      }
    }
    load()
    const stop = watchBudgetReport(load)
    return () => { live = false; generation++; stop() }
  }, [key])
  return { values: state.key === key ? state.values : {}, error: state.key === key ? state.error : null }
}
