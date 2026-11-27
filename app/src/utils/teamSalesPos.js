import { membershipCoverage } from './posMembership.js'

const identity = (location, employee) => JSON.stringify([location, employee])

export function joinTeamSalesPos(managerRows, report, locations) {
  const sites = new Map(locations.map(site => [site.id, site]))
  const days = new Map()
  for (const day of report?.coverage ?? []) {
    if (!days.has(day.loc)) days.set(day.loc, [])
    days.get(day.loc).push(day)
  }
  const coverage = new Map(locations.map(({ id }) => {
    const siteDays = days.get(id) ?? []
    const source = membershipCoverage(siteDays)
    const status = !siteDays.some(day => day.imported) ? 'Unavailable' : source.provisional ? 'Partial' : 'Complete'
    return [id, { ...source, status }]
  }))
  const people = new Map()
  for (const person of report?.people ?? []) {
    if (sites.has(person.location_id) && person.employee_id && Number.isSafeInteger(person.credited) && person.credited > 0) {
      people.set(identity(person.location_id, person.employee_id), person)
    }
  }
  const owners = new Map()
  for (const row of managerRows) {
    for (const employee of row.employeeIds) {
      if (employee) {
        const key = identity(row.locationId, employee)
        owners.set(key, (owners.get(key) ?? 0) + 1)
      }
    }
  }
  const withPos = (row, posSales, status, person) => ({
    ...row,
    posSales,
    posStatus: status,
    posMix: person?.tiered > 0 ? (person.premium / person.tiered * 100).toFixed(1) + '%' : null,
    posUnknownTiers: person?.unknown ?? 0,
    difference: row.ms == null || posSales == null ? null : row.ms - posSales,
  })
  const joined = managerRows.map(row => {
    const [employee] = row.employeeIds
    const key = identity(row.locationId, employee)
    const source = coverage.get(row.locationId)
    if (!employee || row.employeeIds.size !== 1 || owners.get(key) !== 1) {
      return withPos(row, null, 'TM Ops identity unverified')
    }
    const person = people.get(key)
    people.delete(key)
    const status = source.status === 'Unavailable' && person ? 'Partial' : source.status
    return withPos(row, person?.credited ?? (status === 'Complete' ? 0 : null), status, person)
  })
  for (const [key, person] of people) {
    const source = coverage.get(person.location_id)
    joined.push(withPos({
      key: 'pos:' + key, name: person.name, locationId: person.location_id,
      site: sites.get(person.location_id).name, posOnly: true, ms: null, opp: null,
      rank: null, score: null, conversion: '—', p_mix: '—',
      issues: [owners.has(key) ? 'TM Ops identity unverified' : 'No verified matching TM Ops row'],
    }, person.credited, source.status === 'Unavailable' ? 'Partial' : source.status, person))
  }
  return { rows: joined, coverage }
}

export function teamSalesPosTotals(rows, coverage) {
  const known = rows.filter(row => row.posSales != null)
  return {
    value: known.length ? known.reduce((sum, row) => sum + row.posSales, 0) : null,
    partial: known.length !== rows.length || coverage.some(site => site.status !== 'Complete'),
    difference: rows.length && rows.every(row => row.difference != null)
      ? rows.reduce((sum, row) => sum + row.difference, 0) : null,
  }
}
