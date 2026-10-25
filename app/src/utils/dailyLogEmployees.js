import { employeeNameKey, readLocationEmployees } from './employeeIdentity.js'

// Collapse duplicate display names, not people or activity. Persist the selected
// roster spelling exactly; the UUID only breaks ties deterministically in the UI.
export function activeEmployeeOptions(rows, locationId) {
  const names = new Map()
  for (const row of [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const key = employeeNameKey(row.name)
    if (row.location_id === locationId && row.is_active === true && key && !names.has(key)) names.set(key, row)
  }
  return [...names.values()].sort((a, b) => employeeNameKey(a.name).localeCompare(employeeNameKey(b.name)))
}

export async function loadDailyLogEmployees(client, locationId) {
  return activeEmployeeOptions(await readLocationEmployees(client, locationId), locationId)
}

export function resolvePastedEmployee(name, previous, employees) {
  // Blank paste cells never erase a recorded name. Preserve historical spelling.
  if (!name || name === previous) return previous
  const match = employees.find(e => employeeNameKey(e.name) === employeeNameKey(name))
  if (!match) throw new Error(`“${name}” is not an active roster name. Review the Employees tab before pasting.`)
  return match.name
}

// Existing checkpoints use PATCH so an unrelated edit cannot overwrite a name
// changed in another session. New checkpoints INSERT: a unique-key conflict asks
// the user to reload instead of overwriting somebody else's checkpoint.
export async function saveDailyLogCheckpoint(client, row, payload) {
  const { employee_id: ignoredId, employee_name: ignoredName, ...fields } = payload
  // Undo may restore the exact name originally loaded for this checkpoint.
  // It cannot introduce another inactive/unmatched name.
  const previous = row._savedEmployeeName ?? ''
  const nameChanged = (row.employee_name || '') !== previous
  if (nameChanged && row.employee_name !== row._recordedEmployeeName) {
    const active = await loadDailyLogEmployees(client, fields.location_id)
    if (!active.some(e => e.name === row.employee_name)) {
      throw new Error('Employee is no longer on the active roster. Choose an active name or review the Employees tab; this checkpoint was not saved.')
    }
  }
  let request
  if (row.id) {
    request = client.from('daily_logs').update({ ...fields, ...(nameChanged ? { employee_name: row.employee_name } : {}) })
      .eq('id', row.id).eq('location_id', fields.location_id).eq('log_date', fields.log_date)
    if (nameChanged) request = previous ? request.eq('employee_name', previous) : request.or('employee_name.is.null,employee_name.eq.')
  } else {
    request = client.from('daily_logs').insert({ ...fields, employee_name: row.employee_name || null })
  }
  const { data, error } = await request.select('id, employee_name').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This checkpoint changed in another session. Reload this date before saving again.')
  return data
}
