import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchRevenueEntries, fetchStartingBalances, revenueMonthStart } from '../utils/budgetRevenue.js'
import { buildBudgetReportRows } from '../utils/budgetReportRows.js'
import { watchBudgetReport } from '../utils/budgetReportRefresh.js'

// Filters affect display, never the competitive pool. No partial/failed reads.
export default function useBudgetReport(locations, reportingDate) {
  const ids = locations.filter(l => l.show_budget_tracking && !l.exclude_from_reporting).map(l => l.id).sort().join(',')
  const key = `${ids}:${reportingDate}`
  const [state, setState] = useState({ key: null, targets: [], entries: [], balances: [], error: '' })
  const reload = useRef(() => {})
  useEffect(() => {
    let active = true, generation = 0
    const load = async () => {
      const request = ++generation
      try {
        const locIds = ids ? ids.split(',') : []
        const [targetResult, entries, balances] = locIds.length && reportingDate ? await Promise.all([
          supabase.from('budget_targets').select('*').in('location_id', locIds).eq('target_month', revenueMonthStart(reportingDate)),
          fetchRevenueEntries(supabase, locIds, reportingDate),
          fetchStartingBalances(supabase, locIds, reportingDate),
        ]) : [{ data: [] }, [], []]
        if (targetResult.error) throw targetResult.error
        if (active && request === generation) setState({ key, targets: targetResult.data || [], entries, balances, error: '' })
      } catch {
        if (active && request === generation) setState({ key, targets: [], entries: [], balances: [], error: 'Unable to load the report. Revenue totals and pace are unavailable; please reload.' })
      }
    }
    reload.current = load
    load()
    const stop = watchBudgetReport(load)
    return () => { active = false; generation++; stop() }
  }, [key])
  const current = state.key === key
  return {
    rows: current && !state.error && reportingDate ? buildBudgetReportRows({ locations, ...state }, reportingDate) : [],
    loading: !current, error: current ? state.error : '', refresh: () => reload.current(),
  }
}
