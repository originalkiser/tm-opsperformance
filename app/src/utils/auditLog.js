// Append-only audit trail for Budget Target and Ownership Scorecard edits.
// Every save on the AM Entry page logs a diff so a mid-month change shows
// who touched it, when, and exactly what moved.

import { supabase } from '../lib/supabase'

// Builds a human-readable "Field: old → new; ..." string from only the
// fields that actually changed. Returns '' if nothing did.
export function diffSummary(oldValues, newValues, fieldLabels) {
  const parts = []
  Object.entries(fieldLabels).forEach(([key, label]) => {
    const ov = oldValues?.[key] ?? null
    const nv = newValues?.[key] ?? null
    if (String(ov ?? '') !== String(nv ?? '')) {
      parts.push(`${label}: ${ov ?? '—'} → ${nv ?? '—'}`)
    }
  })
  return parts.join('; ')
}

// tableName: 'budget_targets' | 'ownership_scorecard_entries'
// period: 'YYYY-MM-01' (target_month / score_month)
export async function logEdit({ tableName, locationId, period, profile, oldValues, newValues, fieldLabels }) {
  const summary = diffSummary(oldValues, newValues, fieldLabels)
  if (!summary) return // no actual change — don't clutter the log
  await supabase.from('edit_audit_log').insert({
    table_name: tableName,
    location_id: locationId,
    period,
    changed_by: profile?.id || null,
    changed_by_name: profile?.name || profile?.email || 'Unknown',
    summary,
    old_values: oldValues || {},
    new_values: newValues || {},
  })
}

const TABLE_LABEL = {
  budget_targets: 'Budget Target',
  ownership_scorecard_entries: 'Ownership Scorecard',
}

export function auditTableLabel(tableName) {
  return TABLE_LABEL[tableName] || tableName
}
