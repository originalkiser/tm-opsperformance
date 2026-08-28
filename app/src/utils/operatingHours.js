// Operating-hours-aware downtime duration math.
//
// Downtime start/end timestamps are absolute UTC instants (correct everywhere).
// To know how much of a downtime event fell inside "open hours," we have to convert
// those instants into the STORE'S OWN local wall-clock time (via its IANA time zone),
// not the viewer's browser time zone — a manager in a different zone must get the same
// answer as the store manager looking at the same event.

export const DEFAULT_STANDARD_HOURS = {
  monSat: { open: '07:00', close: '20:00' },
  sun:    { open: '08:00', close: '18:00' },
}

export const DEFAULT_WINTER_HOURS = {
  monSat: { open: '08:00', close: '19:00' },
  sun:    { open: '08:00', close: '18:00' },
}

export const DEFAULT_TIMEZONE = 'America/Chicago'

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York',    label: 'Eastern' },
  { value: 'America/Chicago',     label: 'Central' },
  { value: 'America/Denver',      label: 'Mountain' },
  { value: 'America/Phoenix',     label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
]

// Resolve the schedule (monSat/sun open+close) that currently applies to a location:
// per-location override (if set) wins over the network default; falls back to hardcoded
// defaults if global settings haven't been configured yet.
export function getEffectiveSchedule(globalSettings, location) {
  const active = globalSettings?.active === 'winter' ? 'winter' : 'standard'
  const override = location?.operating_hours_override
  if (override?.[active]?.monSat && override?.[active]?.sun) return override[active]
  if (globalSettings?.[active]?.monSat && globalSettings?.[active]?.sun) return globalSettings[active]
  return active === 'winter' ? DEFAULT_WINTER_HOURS : DEFAULT_STANDARD_HOURS
}

function toZonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +(parts.hour === '24' ? '0' : parts.hour), minute: +parts.minute, second: +parts.second }
}

// Find the UTC instant corresponding to local midnight of y-m-d in the given time zone.
function zonedMidnightUTC(y, m, d, timeZone) {
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  for (let i = 0; i < 2; i++) {
    const p = toZonedParts(guess, timeZone)
    const guessedAsUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const targetAsUTC  = Date.UTC(y, m - 1, d, 0, 0, 0)
    guess = new Date(guess.getTime() - (guessedAsUTC - targetAsUTC))
  }
  return guess
}

function addLocalDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

function parseHM(hm) {
  const [h, m] = String(hm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// Total minutes of [startISO, endISO] that fall inside operating hours, in the location's
// own local time zone, honoring different Mon-Sat vs Sunday windows.
export function operatingMinutesBetween(startISO, endISO, timeZone, schedule) {
  if (!startISO || !endISO) return 0
  const start = new Date(startISO)
  const end   = new Date(endISO)
  if (isNaN(start) || isNaN(end) || end <= start) return 0
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
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart
    }

    const next = addLocalDays(cursor.y, cursor.m, cursor.d, 1)
    const nextMidnightUTC = zonedMidnightUTC(next.y, next.m, next.d, tz)
    if (nextMidnightUTC > end) break
    cursor = next
  }

  return totalMs / 60000
}

// Convenience wrapper: given a downtime_logs-shaped row and its location, return
// operating-hours-only duration in minutes (0 if not yet resolved / invalid).
export function operatingDowntimeMinutes(row, location, globalSettings) {
  if (!row?.started_at || !row?.ended_at) return 0
  const schedule = getEffectiveSchedule(globalSettings, location)
  return operatingMinutesBetween(row.started_at, row.ended_at, location?.timezone, schedule)
}
