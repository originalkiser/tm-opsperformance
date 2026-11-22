import { isChecklistItemActive } from './checklistRules.js'

export const managementAudits = [
  { key: 'monthly_site_assessment', name: 'Monthly Site Assessment', cadence: 'monthly', path: '/management-audits/monthly-site-assessment' },
  { key: 'quarterly_safety_audit', name: 'Quarterly Safety Audit', cadence: 'quarterly', path: '/management-audits/quarterly-safety-audit' },
]

export function managementAuditUrl(href, audit) {
  const url = new URL(href)
  url.search = ''
  url.hash = audit.path
  return url.href
}

export function managementAuditScore(record) {
  if (record.status !== 'submitted' || record.working_copy_id || !managementAudits.some(audit => audit.key === record.template_key)) return null
  const { template_snapshot: snapshot, answers } = record
  if (!Array.isArray(snapshot?.definition) || !answers) return { passed: 0, failed: 0, na: 0, percentage: null }

  let passed = 0, failed = 0, na = 0
  for (const item of snapshot.definition) {
    if (item.type === 'text' || !isChecklistItemActive(item, answers)) continue
    const value = answers[item.id]?.value
    if (value === 'N/A' && (item.na_allowed || item.options?.includes(value))) na++
    else if (value === 'Passed' && item.options?.includes(value)) passed++
    else if (value === 'Failed' && item.options?.includes(value)) failed++
  }
  return { passed, failed, na, percentage: passed + failed ? (100 * passed / (passed + failed)).toFixed(1) : null }
}

export function managementAuditScoreText(record) {
  const score = managementAuditScore(record)
  if (!score) return null
  return `Audit score: ${score.percentage === null ? 'N/A' : `${score.percentage}%`} · Passed: ${score.passed} · Failed: ${score.failed} · N/A: ${score.na}`
}
