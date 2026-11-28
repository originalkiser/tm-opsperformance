import { hasCount, hasDailyLogCheckpoint, positiveCount, validCount } from './dailyLogCounts.js'
import { employeeDeltasByDay } from './logMath.js'
import { summarizeTeamSalesDay, teamSalesCheckpoints, teamSalesCounts } from './teamSalesCheckpoints.js'
import { teamSalesEmployeeLogs } from './teamSalesIdentities.js'
import { mappedEmployeeLogs } from './employeeMappingAttribution.js'

const COUNTS = teamSalesCounts
const round = v => Math.round(v * 10) / 10
const sales = row => ['basic', 'good', 'better', 'best'].reduce((sum, key) => sum + Number(row[key]), 0)
// Keep the existing ending-checkpoint attribution. Missing hours/days do not
// imply missing work. A real cumulative decrease only makes earlier positive
// contributors to that counter ambiguous; never charge its entering employee.
export function inspectEmployeeDay(rows) {
  const sorted = [...rows].sort((a, b) => String(a.time_slot).localeCompare(String(b.time_slot)) || Number(a.split_index ?? 0) - Number(b.split_index ?? 0))
  const previous = Object.fromEntries(COUNTS.map(key => [key, 0]))
  const contributors = Object.fromEntries(COUNTS.map(key => [key, new Set()]))
  const uncertain = new Map(), issues = new Set()
  const missing = new Set()
  const mark = (name, key) => {
    if (!name) return
    if (!uncertain.has(name)) uncertain.set(name, new Set())
    uncertain.get(name).add(key)
  }
  const normalized = sorted.map(row => {
    const current = { ...row }, name = row.employee_name?.trim().toLowerCase()
    for (const key of COUNTS) {
      if (!hasCount(row[key]) || (validCount(row[key]) && Number(row[key]) === 0)) {
        current[key] = previous[key]
        continue
      }
      if (!validCount(row[key])) {
        current[key] = previous[key]
        mark(name, key)
        missing.add(key)
        issues.add('Invalid cumulative count; employee attribution is unknown')
        continue
      }
      current[key] = Number(row[key])
      const delta = current[key] - previous[key]
      if (missing.has(key) && delta !== 0) mark(name, key)
      missing.delete(key)
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

export function buildTeamSalesPerformance(data, locations, range, mappings, identities, people) {
  return buildEmployeePerformance(data, locations, range, mappings, { identities, people })
}

export function buildEmployeePerformance(data, locations, range, mappings = [], teamSales) {
  let mapped = mappedEmployeeLogs(data, mappings)
  if (teamSales) mapped = teamSalesEmployeeLogs(mapped, teamSales.identities ?? [], teamSales.people ?? [])
  data = mapped.data
  const locationMap = new Map(locations.map(l => [l.id, l]))
  const days = new Map(), employees = new Map(), attributionNotes = []
  const seenIds = new Map(), ambiguousIds = new Set(), conflictingSlots = new Set()
  const usedTeamSalesEmployees = new Set()
  const ensure = (locationId, rawName) => {
    const name = rawName?.trim()
    if (!name) return null
    const key = `${locationId}::${name.toLowerCase()}`
    if (!employees.has(key)) employees.set(key, { key, name: mapped.labels.get(key) || name, locationId, site: locationMap.get(locationId).name,
      formula: locationMap.get(locationId).opportunities_formula ?? 'detailed',
      total_washes: 0, member_washes: 0, google_reviews: 0, basic: 0, good: 0, better: 0, best: 0,
      uncertain: new Set(), issues: [], employeeIds: new Set() })
    return employees.get(key)
  }
  for (const row of data) {
    if (!locationMap.has(row.location_id) || row.log_date < range.start || row.log_date > range.end) continue
    if (row.id && seenIds.has(row.id)) {
      // Repeated identical read rows are not additional activity.
      const prior = seenIds.get(row.id)
      if (['location_id', 'log_date', 'time_slot', 'split_index', 'employee_name', '_mappingOriginalName', ...COUNTS, ...(teamSales ? ['google_reviews', 'reactivations'] : [])].every(k => prior[k] === row[k])) {
        ensure(row.location_id, row.employee_name)?.employeeIds.add(row._mappingEmployeeId ?? row.employee_id ?? null)
        continue
      }
      // Keep conflicting copies so both affected days are withheld below.
      ambiguousIds.add(row.id)
      if (['location_id', 'log_date', 'time_slot', 'split_index'].some(key => prior[key] !== row[key])) conflictingSlots.add(row.id)
    } else if (row.id) seenIds.set(row.id, row)
    const key = `${row.location_id}:${row.log_date}`
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(row)
    ensure(row.location_id, row.employee_name)?.employeeIds.add(row._mappingEmployeeId ?? row.employee_id ?? null)
  }
  for (const day of days.values()) {
    const locationId = day[0].location_id, date = day[0].log_date
    const washCountsPaired = !day.some(row => positiveCount(row.member_washes))
      || day.every(row => positiveCount(row.total_washes) === positiveCount(row.member_washes))
    if (teamSales) {
      const active = teamSalesCheckpoints(day)
      const summary = summarizeTeamSalesDay(active, conflictingSlots)
      if (summary.notes.length) attributionNotes.push({ locationId, site: locationMap.get(locationId).name, date, issues: summary.notes })
      for (const [name, result] of summary.employees) {
        const employee = ensure(locationId, name)
        usedTeamSalesEmployees.add(employee.key)
        for (const key of [...COUNTS, 'google_reviews']) employee[key] += result.values[key]
        for (const { field, text } of result.issues) {
          employee.uncertain.add(field)
          employee.issues.push(`${date}: ${field} — ${text}`)
        }
        if (washCountsPaired && !result.issues.some(({ field }) => ['total_washes', 'member_washes'].includes(field))
          && result.values.member_washes > result.values.total_washes) {
          employee.issues.push(`${date}: Attributed member washes exceed total washes; counts are inconsistent`)
        }
      }
      continue
    }
    const check = inspectEmployeeDay(day)
    const checkpoints = new Set()
    const enteredRows = day.filter(hasDailyLogCheckpoint)
    if (enteredRows.some(row => row.id && ambiguousIds.has(row.id)) || enteredRows.some(row => {
      const key = `${row.time_slot}:${row.split_index ?? 0}`
      if (checkpoints.has(key)) return true
      checkpoints.add(key)
      return false
    })) {
      check.issues.push('Duplicate checkpoint or conflicting record identity; employee attribution is ambiguous')
      for (const row of enteredRows) if (row.employee_name?.trim()) check.uncertain.set(row.employee_name.trim().toLowerCase(), new Set(COUNTS))
    }
    if (check.issues.length) attributionNotes.push({ locationId, site: locationMap.get(locationId).name, date, issues: check.issues })
    for (const [name, delta] of Object.entries(employeeDeltasByDay(check.rows))) {
      const employee = ensure(locationId, name)
      for (const key of [...COUNTS, 'google_reviews']) employee[key] += delta[key]
      if (washCountsPaired && delta.member_washes > delta.total_washes) employee.issues.push(`${date}: Attributed member washes exceed total washes; counts are inconsistent`)
    }
    for (const [name, fields] of check.uncertain) {
      const employee = ensure(locationId, name)
      fields.forEach(key => employee.uncertain.add(key))
      employee.issues.push(`${date}: Missing, correction, or invalid count leaves ${[...fields].join(', ')} attribution unresolved`)
    }
  }
  const rows = [...employees.values()].filter(e => !teamSales || usedTeamSalesEmployees.has(e.key)).map(e => {
    // Withhold only unresolved metrics, rather than displaying clipped,
    // inflated totals or guessing which prior employee owns a correction.
    const values = Object.fromEntries(COUNTS.map(key => [key, e.uncertain.has(key) ? null : e[key]]))
    const ms = ['basic', 'good', 'better', 'best'].some(key => values[key] == null) ? null : sales(values)
    const validFormula = ['simple', 'detailed'].includes(e.formula)
    const opp = !validFormula || values.total_washes == null || values.member_washes == null || (e.formula === 'detailed' && ms == null)
      ? null : values.total_washes - values.member_washes + (e.formula === 'detailed' ? ms : 0)
    const issues = [...e.issues]
    if (!validFormula) issues.push('Unknown opportunity formula')
    const rate = ms == null || opp == null || opp <= 0 ? null : ms / opp
    if (opp != null && opp <= 0) issues.push('Opportunities must be positive; conversion is undefined')
    if ([...Object.values(values), ms, opp].some(v => v != null && !Number.isSafeInteger(v))) issues.push('Invalid accumulated count')
    const mix = ms == null ? null : ms > 0 ? (e.better + e.best) / ms : 0
    return { ...e, ...values, ms, opp, gr: e.google_reviews,
      pmixN: mix == null ? null : round(mix * 100), convN: rate == null ? null : round(rate * 100),
      p_mix: mix == null ? '—' : `${round(mix * 100).toFixed(1)}%`, conversion: rate == null ? '—' : `${round(rate * 100).toFixed(1)}%`,
      rate, mix, partial: e.uncertain.size > 0, issues, eligible: issues.length === 0,
      score: null, rank: null, contributions: null }
  })
  for (const row of rows) {
    row.contributions = { sales: row.ms, conversion: row.convN, pmix: row.pmixN }
    row.qualified = row.eligible && Object.values(row.contributions).every(v => Number.isFinite(v))
    row.score = row.qualified ? round(row.ms + row.convN + row.pmixN) : null
  }
  let previousScore = null, rank = 0
  rows.filter(r => r.qualified && r.score != null).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).forEach((r, i) => {
    if (r.score !== previousScore) rank = i + 1
    r.rank = rank; previousScore = r.score
  })
  return { rows, attributionNotes, population: rows.length }
}

export function sortEmployeeRows(rows, sort) {
  const direction = sort.dir === 'asc' ? 1 : -1
  const key = sort.col === 'conversion' ? 'rate' : sort.col === 'p_mix' ? 'mix' : sort.col
  return [...rows].sort((a, b) => {
    if (['name', 'site'].includes(key)) return direction * (a[key] || '').localeCompare(b[key] || '') || a.key.localeCompare(b.key)
    if (a[key] == null || b[key] == null) return a[key] == null ? b[key] == null ? a.key.localeCompare(b.key) : 1 : -1
    return direction * (a[key] - b[key]) || a.key.localeCompare(b.key)
  })
}
export const employeeRankLabel = row => row.rank == null ? 'Unranked · Incomplete or invalid data' : String(row.rank)

// Team Sales needs a complete read before qualification and ranks are meaningful.
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
