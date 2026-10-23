import { useState } from 'react'
import { KPI_COLUMNS, preferenceKey, readPreferences, savePreferences, normalizePreferences } from '../utils/performanceColumns.js'

function localStore() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}
export default function useKpiTablePreferences(tableId, userId, defaultSort) {
  const scope = preferenceKey(tableId, userId)
  const [state, setState] = useState(() => ({ scope, config: readPreferences(localStore(), scope, defaultSort), unsaved: false }))
  // Never render or save another account/table's preferences.
  const current = state.scope === scope ? state : { scope, config: readPreferences(localStore(), scope, defaultSort), unsaved: false }
  const update = change => {
    setState(previous => {
      const before = previous.scope === scope ? previous.config : readPreferences(localStore(), scope, defaultSort)
      const config = normalizePreferences(change(before), KPI_COLUMNS, defaultSort)
      return { scope, config, unsaved: !savePreferences(localStore(), scope, config) }
    })
  }
  const reset = () => update(() => normalizePreferences(null, KPI_COLUMNS, defaultSort))
  return { config: current.config, unsaved: current.unsaved, update, reset }
}
