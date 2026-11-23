import { chronoCompare, hourlyDeltasByDay } from './logMath.js'

export const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const leaders = ['GM', 'AGM', 'TL 1', 'TL 2']
export const defaults = { prep: 60, middayStart: 660, middayEnd: 900, peak: 40, peakStep: 25 }
export const minutes = value => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null
export const clock = value => value == null ? '' : [Math.floor(value / 60), value % 60].map(n => String(n).padStart(2, '0')).join(':')
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export const sunday = date => addDays(date, -new Date(date + 'T00:00:00Z').getUTCDay())
export function siteToday(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts()
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return [values.year, values.month, values.day].join('-')
}

export function summarizeTraffic(rows, endExclusive) {
  const grouped = new Map()
  const startDate = addDays(endExclusive, -28)
  for (const row of rows) {
    if (row.log_date < startDate || row.log_date >= endExclusive || row.total_washes == null) continue
    if (!grouped.has(row.log_date)) grouped.set(row.log_date, [])
    grouped.get(row.log_date).push(row)
  }
  const traffic = {}
  for (const [date, readings] of grouped) {
    const day = new Date(date + 'T00:00:00Z').getUTCDay()
    const sorted = readings.sort(chronoCompare)
    const deltas = hourlyDeltasByDay(sorted)
    for (let index = 0; index < sorted.length;) {
      const start = index
      const slot = sorted[index].time_slot
      let total = 0
      while (sorted[index]?.time_slot === slot) total += deltas[index++].total_washes
      const hour = minutes(slot)
      // A skipped baseline would fold multiple hours into one. A first populated
      // reading after 8 AM has no reliable prior checkpoint.
      if (start ? hour - minutes(sorted[start - 1].time_slot) !== 60 : hour !== 480) continue
      if (start && Number(sorted[index - 1].total_washes) < Number(sorted[start - 1].total_washes)) continue
      const key = day + ':' + hour
      traffic[key] ??= { total: 0, samples: 0 }
      traffic[key].total += total
      traffic[key].samples++
    }
  }
  return Object.fromEntries(Object.entries(traffic).map(([key, { total, samples }]) => [key, { average: total / samples, samples }]))
}

const enoughSamples = sample => (sample?.samples ?? 0) >= 2 && Number.isFinite(sample.average)
function recommendedStaff(required, sample, settings) {
  if (!enoughSamples(sample) || sample.average < settings.peak) return required
  // Drafts saved before tiered recommendations keep their original four-person rule.
  const step = Number.isInteger(settings.peakStep) && settings.peakStep > 0 ? settings.peakStep : Infinity
  return Math.max(required, 4 + Math.floor((sample.average - settings.peak) / step))
}

function hourlyLimit(budget, gmMinutes) {
  return Math.min(budget.hourly == null ? Infinity : budget.hourly * 60,
    budget.combined == null ? Infinity : budget.combined * 60 - gmMinutes)
}

export const breakLength = shift => shift.role === 'GM' ? 0 : shift.end - shift.start > 360 ? 30 : 15
const validShift = s => Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end <= 1440 && s.end > s.start
const inside = (time, start, end) => start != null && time >= start && time < end
const adminAt = (shift, time) => shift.role === 'GM' && shift.day === 1 && inside(time, shift.adminStart, shift.adminStart + 210)
const breakAt = (shift, time) => inside(time, shift.breakStart, shift.breakStart + breakLength(shift))
const paid = s => validShift(s) ? s.end - s.start - (breakLength(s) === 30 ? 30 : 0) : 0

function windowFor(hours, day, settings) {
  const { open, close } = day === 0 ? hours.sun : hours.monSat
  const start = minutes(open), end = minutes(close)
  if (start == null || end == null || end <= start || start - settings.prep < 0 || end + 30 > 1440) return null
  return { start, end, prep: start - settings.prep, finish: end + 30 }
}

export function analyzePlan(shifts, inputs, roster) {
  const { hours, budget, traffic, settings } = inputs
  const warnings = new Set(), coverage = []
  const gm = shifts.filter(s => s.role === 'GM')
  const gmMinutes = gm.reduce((sum, s) => sum + paid(s), 0)
  const hourly = shifts.filter(s => s.role !== 'GM').reduce((sum, s) => sum + paid(s), 0)
  const combined = gmMinutes + hourly
  if (budget.method === 'percentage' && budget.combined == null) warnings.add('Missing approved full-service hours cap.')
  if (budget.method === 'hours' && (budget.hourly == null || budget.combined == null)) warnings.add('Missing weekly labor targets.')
  if (budget.hourly != null && hourly > budget.hourly * 60) warnings.add('Hourly labor exceeds the target excluding GM.')
  if (budget.combined != null && combined > budget.combined * 60) warnings.add('Combined labor exceeds the target including GM.')
  const gmDays = new Set(gm.filter(validShift).map(s => s.day))
  if (gmDays.size !== 5 || ![1, 5, 6].every(day => gmDays.has(day)) || gmMinutes < 2700 || gmMinutes > 3000) {
    warnings.add('GM must work five days, including Monday, Friday and Saturday, and schedule 45–50 hours.')
  }
  let leaderTargetMissed = false
  for (const role of leaders.slice(1)) {
    const total = shifts.filter(s => s.role === role).reduce((sum, shift) => sum + paid(shift), 0)
    if (total < 1800) leaderTargetMissed = true
    if (total < 1800 || total > 2400) warnings.add(role + ' is outside the 30–40 paid-hour target.')
  }
  if (shifts.some(s => !s.employeeId || !roster.some(e => e.id === s.employeeId))) warnings.add('Some shifts lack an active employee assignment.')
  for (let day = 0; day < 7; day++) {
    const dayShifts = shifts.filter(s => s.day === day)
    const window = windowFor(hours, day, settings)
    for (const [index, s] of dayShifts.entries()) {
      const label = days[day] + ' ' + s.role
      if (!validShift(s)) warnings.add(label + ': invalid shift times.')
      if (s.role !== 'GM' && (s.breakStart == null || s.breakStart < s.start || s.breakStart + breakLength(s) > s.end)) warnings.add(label + ': break must fit inside the shift.')
      if (s.role === 'GM' && day === 1 && (s.adminStart == null || s.adminStart < s.start || s.adminStart + 210 > s.end)) warnings.add(label + ': reserve 3.5 hours of admin time inside the shift.')
      if (dayShifts.slice(index + 1).some(other => (s.role === other.role || (s.employeeId && s.employeeId === other.employeeId)) && s.start < other.end && other.start < s.end)) {
        warnings.add(label + ': overlapping shifts for the same employee or position.')
      }
    }
    if (!window) { warnings.add(days[day] + ': invalid opening or closing hours.'); continue }
    const { start, end, prep, finish } = window
    const buckets = new Map()
    for (let time = prep; time < finish; time++) {
      const required = time < start ? 1 : time < end && inside(time, settings.middayStart, settings.middayEnd) ? 3 : 2
      const present = dayShifts.filter(s => validShift(s) && inside(time, s.start, s.end))
      const floor = present.filter(s => !adminAt(s, time) && !breakAt(s, time))
      const keys = new Set(floor.map(s => s.employeeId || s.role))
      const lead = floor.some(s => leaders.includes(s.role))
      if (time < start && keys.size && !lead) warnings.add(days[day] + ': opening preparation requires a leader.')
      const hour = Math.floor(time / 60) * 60
      const sample = time >= start && time < end ? traffic[day + ':' + hour] ?? null : null
      const recommended = recommendedStaff(required, sample, settings)
      const gap = keys.size < required || !lead
      const row = buckets.get(hour) || { day, hour, minimum: keys.size, required, recommended, gap: false, traffic: null }
      row.minimum = Math.min(row.minimum, keys.size)
      row.required = Math.max(row.required, required)
      row.recommended = Math.max(row.recommended, recommended)
      row.gap ||= gap
      row.traffic ||= sample
      buckets.set(hour, row)
      const period = days[day] + ' around ' + clock(hour)
      if (gap) {
        if (!lead) warnings.add(period + ': missing ' + (time < start ? 'opening' : time >= end ? 'closing' : 'floor') + ' leadership.')
        if (keys.size < required) warnings.add(period + ': ' + (time >= end ? 'inadequate closing coverage' : 'fewer than ' + required + ' on the floor') + '.')
        if (present.some(s => breakAt(s, time))) warnings.add(period + ': a break contributes to a staffing gap.')
      }
      if (time >= start && time < end && !enoughSamples(sample)) warnings.add('Insufficient historical traffic for some hours. Minimum staffing applies there.')
    }
    coverage.push(...buckets.values())
  }
  const available = hourlyLimit(budget, gmMinutes)
  if (available < 90 * 60 && Number.isFinite(available)) {
    warnings.add('Budget conflict: AGM and two TLs need at least 90 paid hours to meet their targets. The applicable budgets leave ' +
      Math.max(0, available / 60).toFixed(2) + ' hourly hours after accounting for GM time, before scheduling CWAs.')
  }
  if (shifts.length && coverage.some(row => row.gap)) {
    warnings.add('Mandatory coverage is incomplete. Review leadership, breaks, Monday GM admin time, and remaining labor hours before using this draft.')
    if (leaderTargetMissed) warnings.add('The draft falls short of both mandatory coverage and AGM/TL hour targets. Review the available labor hours and shift placement.')
  }
  return { gmMinutes, hourly, combined, coverage, warnings: [...warnings] }
}

export function recommendPlan(inputs, rosterSize) {
  const { hours, budget, traffic, settings } = inputs
  if (budget.combined == null || (budget.method === 'hours' && budget.hourly == null) || settings.middayStart >= settings.middayEnd) return []
  const windows = days.map((_, day) => windowFor(hours, day, settings))
  if (windows.some(window => !window)) return []
  const shifts = []
  const slots = windows.map(({ prep, start, end, finish }, day) =>
    Array.from({ length: finish - prep }, (_, index) => {
      const time = prep + index
      const required = time < start ? 1 : time < end && inside(time, settings.middayStart, settings.middayEnd) ? 3 : 2
      const sample = time >= start && time < end ? traffic[day + ':' + Math.floor(time / 60) * 60] : null
      return { time, required, recommended: recommendedStaff(required, sample, settings), count: 0, lead: 0 }
    }))
  let limit = Infinity
  let hourlyUsed = 0
  function score(shift, phase = 'mandatory') {
    let value = 0
    for (const slot of slots[shift.day]) {
      if (!inside(slot.time, shift.start, shift.end) || breakAt(shift, slot.time) || adminAt(shift, slot.time)) continue
      if (phase === 'leadership') value += !slot.lead ? 1 : 0
      else if (phase === 'traffic') value += slot.recommended > slot.required && slot.count < slot.recommended ? 1 : 0
      else {
        value += slot.count < slot.required ? 1 : 0
        value += !slot.lead && leaders.includes(shift.role) ? 4 : 0
      }
    }
    return value
  }
  function applyCoverage(shift, direction) {
    for (const slot of slots[shift.day]) {
      if (!inside(slot.time, shift.start, shift.end) || breakAt(shift, slot.time) || adminAt(shift, slot.time)) continue
      slot.count += direction
      if (leaders.includes(shift.role)) slot.lead += direction
    }
  }
  function add(shift) {
    shifts.push(shift)
    if (shift.role !== 'GM') hourlyUsed += paid(shift)
    applyCoverage(shift, 1)
  }
  const breakOptions = (role, start, end) => role === 'GM' ? [null]
    : Array.from({ length: 11 }, (_, i) => 60 + 30 * i).filter(offset => offset + breakLength({ role, start, end }) <= end - start).map(offset => start + offset)

  function best(role, choices, lengths, phase = 'mandatory', replacingPaid = 0) {
    let winner = null, bestScore = -Infinity, bestPreference = -Infinity
    for (const day of choices) {
      const { prep, finish } = windows[day]
      const gm = shifts.find(s => s.day === day && s.role === 'GM')
      for (const length of lengths) {
        if (finish - prep < length) continue
        const starts = new Set([prep, finish - length])
        for (let start = prep; start + length <= finish; start += 30) starts.add(start)
        for (const start of starts) {
          const end = start + length
          if (role !== 'GM' && hourlyUsed - replacingPaid + paid({ role, start, end }) > limit) continue
          for (const breakStart of breakOptions(role, start, end)) {
            const adminStarts = role === 'GM' && day === 1 ? [start, Math.min(end - 210, start + 180), end - 210] : [null]
            for (const adminStart of adminStarts) {
              const candidate = { day, role, start, end, breakStart, adminStart, employeeId: '' }
              const opposite = role === 'AGM' && gm && ((start + end) / 2 < (prep + finish) / 2) !== ((gm.start + gm.end) / 2 < (prep + finish) / 2)
              const value = score(candidate, phase)
              const preference = (opposite ? 1 : 0) - paid(candidate) / 1440
              if (value > bestScore || (value === bestScore && preference > bestPreference)) {
                winner = candidate; bestScore = value; bestPreference = preference
              }
            }
          }
        }
      }
    }
    return { winner, bestScore }
  }

  for (const day of [1, 5, 6]) {
    const { winner } = best('GM', [day], [540])
    if (winner) add(winner)
  }
  const optionalDays = [0, 2, 3, 4]
  for (let count = 0; count < 2; count++) {
    const { winner } = best('GM', optionalDays, [540])
    if (winner) { add(winner); optionalDays.splice(optionalDays.indexOf(winner.day), 1) }
  }
  limit = hourlyLimit(budget, shifts.reduce((sum, shift) => sum + paid(shift), 0))
  const hourlyLeaders = leaders.slice(1)
  const roleMinutes = role => shifts.filter(s => s.role === role).reduce((sum, s) => sum + paid(s), 0)
  const openDays = role => days.map((_, day) => day).filter(day => !shifts.some(s => s.day === day && s.role === role))
  const leaderLengths = [390, 330, 270, 210, 150, 90]
  // Place leaders where they close mandatory gaps. A shorter shift can fit
  // where the preferred six paid hours would exceed the available budget.
  for (let round = 0; round < 7; round++) {
    for (const role of hourlyLeaders) {
      const total = roleMinutes(role)
      if (total >= 1800) continue
      const { winner, bestScore } = best(role, openDays(role), leaderLengths)
      if (winner && bestScore > 0) add(winner)
    }
  }
  // Revisit the GM's Monday admin placement against the actual leader shifts.
  const monday = shifts.find(shift => shift.role === 'GM' && shift.day === 1)
  if (monday) {
    applyCoverage(monday, -1)
    let bestAdmin = score(monday)
    for (let adminStart = monday.start; adminStart + 210 <= monday.end; adminStart += 30) {
      const value = score({ ...monday, adminStart })
      if (value > bestAdmin) { monday.adminStart = adminStart; bestAdmin = value }
    }
    applyCoverage(monday, 1)
  }
  // Refine each hourly leader's shift against the full leadership roster.
  // Keep the same day and paid duration while closing gaps and staggering breaks.
  for (let pass = 0; pass < 2; pass++) {
    for (const shift of shifts.filter(s => s.role !== 'GM')) {
      applyCoverage(shift, -1)
      const length = shift.end - shift.start
      const { winner, bestScore } = best(shift.role, [shift.day], [length], 'mandatory', paid(shift))
      // Require a coverage improvement even when the AGM preference breaks a tie.
      if (winner && bestScore > 0 && score(winner) > score(shift)) Object.assign(shift, winner)
      applyCoverage(shift, 1)
    }
  }
  const positions = Array.from({ length: Math.max(0, rosterSize - leaders.length) }, (_, index) => 'CWA ' + (index + 1))
  const cwaLengths = [120, 180, 240, 300, 360, 420, 480]
  function fillCwa(phase) {
    for (const role of positions) {
      for (;;) {
        const { winner, bestScore } = best(role, openDays(role), cwaLengths, phase)
        if (!winner || bestScore <= 0) break
        add(winner)
      }
    }
  }
  // Keep residual leadership gaps ahead of CWA shifts and traffic peaks, even
  // if fixing them takes a leader above their preferred weekly minimum.
  for (const role of hourlyLeaders) {
    for (;;) {
      const leadMissing = slots.some(day => day.some(slot => !slot.lead))
      if (!leadMissing) break
      const lengths = leaderLengths.filter(length => roleMinutes(role) + paid({ role, start: 0, end: length }) <= 2400)
      const { winner, bestScore } = best(role, openDays(role), lengths, 'leadership')
      if (!winner || bestScore <= 0) break
      add(winner)
    }
  }
  fillCwa('mandatory')
  if (slots.every(day => day.every(slot => slot.count >= slot.required && slot.lead))) {
    // Once coverage is secure, use any remaining budget to reach leader-hour
    // targets before recommending traffic-only shifts.
    for (const role of hourlyLeaders) {
      while (roleMinutes(role) < 1800) {
        const { winner } = best(role, openDays(role), leaderLengths)
        if (!winner) break
        add(winner)
      }
    }
    fillCwa('traffic')
  }
  return shifts.sort((a, b) => a.day - b.day || a.start - b.start || a.role.localeCompare(b.role))
}
