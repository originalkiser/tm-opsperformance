import { washOverridesError } from '../utils/budgetConversion.js'
import { fetchDailyRevenueGoals } from '../utils/dailyRevenueGoals.js'
import { cashCountError } from '../utils/cashReconciliation.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emptyDailyForm, countMissing, validateRevenue } from '../utils/budgetDailyFields'
import { calculateMtdRevenue, dailyPayload, fetchRevenueEntries, budgetMonthStart, latestHistoricalRevenue, fetchStartingBalances } from '../utils/budgetRevenue'

export default function useBudgetDailyEntry(locationId, entryDate, onSaved, location) {

  const [form, setForm] = useState(emptyDailyForm)
  const [entry, setEntry] = useState(null)
  const [target, setTarget] = useState(null)
  const [entries, setEntries] = useState([])
  const [dailyGoals, setDailyGoals] = useState([])
  const [goalError, setGoalError] = useState('')
  const [startingBalance, setStartingBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadedScope, setLoadedScope] = useState(null)
  const [saving, setSaving] = useState(false)
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const generation = useRef(0)
  const savingRef = useRef(false)
  const scope = `${locationId}|${entryDate}`
  const isLoading = loading || loadedScope !== scope

  useEffect(() => {
    const id = ++generation.current
    setLoading(true)
    setLoadedScope(null)
    setError('')
    setSaved(false)
    setEntry(null)
    setTarget(null)
    setEntries([])
    setDailyGoals([])
    setGoalError('')
    setStartingBalance(null)
    setForm(emptyDailyForm())
    setAttemptedSave(false)
    async function load() {
      try {
        const [rows, result, balances, goals] = await Promise.all([
          fetchRevenueEntries(supabase, [locationId], entryDate),
          supabase.from('budget_targets').select('*').eq('location_id', locationId)
            .eq('target_month', budgetMonthStart(entryDate)).maybeSingle(),
          fetchStartingBalances(supabase, [locationId], entryDate),
          fetchDailyRevenueGoals(supabase, [locationId], entryDate)
            .then(data => ({ data })).catch(() => ({ data: [], error: 'Daily revenue goals unavailable; actuals can still be saved.' })),
        ])
        if (result.error) throw result.error
        if (generation.current !== id) return
        const current = rows.find(row => row.entry_date === entryDate) || null
        setEntries(rows)
        setDailyGoals(goals.data)
        setGoalError(goals.error || '')
        setStartingBalance(balances[0] || null)
        setEntry(current)
        setTarget(result.data)
        setForm(current ? Object.fromEntries(Object.keys(emptyDailyForm()).map(key => [key, current[key] ?? ''])) : emptyDailyForm())
        setLoadedScope(`${locationId}|${entryDate}`)
      } catch {
        if (generation.current === id) {
          setLoadedScope(`${locationId}|${entryDate}`)
          setError('Unable to load entries. Reload before saving; totals are unavailable.')
        }
      } finally {
        if (generation.current === id) setLoading(false)
      }
    }
    if (locationId) load()
    return () => { generation.current++ }
  }, [supabase, locationId, entryDate])

  const set = (key, value) => {
    setSaved(false)
    setForm(current => ({ ...current, [key]: value }))
  }
  const mtdRevenue = useMemo(() => calculateMtdRevenue([
    ...entries.filter(row => row.entry_date !== entryDate),
    { ...form, location_id: locationId, entry_date: entryDate },
  ], locationId, entryDate, startingBalance), [entries, form, locationId, entryDate, startingBalance])
  const missing = countMissing(form)
  const historicalRevenue = useMemo(() => latestHistoricalRevenue([...entries.filter(row => row.entry_date !== entryDate), { location_id: locationId, entry_date: entryDate, mtd_revenue_actual: form.mtd_revenue_actual }], locationId, entryDate, mtdRevenue.startingBalance), [entries, form.mtd_revenue_actual, locationId, entryDate, mtdRevenue.startingBalance])
  const revenueError = validateRevenue(form) || cashCountError(form.yesterday_cash_counted) || washOverridesError(form, location)

  const handleSave = async () => {
    setAttemptedSave(true)
    if (savingRef.current || isLoading || error || missing || revenueError) return
    savingRef.current = true
    setSaving(true)
    setSaved(false)
    const id = generation.current
    try {
      const { data, error: saveError } = await supabase.from('budget_daily_entries')
        .upsert(dailyPayload(form, locationId, entryDate, location), { onConflict: 'location_id,entry_date' })
        .select('*').single()
      if (saveError) throw saveError
      if (!data) throw new Error('Save could not be confirmed.')
      if (generation.current !== id) return
      setEntry(data)
      setEntries(rows => [...rows.filter(row => row.entry_date !== entryDate), data])
      setSaved(true)
      onSaved?.()
    } catch {
      if (generation.current === id) setError('Unable to confirm the save. Reload to check the stored entry before retrying.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  return { dailyGoals, goalError, form, entry, target, loading: isLoading, saving, attemptedSave, error, saved, set, missing, revenueError, mtdRevenue, historicalRevenue, handleSave, startingBalance, updateStartingBalance: setStartingBalance }
}
