import { readLocationEmployees } from './employeeIdentity.js'
export const rosterColumns = 'id, location_id, name, is_active'
export function filterRoster(rows, filter) {
  return rows.filter(row => filter === 'all' || (filter === 'active' ? row.is_active === true : row.is_active !== true))
}
export function validateDuplicateReview(rows, selectedIds, primaryId) {
  const ids = new Set(selectedIds)
  const selected = rows.filter(row => ids.has(row.id))
  if (ids.size < 2 || ids.size > 100 || selected.length !== ids.size || !ids.has(primaryId)
    || new Set(selected.map(row => row.location_id)).size !== 1) throw new Error('Choose 2–100 employees at one location and one retained record.')
  return selected
}
export function rosterError(error) {
  if (error?.code === '23505') return 'An active or inactive employee already has that name at this location. Review the existing roster.'
  if (error?.code === 'PGRST116') return 'This employee changed or your access changed. Reload the roster before trying again.'
  if (error?.code === '42501') return 'You no longer have permission to maintain this location. Reload your locations.'
  return error?.message || 'The roster could not be saved. Reload and try again.'
}
export async function loadRoster(client, locationId) {
  const { data, error } = await client.rpc('can_maintain_employee_roster', { loc_id: locationId })
  if (error) throw error
  if (data !== true) throw new Error('You do not have permission to maintain this location.')
  return readLocationEmployees(client, locationId)
}
export async function addRosterEmployee(client, locationId, rawName) {
  const name = rawName.trim()
  if (!name) throw new Error('Enter an employee name.')
  const { data, error } = await client.from('employees').insert({ location_id: locationId, name, is_active: true })
    .select(rosterColumns).single()
  if (error) throw error
  return data
}
export async function updateRosterEmployee(client, row, changes) {
  const patch = {}
  if (Object.hasOwn(changes, 'name')) {
    patch.name = changes.name.trim()
    if (!patch.name) throw new Error('Enter an employee name.')
  }
  if (Object.hasOwn(changes, 'is_active')) patch.is_active = changes.is_active === true
  if (!Object.keys(patch).length) throw new Error('No roster change selected.')
  let query = client.from('employees').update(patch).eq('location_id', row.location_id).eq('id', row.id).eq('name', row.name)
  query = row.is_active == null ? query.is('is_active', null) : query.eq('is_active', row.is_active)
  const { data, error } = await query.select(rosterColumns).single()
  if (error) throw error
  return data
}
export async function reviewRosterDuplicates(client, rows, selectedIds, primaryId, confirmed) {
  const selected = validateDuplicateReview(rows, selectedIds, primaryId)
  if (confirmed !== true) throw new Error('Confirm that every selected record is the same actual person.')
  const { data, error } = await client.rpc('review_employee_duplicates', {
    loc_id: selected[0].location_id, selected_ids: [...selectedIds], primary_id: primaryId, confirmed: true, reviewed_rows: selected.map(({ id, name, is_active }) => ({ id, name, is_active })),
  })
  if (error) throw error
  if (data !== selected.length) throw new Error('Unexpected review result. Reload the roster; do not retry blindly.')
  return data
}
