import { employeeDeltasByDay } from './logMath.js'
import { pct, pctN } from './insightsHelpers.js'

export const EMPLOYEE_WEIGHTS = Object.freeze({ sales: 33.33, conversion: 33.33, pmix: 33.34 })
const COUNTS = ['total_washes', 'member_washes', 'basic', 'good', 'better', 'best']
const integer = v => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isSafeInteger(Number(v)) && Number(v) >= 0
const round = v => Math.round(v * 100) / 100
const sales = row => ['basic', 'good', 'better', 'best'].reduce((sum, key) => sum + Number(row[key]), 0)
// Keep the existing ending-checkpoint attribution. Missing hours/days do not
// imply missing work. A real cumulative decrease only makes earlier positive
// contributors to that counter ambiguous; never charge its entering employee.
export function inspectEmployeeDay(rows) {
  const sorted = [...rows].sort((a, b) => String(a.time_slot).localeCompare(String(b.time_slot)) || Number(a.split_index ?? 0) - Number(b.split_index ?? 0))
  const previous = Object.fromEntries(COUNTS.map(key => [key, 0]))
  const contributors = Object.fromEntries(COUNTS.map(key => [key, new Set()]))
  const uncertain = new Map(), issues = new Set()
  const mark = (name, key) => {
    if (!name) return
    if (!uncertain.has(name)) uncertain.set(name, new Set())
    uncertain.get(name).add(key)
  }
  const normalized = sorted.map(row => {
    const current = { ...row }, name = row.employee_name?.trim().toLowerCase()
    for (const key of COUNTS) {
      // An absent field is not an explicit reset to zero.
      if (row[key] == null || row[key] === '') current[key] = previous[key]
      else if (!integer(row[key])) {
        current[key] = previous[key]
        mark(name, key)
        issues.add('Invalid cumulative count; employee attribution is unknown')
      } else current[key] = Number(row[key])
      const delta = current[key] - previous[key]
      if (delta < 0) {
        contributors[key].forEach(owner => mark(owner, key))
        issues.add('Cumulative counts decreased; earlier contributor attribution is unknown')
      } else if (delta > 0) {
        if (name) contributors[key].add(name)
        else issues.add('Recorded activity has no employee name; not attributed')
      }
      previous[key] = current[key]
    }
    return current
  })
  return { reliable: uncertain.size === 0, issues: [...issues], uncertain, rows: normalized }
}

export function buildEmployeePerformance(data, locations, range) {
  const locationMap = new Map(locations.map(l => [l.id, l]))
  const days = new Map(), employees = new Map(), attributionNotes = []
  const ensure = (locationId, rawName) => {
    const name = rawName?.trim()
    if (!name) return null
    const key = `${locationId}::${name.toLowerCase()}`
    if (!employees.has(key)) employees.set(key, { key, name, locationId, site: locationMap.get(locationId).name,
      formula: locationMap.get(locationId).opportunities_formula ?? 'detailed',
      total_washes: 0, member_washes: 0, google_reviews: 0, basic: 0, good: 0, better: 0, best: 0,
      uncertain: new Set(), issues: [] })
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
    const check = inspectEmployeeDay(day)
    if (check.issues.length) attributionNotes.push({ locationId, site: locationMap.get(locationId).name, date, issues: check.issues })
    for (const [name, delta] of Object.entries(employeeDeltasByDay(check.rows))) {
      const employee = ensure(locationId, name)
      for (const key of [...COUNTS, 'google_reviews']) employee[key] += delta[key]
    }
    for (const [name, fields] of check.uncertain) {
      const employee = ensure(locationId, name)
      fields.forEach(key => employee.uncertain.add(key))
      employee.issues.push(`${date}: Correction or invalid count leaves ${[...fields].join(', ')} attribution unresolved`)
    }
  }
  const rows = [...employees.values()].map(e => {
    // Withhold only unresolved metrics, rather than displaying clipped,
    // inflated totals or guessing which prior employee owns a correction.
    const values = Object.fromEntries(COUNTS.map(key => [key, e.uncertain.has(key) ? null : e[key]]))
    const ms = ['basic', 'good', 'better', 'best'].some(key => values[key] == null) ? null : sales(values)
    const opp = values.total_washes == null || values.member_washes == null || (e.formula === 'detailed' && ms == null)
      ? null : Math.max(0, values.total_washes - values.member_washes + (e.formula === 'detailed' ? ms : 0))
    const issues = [...e.issues]
    if (!['simple', 'detailed'].includes(e.formula)) issues.push('Unknown opportunity formula')
    const rate = ms == null || opp == null ? null : opp > 0 ? ms / opp : 0
    const mix = ms == null ? null : ms > 0 ? (e.better + e.best) / ms : 0
    return { ...e, ...values, ms, opp, gr: e.google_reviews,
      pmixN: mix == null ? null : pctN(mix, 1), convN: rate == null ? null : pctN(rate, 1),
      p_mix: mix == null ? '—' : pct(mix, 1), conversion: rate == null ? '—' : pct(rate, 1),
      rate, mix, partial: e.uncertain.size > 0, issues, eligible: issues.length === 0,
      score: null, rank: null, contributions: null }
  })
  const eligible = rows.filter(r => r.eligible)
  const highestSales = Math.max(0, ...rows.filter(r => r.ms != null).map(r => r.ms))
  const highestConversion = Object.fromEntries(['simple', 'detailed'].map(formula => [formula, Math.max(0, ...rows.filter(r => r.formula === formula && r.rate != null).map(r => r.rate))]))
  for (const row of eligible) {
    row.denominators = { sales: highestSales, conversion: highestConversion[row.formula] }
    row.contributions = {
      sales: highestSales > 0 ? round(EMPLOYEE_WEIGHTS.sales * row.ms / highestSales) : 0,
      conversion: highestConversion[row.formula] > 0 ? round(EMPLOYEE_WEIGHTS.conversion * row.rate / highestConversion[row.formula]) : 0,
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
  return { rows, attributionNotes, highestSales, highestConversion }
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
