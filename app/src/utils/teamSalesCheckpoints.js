import { chronoCompare, enteredCount, hasDailyLogCheckpoint, validCount } from './dailyLogCounts.js'

export const teamSalesCounts = ['total_washes', 'member_washes', 'basic', 'good', 'better', 'best']
const fields = [...teamSalesCounts, 'google_reviews']

export function teamSalesCheckpoints(rows) {
  return [...rows].sort(chronoCompare).filter(hasDailyLogCheckpoint)
}

export function summarizeTeamSalesDay(rows, conflictingIds) {
  const slots = new Map(), employees = new Map(), notes = new Set()
  for (const row of rows) {
    const slot = `${row.time_slot}:${row.split_index ?? 0}`
    if (!slots.has(slot)) slots.set(slot, [])
    slots.get(slot).push(row)
    const name = row.employee_name?.trim().toLowerCase()
    if (name && !employees.has(name)) employees.set(name, { values: {}, issues: [] })
  }
  for (const field of fields) {
    let previous = 0, unresolvedCheckpoint = false
    const balances = new Map()
    const issue = (name, text) => {
      const employee = employees.get(name)
      if (employee && field !== 'google_reviews') employee.issues.push({ field, text })
      if (field !== 'google_reviews') notes.add(`${field}: ${text}`)
    }
    const increase = (owner, amount) => {
      const [low, high] = balances.get(owner) ?? [0, 0]
      balances.set(owner, [low + amount, high + amount])
    }
    for (const entries of slots.values()) {
      const populated = entries.filter(row => enteredCount(row[field]))
      if (!populated.length) continue
      const valid = populated.filter(row => validCount(row[field]))
      const reading = valid[0]
      const owner = reading?.employee_name?.trim().toLowerCase() || null
      const sameValue = valid.every(row => Number(row[field]) === Number(reading[field]))
      const disputedIncrease = Number(reading?.[field]) > previous && valid.some(row =>
        (row.employee_name?.trim().toLowerCase() || null) !== owner)
      const conflicting = !sameValue || disputedIncrease || populated.some(row => conflictingIds.has(row.id))
      if (valid.length !== populated.length || conflicting) {
        const reason = conflicting ? 'Conflicting checkpoint' : 'Invalid cumulative count'
        for (const row of populated) issue(row.employee_name?.trim().toLowerCase(), `${reason} at ${row.time_slot}`)
        // If that reading could have reduced the total, prior contributions
        // for this counter are also in doubt. Other counters are independent.
        if (valid.some(row => Number(row[field]) < previous)) {
          for (const [name, [, high]] of balances) if (high) issue(name, `Correction at ${populated[0].time_slot} has conflicting values`)
        }
        unresolvedCheckpoint = true
        continue
      }
      const value = Number(reading[field])
      const change = value - previous
      if (change < 0) {
        // Removing units from the day total gives exact remaining attribution
        // if the contributor was unique (or the correction removes everything).
        // With multiple possible owners keep only bounds, never guess.
        for (const [name, [low, high]] of balances) {
          balances.set(name, [Math.max(0, low + change), Math.min(high, value)])
        }
      } else if (change > 0) {
        if (unresolvedCheckpoint) issue(owner, `Increase spans an invalid checkpoint before ${reading.time_slot}`)
        else if (!owner) issue(null, `Recorded increase has no employee name at ${reading.time_slot}`)
        increase(unresolvedCheckpoint ? null : owner, change)
      }
      previous = value
      unresolvedCheckpoint = false
    }
    for (const [name, employee] of employees) {
      const [low, high] = balances.get(name) ?? [0, 0]
      if (low !== high) issue(name, 'Cumulative counts decreased; correction cannot be assigned to one employee')
      employee.values[field] = low
    }
  }
  return { employees, notes: [...notes] }
}
