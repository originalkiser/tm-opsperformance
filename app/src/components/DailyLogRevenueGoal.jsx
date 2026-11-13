import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchDailyRevenueGoal } from '../utils/dailyRevenueGoals.js'
import { displayMoney } from '../utils/budgetDisplay.js'

export default function DailyLogRevenueGoal({ locationId, businessDate }) {
  const scope = `${locationId}|${businessDate}`
  const [result, setResult] = useState(null)
  useEffect(() => {
    let current = true
    fetchDailyRevenueGoal(supabase, locationId, businessDate)
      .then(goal => { if (current) setResult({ scope, goal }) })
      .catch(() => { if (current) setResult({ scope, goal: null }) })
    return () => { current = false }
  }, [locationId, businessDate])
  const goal = result?.scope === scope ? result.goal : null
  return <div className="min-w-0 text-right" role="status" aria-live="polite" aria-label="Daily Revenue Goal">
    <span className="block text-xs font-brand font-semibold text-gray-600 dark:text-tm-dark-muted">Daily Revenue Goal</span>
    <strong className="block break-words font-brand text-lg font-bold leading-tight text-tm-blue dark:text-tm-teal">{goal == null ? 'No Daily Goal Set' : displayMoney(goal)}</strong>
  </div>
}
