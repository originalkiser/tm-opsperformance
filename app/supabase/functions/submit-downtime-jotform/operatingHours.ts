// Server-side copy of the operating-hours math in app/src/utils/operatingHours.js
// (edge functions can't import from app/src). Keep the two in sync.
// Only the pieces needed to compute a downtime's duration are ported.

export const DEFAULT_TIMEZONE = 'America/Chicago'

const DEFAULT_STANDARD_HOURS = {
  monSat: { open: '07:00', close: '20:00' },
  sun:    { open: '08:00', close: '18:00' },
}

const DEFAULT_WINTER_HOURS = {
  monSat: { open: '08:00', close: '19:00' },
  sun:    { open: '08:00', close: '18:00' },
}

// deno-lint-ignore no-explicit-any
type Any = any

export function getEffectiveSchedule(globalSettings: Any, location: Any) {
  const active = globalSettings?.active === 'winter' ? 'winter' : 'standard'
  const override = location?.operating_hours_override
  if (override?.[active]?.monSat && override?.[active]?.sun) return override[active]
  if (globalSettings?.[active]?.monSat && globalSettings?.[active]?.sun) return globalSettings[active]
  return active === 'winter' ? DEFAULT_WINTER_HOURS : DEFAULT_STANDARD_HOURS
}

export function toZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    hour: +(parts.hour === '24' ? '0' : parts.hour), minute: +parts.minute, second: +parts.second,
  }
}

function zonedMidnightUTC(y: number, m: number, d: number, timeZone: string) {
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  for (let i = 0; i < 2; i++) {
    const p = toZonedParts(guess, timeZone)
    const guessedAsUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const targetAsUTC  = Date.UTC(y, m - 1, d, 0, 0, 0)
    guess = new Date(guess.getTime() - (guessedAsUTC - targetAsUTC))
  }
  return guess
}

function addLocalDays(y: number, m: number, d: number, n: number) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

function parseHM(hm: string) {
  const [h, m] = String(hm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function operatingMinutesBetween(startISO: string, endISO: string, timeZone: string, schedule: Any) {
  if (!startISO || !endISO) return 0
  const start = new Date(startISO)
  const end   = new Date(endISO)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0
  const tz = timeZone || DEFAULT_TIMEZONE

  let totalMs = 0
  const startLocal = toZonedParts(start, tz)
  let cursor = { y: startLocal.year, m: startLocal.month, d: startLocal.day }

  for (let guard = 0; guard < 400; guard++) {
    const dayMidnightUTC = zonedMidnightUTC(cursor.y, cursor.m, cursor.d, tz)
    if (dayMidnightUTC > end) break

    const weekdayIdx = new Date(Date.UTC(cursor.y, cursor.m - 1, cursor.d)).getUTCDay() // 0=Sun..6=Sat
    const window = weekdayIdx === 0 ? schedule.sun : schedule.monSat

    if (window?.open && window?.close) {
      const openUTC  = new Date(dayMidnightUTC.getTime() + parseHM(window.open)  * 60000)
      const closeUTC = new Date(dayMidnightUTC.getTime() + parseHM(window.close) * 60000)
      const overlapStart = start > openUTC  ? start : openUTC
      const overlapEnd   = end   < closeUTC ? end   : closeUTC
      if (overlapEnd > overlapStart) totalMs += overlapEnd.getTime() - overlapStart.getTime()
    }

    const next = addLocalDays(cursor.y, cursor.m, cursor.d, 1)
    const nextMidnightUTC = zonedMidnightUTC(next.y, next.m, next.d, tz)
    if (nextMidnightUTC > end) break
    cursor = next
  }

  return totalMs / 60000
}

export function operatingDowntimeMinutes(row: Any, location: Any, globalSettings: Any) {
  if (!row?.started_at || !row?.ended_at) return 0
  const schedule = getEffectiveSchedule(globalSettings, location)
  return operatingMinutesBetween(row.started_at, row.ended_at, location?.timezone, schedule)
}
