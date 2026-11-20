import { checklistTimestamp } from './checklistRules.js'

export const printableChecklistKeys = ['opening', 'midday', 'closing', 'weekly', 'weekly_pm', 'monthly_site_assessment', 'quarterly_safety_audit']

// The read API overlays a saved correction. Only its archived base revision is
// official until that correction is submitted; never print the form's state.
export async function loadOfficialChecklist(transport, id, signal) {
  const result = await transport.load(id, signal)
  let row = result.row, evidence = result.evidence
  if (row.id !== id || row.status !== 'submitted' || row.preview_only || !printableChecklistKeys.includes(row.template_key)) throw new Error('Only a completed, authorized checklist can be printed.')
  if (transport.guest && ['monthly_site_assessment', 'quarterly_safety_audit'].includes(row.template_key)) throw new Error('Management audits require authenticated access.')
  if (row.working_copy_id) {
    const history = await transport.history(row)
    const version = history.versions?.find(v => v.revision === row.base_revision)
    if (!version?.template_snapshot || !version.answers || !Array.isArray(version.evidence)) throw new Error('The official submitted revision could not be confirmed. Refresh before printing.')
    row = { ...row, answers: version.answers, manager_name: version.manager_name, template_snapshot: version.template_snapshot, revision: version.revision, updated_at: version.recorded_at, working_copy_id: null }
    evidence = version.evidence
  }
  if (!Array.isArray(row.template_snapshot?.definition) || !row.submitted_at || !Array.isArray(evidence)) throw new Error('The completed checklist is incomplete. Refresh before printing.')
  return { row, evidence }
}
export function officialChecklistFingerprint({ row, evidence }) {
  return JSON.stringify([row.id, row.revision, row.answers, row.manager_name, row.template_snapshot, row.submitted_at, evidence.map(f => f.id).sort()])
}
export function checklistPrintPeriod(row) {
  const start = row.period_date, date = new Date(`${start}T12:00:00Z`)
  const cadence = row.template_snapshot.cadence
  if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() + 6)
  else if (cadence === 'monthly' || cadence === 'quarterly') { date.setUTCMonth(date.getUTCMonth() + (cadence === 'monthly' ? 1 : 3)); date.setUTCDate(date.getUTCDate() - 1) }
  return cadence === 'daily' ? start : `${start} – ${date.toISOString().slice(0, 10)}`
}
export function printTimestamp(value, timezone) {
  return value ? checklistTimestamp(value, timezone || 'UTC') : 'Not recorded'
}
