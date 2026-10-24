// A roster name is scoped to one location. This is a duplicate-creation guard,
// not proof that two existing records belong to the same person.
export const employeeNameKey = name => typeof name === 'string' ? name.trim().toLowerCase() : ''
const pendingByClient = new WeakMap()

export async function readLocationEmployees(client, locationId) {
  const rows = [], seen = new Set()
  let expected = null
  for (let offset = 0;;) {
    const { data, error, count } = await client.from('employees')
      .select('id, location_id, name, is_active', { count: 'exact' })
      .eq('location_id', locationId).order('id').range(offset, offset + 499)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || (expected !== null && expected !== count)) {
      throw new Error('Employee list could not be verified. Reload before adding an employee.')
    }
    expected = count
    for (const row of data) {
      if (!row.id || seen.has(row.id) || row.location_id !== locationId) throw new Error('Employee list is incomplete or ambiguous. Reload before adding an employee.')
      seen.add(row.id)
    }
    rows.push(...data); offset += data.length
    if (offset === expected) return rows
    if (!data.length || offset > expected) throw new Error('Employee list is incomplete. Reload before adding an employee.')
  }
}

export function createEmployeeIfMissing(client, locationId, rawName) {
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (!locationId || !name) return Promise.reject(new Error('Choose a location and enter an employee name.'))
  let pending = pendingByClient.get(client)
  if (!pending) { pending = new Map(); pendingByClient.set(client, pending) }
  const key = JSON.stringify([locationId, employeeNameKey(name)])
  if (pending.has(key)) return pending.get(key)
  const operation = (async () => {
    // Include inactive records. Never reactivate or consolidate by name alone.
    const roster = await readLocationEmployees(client, locationId)
    const matches = roster.filter(e => employeeNameKey(e.name) === employeeNameKey(name))
    if (matches.length) return { created: false, matches }
    const { error } = await client.from('employees').insert({ location_id: locationId, name, is_active: true })
    if (error) throw error
    return { created: true, matches: [] }
  })().finally(() => pending.delete(key))
  pending.set(key, operation)
  return operation
}

export function duplicateEmployeeGroups(employees) {
  const groups = new Map()
  for (const employee of employees) {
    const normalized = employeeNameKey(employee.name)
    if (!normalized) continue
    const key = JSON.stringify([employee.location_id, normalized])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(employee)
  }
  return [...groups.values()].filter(group => group.length > 1)
}
