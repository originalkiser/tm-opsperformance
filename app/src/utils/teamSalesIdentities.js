import { employeeNameKey } from './employeeIdentity.js'

const add = (index, key, value) => {
  if (!index.has(key)) index.set(key, new Set())
  index.get(key).add(value)
}

export function indexTeamSalesIdentities(sites) {
  return new Map(sites.map(({ id, roster, audits }) => {
    const redirects = new Map()
    const rosterIds = new Set(roster.map(row => row.id))
    for (const run of audits) {
      if (run.location_id !== id || run.reversed_at) continue
      for (const row of run.roster_before) {
        if (row.id !== run.retained_id) add(redirects, row.id, run.retained_id)
      }
    }
    const canonical = employee => {
      const seen = new Set()
      while (redirects.has(employee)) {
        const targets = redirects.get(employee)
        if (seen.has(employee) || targets.size !== 1) return null
        seen.add(employee)
        employee = targets.values().next().value
      }
      return rosterIds.has(employee) ? employee : null
    }
    const byName = new Map(), activeByName = new Map()
    for (const row of roster) {
      const key = employeeNameKey(row.name)
      const retained = canonical(row.id)
      if (!key) continue
      add(byName, key, retained)
      if (row.is_active === true) add(activeByName, key, retained)
    }
    return [id, { canonical, byName, activeByName, names: new Map(roster.map(row => [row.id, row.name])) }]
  }))
}

export function resolveTeamSalesIdentity(row, site, credited) {
  const explicit = [...row.employeeIds].filter(Boolean).map(id => site ? site.canonical(id) : id)
  const ids = new Set(explicit)
  if (ids.has(null) || ids.size > 1) return null
  const [employee] = ids
  if (employee && !row.employeeIds.has(null)) return employee
  if (!site) return null
  const key = employeeNameKey(row.name)
  const names = site.byName.get(key)
  const active = site.activeByName.get(key)
  // Older inactive copies cannot justify a match by themselves. For a shared
  // name, require a single active roster entry with verified credit in scope.
  const [candidate] = names?.size === 1 ? names : active?.size === 1 ? active : []
  const creditedNames = [...(names ?? [])].filter(id => credited.has(id))
  const unique = names?.size === 1 || (!names?.has(null) && creditedNames.length === 1 && creditedNames[0] === candidate)
  if (!candidate || !unique || (employee && employee !== candidate)) return null
  return candidate
}


export function teamSalesEmployeeLogs(mapped, identitySites, people) {
  const sites = indexTeamSalesIdentities(identitySites)
  const credit = new Map()
  for (const person of people) {
    if (!(person.credited > 0)) continue
    const site = sites.get(person.location_id)
    const employee = site ? site.canonical(person.employee_id) : person.employee_id
    if (employee) add(credit, person.location_id, employee)
  }
  const labels = new Map(mapped.labels)
  const data = mapped.data.map(row => {
    const raw = row.employee_name?.trim()
    const explicit = row._mappingEmployeeId ?? row.employee_id ?? null
    if (!raw && !explicit) return row
    const site = sites.get(row.location_id)
    const name = mapped.labels.get(`${row.location_id}::${raw?.toLowerCase()}`) || raw
    const employee = resolveTeamSalesIdentity(
      { name, employeeIds: new Set([explicit]) }, site, credit.get(row.location_id) ?? new Set())
    if (!raw && !employee) return row
    // Use an internal namespace for both kinds of row so user-entered names
    // cannot collide with UUID keys or merge distinct verified employees.
    const token = employee ? `employee:${employee}` : `recorded:${raw.toLowerCase()}`
    const key = `${row.location_id}::${token}`
    if (!labels.has(key)) labels.set(key, site?.names.get(employee) || name || 'Employee')
    return {
      ...row, employee_name: token, _mappingOriginalName: row._mappingOriginalName ?? row.employee_name,
      _mappingEmployeeId: employee ?? row._mappingEmployeeId,
    }
  })
  return { data, labels }
}
