import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { shiftDate } from '../utils/budgetRevenue.js'
import { isMtdRange, selectPerformanceSources, commonReportingToday, completedCutoff } from '../utils/budgetPerformanceSource.js'
import { loadDashboardMtd } from '../utils/dashboardMtdRead.js'
import { watchBudgetReport } from '../utils/budgetReportRefresh.js'

export default function useBudgetPerformance(logs, locations, range, { companyRead = false } = {}) {
  const ids = locations.filter(l => l.show_budget_tracking).map(l => l.id).sort().join(',')
  const today = commonReportingToday(locations)
  const key = `${companyRead}:${today}:${ids}:${range?.start}:${range?.end}`
  const [state, setState] = useState({ key: null, entries: [], error: null })
  useEffect(() => {
    let live = true
    if (!ids || !isMtdRange(range)) return
    async function load() {
      if (companyRead) {
        try {
          const entries = await loadDashboardMtd(supabase, locations, range, completedCutoff(range, today))
          if (live) setState({ key, entries, error: null })
        } catch (error) {
          if (live) setState({ key, entries: [], error: error.message })
        }
        return
      }
      const entries = []
      for (let offset = 0;; offset += 1000) {
        const { data, error } = await supabase.from('budget_daily_entries').select('*')
          .in('location_id', ids.split(',')).gte('entry_date', shiftDate(range.start, 1))
          .lte('entry_date', shiftDate(range.end, 1)).order('entry_date').order('location_id').range(offset, offset + 999)
        if (error) { if (live) setState({ key, entries: [], error: 'Budget Tracking totals could not be loaded.' }); return }
        entries.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      if (live) setState({ key, entries, error: null })
    }
    load()
    const stop = watchBudgetReport(load)
    return () => { live = false; stop() }
  }, [key, logs])
  // One company-wide completed business date; never append today's partial logs.
  const result = selectPerformanceSources(logs, state.key === key ? state.entries : [], locations, range, today)
  return { ...result, loading: result.active && state.key !== key, error: state.key === key ? state.error : null }
}
