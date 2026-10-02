// Turns a resolved downtime_logs row into the list of Jotform submission fields,
// using the field mappings an admin configured under Admin → JotForm Integration.
// Pure (no Deno/network APIs) so it can be tested outside the edge runtime.
//
// Dates and times are rendered in the STORE'S time zone — not the server's or the
// person-who-clicked's — so the same downtime always lands in Jotform the same way.

import { DEFAULT_TIMEZONE, operatingDowntimeMinutes, toZonedParts } from './operatingHours.ts'
import { getJotformSiteName } from './siteNames.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function localDateTime(iso: string, tz: string) {
  const p = toZonedParts(new Date(iso), tz)
  const ampm = p.hour >= 12 ? 'PM' : 'AM'
  const h12 = p.hour % 12 || 12
  const mm = String(p.minute).padStart(2, '0')
  return {
    date: { month: p.month, day: p.day, year: p.year },
    dateText: `${MONTHS[p.month - 1]} ${p.day}, ${p.year}`,
    time: { timeInput: `${h12}:${mm}`, ampm },
    timeText: `${h12}:${mm} ${ampm}`,
    dayKey: `${p.year}-${p.month}-${p.day}`,
  }
}

export function buildSubmissionFields(
  log: Any,
  location: Any,
  operatingHoursSettings: Any,
  mappings: Record<string, string>,
): [string, string][] {
  const tz = location?.timezone || DEFAULT_TIMEZONE
  const start = localDateTime(log.started_at, tz)
  const end   = localDateTime(log.ended_at, tz)

  const durationHrs = (operatingDowntimeMinutes(log, location, operatingHoursSettings) / 60).toFixed(2)

  const values: Record<string, string> = {
    location_name:            getJotformSiteName(location?.name),
    site_code:                '',
    site_email:               log.site_email || location?.site_email || '',
    start_date:               start.dateText,
    start_time:               start.timeText,
    end_date:                 end.dateText,
    end_time:                 end.timeText,
    duration_hours:           durationHrs,
    downtime_type:            log.downtime_type            || '',
    reason:                   log.reason                   || '',
    details:                  log.details                  || '',
    resolution_notes:         log.resolution_notes         || '',
    corrective_action_needed: log.corrective_action_needed ? 'Yes' : 'No',
    corrective_action:        log.corrective_action        || '',
    multi_day:                start.dayKey !== end.dayKey ? 'Yes' : 'No',
    scope:                    log.scope                    || '',
  }
  const dateParts: Record<string, { month: number; day: number; year: number }> = {
    start_date: start.date, end_date: end.date,
  }
  const timeParts: Record<string, { timeInput: string; ampm: string }> = {
    start_time: start.time, end_time: end.time,
  }

  // mappings = { rawQid: srcKey } where rawQid may have a # prefix and be a comma-separated
  // list of sub-fields. Jotform's submission API keys fields by their BARE numeric question
  // ID (submission[13]=value); "input_13" is just the rendered form's HTML id, so it's stripped.
  const stripId = (q: string) => q.replace(/^input_/, '')
  const fields: [string, string][] = []

  for (const [rawQid, srcKey] of Object.entries(mappings || {})) {
    if (!srcKey || values[srcKey] === undefined) continue
    const val  = String(values[srcKey])
    const qids = rawQid.split(',').map(q => q.trim().replace(/^#/, '')).filter(Boolean)
    if (!qids.length) continue

    if (qids.length === 1) {
      fields.push([`submission[${stripId(qids[0])}]`, val])
      continue
    }

    const hasMonth = qids.some(q => /^month_/.test(q))
    const hasTime  = qids.some(q => /_timeInput/.test(q))
    const isRadio  = qids.every(q => /_\d+$/.test(q))

    if (hasMonth) {
      // Date sub-fields: month_19, day_19, year_19 → submission[19][month/day/year]
      const num = (qids.find(q => /^month_/.test(q)) || '').replace('month_', '')
      const d = dateParts[srcKey]
      if (!num || !d) continue
      fields.push([`submission[${num}][month]`, String(d.month)])
      fields.push([`submission[${num}][day]`,   String(d.day)])
      fields.push([`submission[${num}][year]`,  String(d.year)])
      continue
    }

    if (hasTime) {
      // Time sub-fields: input_22_timeInput, input_22_ampm → submission[22][timeInput/ampm]
      const tq   = qids.find(q => /_timeInput/.test(q)) || ''
      const base = stripId(tq.replace('_timeInput', ''))
      const t = timeParts[srcKey]
      if (!t) continue
      fields.push([`submission[${base}][timeInput]`, t.timeInput])
      fields.push([`submission[${base}][ampm]`,      t.ampm])
      continue
    }

    if (isRadio) {
      // Radio/checkbox options: input_31_0, input_31_1 → send the value to base submission[31]
      const base = stripId(qids[0].replace(/_\d+$/, ''))
      fields.push([`submission[${base}]`, val])
      continue
    }

    // Fallback: send the value to each sub-field individually
    for (const q of qids) fields.push([`submission[${stripId(q)}]`, val])
  }

  return fields
}
