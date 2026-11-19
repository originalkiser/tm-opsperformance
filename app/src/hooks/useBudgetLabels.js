import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { readBudgetLabels } from '../utils/budgetLabels'

export default function useBudgetLabels() {
  const { user, profile } = useAuth()
  const [state, setState] = useState(null)
  const scope = user?.id && profile?.is_active && !profile.deleted_at ? `${user.id}:${profile.role}` : ''
  useEffect(() => {
    let active = true, generation = 0
    setState(null)
    const load = async () => {
      const current = ++generation
      if (!scope) return
      try {
        const labels = await readBudgetLabels(supabase)
        if (active && current === generation) setState({ scope, labels, error: '' })
      } catch (error) {
        if (active && current === generation) setState({ scope, labels: {}, error: error.message })
      }
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener('tm-budget-labels-updated', load)
    return () => { active = false; generation++; window.removeEventListener('focus', load); window.removeEventListener('tm-budget-labels-updated', load) }
  }, [scope])
  return state?.scope === scope ? state : { labels: {}, error: '' }
}
