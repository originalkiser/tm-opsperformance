import * as columns from '../../src/utils/performanceColumns.js'

// Existing rendering/score regression fixtures do not need a browser or AuthProvider.
// Interactive customization/persistence are exercised with the real hook separately.
export function kpiTableBindings(initialSort) {
  let config
  return { ...columns, useAuth: () => ({}), KpiTableControls: () => null,
    useKpiTablePreferences(tableId, userId, defaultSort) {
      config ||= columns.normalizePreferences({ sort: initialSort }, columns.KPI_COLUMNS, defaultSort)
      return { config, update(change) { config = columns.normalizePreferences(change(config), columns.KPI_COLUMNS, defaultSort) },
        reset() { config = columns.normalizePreferences(null, columns.KPI_COLUMNS, defaultSort) }, unsaved: false }
    },
  }
}
