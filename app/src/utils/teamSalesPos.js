import { indexTeamSalesIdentities, resolveTeamSalesIdentity } from './teamSalesIdentities.js'
import { membershipCoverage } from './posMembership.js'

const identity = (location, employee) => JSON.stringify([location, employee])

export function joinTeamSalesPos(managerRows, report, locations, identitySites = []) {
  const identities = indexTeamSalesIdentities(identitySites)
  const sites = new Map(locations.map(site => [site.id, site]))
  const days = new Map()
  for (const day of report?.coverage ?? []) {
    if (!days.has(day.loc)) days.set(day.loc, [])
    days.get(day.loc).push(day)
  }
  const coverage = new Map(locations.map(({ id }) => {
    const siteDays = days.get(id) ?? []
    const source = membershipCoverage(siteDays)
    const importedDays = siteDays.filter(day => day.imported)
    const dates = importedDays.map(day => day.day_date).filter(Boolean).sort()
    return [id, {
      ...source, imported: importedDays.length,
      firstImported: dates[0], lastImported: dates.at(-1),
    }]
  }))
  const people = new Map()
  const credited = new Map()
  for (const person of report?.people ?? []) {
    if (!sites.has(person.location_id) || !person.employee_id || !Number.isSafeInteger(person.credited) || person.credited <= 0) continue
    const site = identities.get(person.location_id)
    const employee = site?.canonical(person.employee_id) ?? person.employee_id
    const key = identity(person.location_id, employee)
    const current = people.get(key)
    people.set(key, current ? {
      ...current,
      credited: current.credited + person.credited,
      tiered: current.tiered + person.tiered,
      premium: current.premium + person.premium,
      unknown: current.unknown + person.unknown,
    } : person)
    if (!credited.has(person.location_id)) credited.set(person.location_id, new Set())
    credited.get(person.location_id).add(employee)
  }
  const owners = new Map(), resolved = new Map()
  for (const row of managerRows) {
    const match = resolveTeamSalesIdentity(row, identities.get(row.locationId), credited.get(row.locationId) ?? new Set())
    if (!match) continue
    const key = identity(row.locationId, match.employee)
    resolved.set(row.key, key)
    if (!owners.has(key)) owners.set(key, [])
    owners.get(key).push({ row: row.key, explicit: match.explicit })
  }
  const ownersByKey = new Map([...owners].map(([key, matches]) => {
    const explicit = matches.filter(match => match.explicit)
    return [key, matches.length === 1 ? matches[0].row : explicit.length === 1 ? explicit[0].row : null]
  }))
  const withPos = (row, posSales, issue = '', person) => ({
    ...row,
    posSales,
    posIssue: issue,
    differenceIssue: row.posOnly ? row.issues[0] : row.ms == null ? 'TM Ops sales unavailable' : '',
    posMix: person?.tiered > 0 ? (person.premium / person.tiered * 100).toFixed(1) + '%' : null,
    posUnknownTiers: person?.unknown ?? 0,
    difference: row.ms == null || posSales == null ? null : row.ms - posSales,
  })
  const joined = managerRows.map(row => {
    const key = resolved.get(row.key)
    const source = coverage.get(row.locationId)
    if (!key) return withPos(row, null, 'TM Ops identity unverified')
    const matches = owners.get(key)
    if (ownersByKey.get(key) !== row.key) {
      return withPos(row, null, ownersByKey.get(key) ? 'POS shown on another TM Ops row' : 'TM Ops identity unverified')
    }
    const person = people.get(key)
    people.delete(key)
    let issue = ''
    if (!person) {
      if (!report) issue = 'POS report unavailable'
      else if (!source.imported) issue = 'No membership import for this site and period'
      else if (source.imported < source.expected) issue = 'Missing membership import days'
      else if (source.verified < source.expected) issue = 'Source totals incomplete or differ from GSR'
      else if (source.unresolved) issue = 'Unresolved POS sales at this site'
    }
    const result = withPos(row, person?.credited ?? (issue ? null : 0), issue, person)
    return matches.length > 1
      ? { ...result, difference: null, differenceIssue: 'TM Ops sales span multiple rows' }
      : result
  })
  for (const [key, person] of people) {
    joined.push(withPos({
      key: 'pos:' + key, name: person.name, locationId: person.location_id,
      site: sites.get(person.location_id).name, posOnly: true, ms: null, opp: null,
      rank: null, score: null, conversion: '—', p_mix: '—',
      issues: [owners.has(key) ? 'TM Ops identity unverified' : 'No verified matching TM Ops row'],
    }, person.credited, '', person))
  }
  return { rows: joined, coverage }
}

export function teamSalesPosTotals(rows) {
  const known = rows.filter(row => row.posSales != null)
  return {
    value: known.length ? known.reduce((sum, row) => sum + row.posSales, 0) : null,
    difference: rows.length && rows.every(row => row.difference != null)
      ? rows.reduce((sum, row) => sum + row.difference, 0) : null,
  }
}

export function summarizeTeamSalesCoverage(coverage) {
  const sites = [...coverage.values()]
  const sum = key => sites.reduce((total, site) => total + site[key], 0)
  const starts = sites.map(site => site.firstImported).filter(Boolean).sort()
  const ends = sites.map(site => site.lastImported).filter(Boolean).sort()
  return {
    expected: sum('expected'), imported: sum('imported'), verified: sum('verified'), unresolved: sum('unresolved'),
    firstImported: starts[0], lastImported: ends.at(-1),
    provisional: sites.some(site => site.provisional || site.expected === 0),
  }
}
