import { employeeDeltasByDay } from './logMath.js'
import { pct, pctN } from './insightsHelpers.js'

export const EMPLOYEE_WEIGHTS = Object.freeze({ sales: 33.33, conversion: 33.33, pmix: 33.34 })
export const MIN_EMPLOYEE_OPPORTUNITIES = 100
const COUNTS = ['total_washes', 'member_washes', 'basic', 'good', 'better', 'best']
const integer = v => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isSafeInteger(Number(v)) && Number(v) >= 0
const round = v => Math.round(v * 100) / 100
const sales = row => ['basic', 'good', 'better', 'best'].reduce((sum, key) => sum + Number(row[key]), 0)
const minute = slot => /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(slot || '') ? Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5)) : null

// A cumulative decrease has no employee-level correction provenance. Exclude
// the whole site-day instead of clipping negatives, guessing a recipient, or
// redistributing sales. This selector is used ONLY by Reports > Team Sales.
export function inspectEmployeeDay(rows, formula) {
  const sorted = [...rows].sort((a, b) => String(a.time_slot).localeCompare(String(b.time_slot)) || Number(a.split_index ?? 0) - Number(b.split_index ?? 0))
  const issues = new Set(), slots = new Set()
  let previous = Object.fromEntries(COUNTS.map(key => [key, 0])), previousMinute = null
  for (const row of sorted) {
    const at = minute(row.time_slot), split = row.split_index ?? 0, slot = `${at}:${split}`
    if (at === null || !integer(split) || slots.has(slot)) issues.add('Invalid or duplicate hourly checkpoint')
    slots.add(slot)
    if (!COUNTS.every(key => integer(row[key]))) { issues.add('Missing or invalid cumulative counts'); continue }
    if (COUNTS.some(key => Number(row[key]) < Number(previous[key]))) issues.add('Cumulative counts decreased; correction attribution is unknown')
    const delta = Object.fromEntries(COUNTS.map(key => [key, Number(row[key]) - Number(previous[key])]))
    const activity = COUNTS.some(key => delta[key] !== 0)
    if (activity && !row.employee_name?.trim()) issues.add('Activity has no employee name')
    if (activity && previousMinute !== null && at - previousMinute > 60) issues.add('Missing hourly checkpoints; employee attribution is incomplete')
    const opportunities = delta.total_washes - delta.member_washes + (formula === 'detailed' ? sales(delta) : 0)
    if (delta.member_washes > delta.total_washes || (formula === 'simple' && sales(delta) > opportunities)) issues.add('Inconsistent sales or wash opportunity counts')
    previous = row
    previousMinute = at
  }
  return { reliable: issues.size === 0, issues: [...issues], rows: sorted }
}

export function buildEmployeePerformance(data, locations, range) {
  const locationMap = new Map(locations.map(l => [l.id, l]))
  const days = new Map(), employees = new Map(), siteIssues = new Map(), excludedDays = []
  const ensure = (locationId, rawName) => {
    const name = rawName?.trim()
    if (!name) return null
    const key = `${locationId}::${name.toLowerCase()}`
    if (!employees.has(key)) employees.set(key, { key, name, locationId, site: locationMap.get(locationId).name,
      formula: locationMap.get(locationId).opportunities_formula ?? 'detailed',
      total_washes: 0, member_washes: 0, google_reviews: 0, basic: 0, good: 0, better: 0, best: 0, knownDays: 0 })
    return employees.get(key)
  }
  for (const row of data) {
    if (!locationMap.has(row.location_id) || row.log_date < range.start || row.log_date > range.end) continue
    const key = `${row.location_id}:${row.log_date}`
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(row)
    ensure(row.location_id, row.employee_name)
  }
  for (const day of days.values()) {
    const locationId = day[0].location_id, date = day[0].log_date
    const formula = locationMap.get(locationId).opportunities_formula ?? 'detailed'
    const check = inspectEmployeeDay(day, formula)
    if (!['simple', 'detailed'].includes(formula)) { check.reliable = false; check.issues.push('Unknown opportunity formula') }
    if (!check.reliable) {
      const issues = check.issues.map(issue => `${date}: ${issue}`)
      siteIssues.set(locationId, [...(siteIssues.get(locationId) || []), ...issues])
      excludedDays.push({ locationId, site: locationMap.get(locationId).name, date, issues })
      continue
    }
    for (const [name, delta] of Object.entries(employeeDeltasByDay(check.rows))) {
      const employee = ensure(locationId, name)
      for (const key of [...COUNTS, 'google_reviews']) employee[key] += delta[key]
      employee.knownDays++
    }
  }
  const rows = [...employees.values()].map(e => {
    const ms = sales(e), opp = e.formula === 'simple' ? e.total_washes - e.member_washes : e.total_washes - e.member_washes + ms
    const issues = [...(siteIssues.get(e.locationId) || [])]
    if (!e.knownDays) issues.push('No reliably attributed days in this period')
    if (opp < MIN_EMPLOYEE_OPPORTUNITIES) issues.push(`Minimum ${MIN_EMPLOYEE_OPPORTUNITIES} reliably attributed opportunities required; recorded ${opp}`)
    if (ms === 0) issues.push('P-Mix unavailable without membership sales')
    return { ...e, ms: e.knownDays ? ms : null, opp: e.knownDays ? opp : null,
      gr: e.knownDays ? e.google_reviews : null,
      pmixN: ms > 0 ? pctN(e.better + e.best, ms) : null,
      convN: opp > 0 ? pctN(ms, opp) : null,
      p_mix: ms > 0 ? pct(e.better + e.best, ms) : '—', conversion: opp > 0 ? pct(ms, opp) : '—',
      rate: opp > 0 ? ms / opp : null, mix: ms > 0 ? (e.better + e.best) / ms : null,
      partial: siteIssues.has(e.locationId), issues, eligible: issues.length === 0, score: null, rank: null, contributions: null }
  })
  const eligible = rows.filter(r => r.eligible)
  const highestSales = Math.max(0, ...eligible.map(r => r.ms))
  const highestConversion = Object.fromEntries(['simple', 'detailed'].map(formula => [formula, Math.max(0, ...eligible.filter(r => r.formula === formula).map(r => r.rate))]))
  for (const row of eligible) {
    row.denominators = { sales: highestSales, conversion: highestConversion[row.formula] }
    row.contributions = {
      sales: round(EMPLOYEE_WEIGHTS.sales * row.ms / highestSales),
      conversion: round(EMPLOYEE_WEIGHTS.conversion * row.rate / highestConversion[row.formula]),
      pmix: round(EMPLOYEE_WEIGHTS.pmix * row.mix),
    }
    row.score = round(Object.values(row.contributions).reduce((sum, value) => sum + value, 0))
  }
  for (const formula of ['simple', 'detailed']) {
    let previousScore = null, rank = 0
    eligible.filter(r => r.formula === formula).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).forEach((r, i) => {
      if (r.score !== previousScore) rank = i + 1
      r.rank = rank; previousScore = r.score
    })
  }
  return { rows, excludedDays, highestSales, highestConversion }
}

export function sortEmployeeRows(rows, sort) {
  const direction = sort.dir === 'asc' ? 1 : -1
  const key = sort.col === 'conversion' ? 'rate' : sort.col === 'p_mix' ? 'mix' : sort.col
  return [...rows].sort((a, b) => {
    if (['name', 'site'].includes(key)) return direction * (a[key] || '').localeCompare(b[key] || '') || a.key.localeCompare(b.key)
    if (a[key] == null || b[key] == null) return a[key] == null ? b[key] == null ? a.key.localeCompare(b.key) : 1 : -1
    if (key === 'rank' && a.formula !== b.formula) return a.formula.localeCompare(b.formula)
    return direction * (a[key] - b[key]) || a.key.localeCompare(b.key)
  })
}
export const employeeRankLabel = row => row.rank == null ? 'Unranked' : `${row.formula === 'simple' ? 'Simple' : 'Detailed'} #${row.rank}`

// Team Sales needs a complete read before relative scores/ranks are meaningful.
// Advance by actual page size (PostgREST can cap below the requested range).
export async function fetchEmployeeLogs(client, locationIds, range) {
  if (!locationIds.length) return []
  const rows = [], seen = new Set()
  let expected = null
  for (let offset = 0;;) {
    const { data, error, count } = await client.from('daily_logs').select('*', { count: 'exact' })
      .in('location_id', locationIds).gte('log_date', range.start).lte('log_date', range.end)
      .order('id').range(offset, offset + 499)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw new Error('Team Sales read completeness could not be verified.')
    if (expected !== null && count !== expected) throw new Error('Team Sales records changed while loading. Reload before scoring.')
    expected = count
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error('Team Sales returned missing or duplicate record identities.')
      seen.add(row.id)
    }
    rows.push(...data); offset += data.length
    if (offset === expected) return rows
    if (!data.length || offset > expected) throw new Error('Team Sales returned an incomplete record set.')
  }
}
