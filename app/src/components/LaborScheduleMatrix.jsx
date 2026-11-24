import { useEffect, useRef, useState } from 'react'
import { addDays, breakLength, clock, days, leaders, minutes, shiftPaidMinutes } from '../utils/laborPlanner'

export function scheduleRows(shifts, roster, roles) {
  const byKey = new Map()
  for (const [index, shift] of shifts.entries()) {
    const key = shift.employeeId ? 'employee:' + shift.employeeId : 'role:' + shift.role
    if (!byKey.has(key)) byKey.set(key, {
      key, employeeId: shift.employeeId || '', name: shift.employeeId
        ? roster.find(employee => employee.id === shift.employeeId)?.name || 'Inactive or unavailable' : 'Unassigned',
      positions: new Set(), entries: [], total: 0,
    })
    const row = byKey.get(key)
    row.positions.add(shift.role)
    row.entries.push({ index, shift })
    row.total += shiftPaidMinutes(shift)
  }
  for (const role of roles) {
    if (![...byKey.values()].some(row => row.positions.has(role))) {
      const key = 'role:' + role
      byKey.set(key, { key, employeeId: '', name: 'Unassigned', positions: new Set([role]), entries: [], total: 0 })
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const rank = row => Math.min(...[...row.positions].map(role => leaders.includes(role) ? leaders.indexOf(role) : leaders.length))
    return rank(a) - rank(b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key, undefined, { numeric: true })
  })
}

function ampm(value) {
  if (value == null) return '—'
  const hour = Math.floor(value / 60)
  return (hour % 12 || 12) + ':' + String(value % 60).padStart(2, '0') + (hour % 24 < 12 ? ' AM' : ' PM')
}

const hours = value => (value / 60).toFixed(2) + ' h'

export default function LaborScheduleMatrix({ shifts, roster, roles, week, combined, print = false, disabled, onEdit }) {
  const rows = scheduleRows(shifts, roster, print ? [] : roles)
  return <div className={print ? 'labor-matrix-print' : 'labor-matrix-scroll'}
    role={print ? undefined : 'region'} aria-label={print ? undefined : 'Weekly schedule, scroll to see all days'}
    tabIndex={print ? undefined : 0}>
    <table className="labor-matrix" aria-label={print ? 'Printable weekly schedule' : 'Weekly schedule'}>
      <thead><tr>
        <th scope="col">Employee / Position</th>
        {days.map((day, index) => <th scope="col" key={day}>{day}<small>{addDays(week, index)}</small></th>)}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>
        <th scope="row"><strong>{row.name}</strong><small>{[...row.positions].join(' / ')}</small>
          {!print && <small className="labor-person-total">{hours(row.total)} weekly</small>}
        </th>
        {days.map((day, index) => {
          const entries = row.entries.filter(entry => entry.shift.day === index).sort((a, b) => a.shift.start - b.shift.start)
          const content = entries.map(({ index: shiftIndex, shift }) =>
            <span className={'labor-shift' + (leaders.includes(shift.role) ? ' labor-shift-leader' : '')} key={shiftIndex}>
              {ampm(shift.start)}–{ampm(shift.end)}
            </span>)
          return <td key={day}>{print || disabled ? content :
            <button type="button" className="labor-cell-button"
              aria-label={row.name + ', ' + [...row.positions].join(' / ') + ', ' + day + ', ' + (entries.length ? 'edit shifts' : 'add shift')}
              onClick={() => onEdit(row, index, entries)}>{content}</button>}</td>
        })}
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">Weekly total<small>{hours(combined)}</small></th>
        {days.map((day, index) => <td key={day}>{hours(shifts.filter(s => s.day === index).reduce((sum, s) => sum + shiftPaidMinutes(s), 0))}</td>)}
      </tr></tfoot>
    </table>
  </div>
}

export function LaborShiftEditor({ row, day, entries, roster, roles, control, button, onClose, onApply }) {
  const dialog = useRef(null)
  const position = [...row.positions][0]
  const initialShift = () => ({ day, role: position, employeeId: row.employeeId, start: 480, end: 840,
    breakStart: position === 'GM' ? null : 720, adminStart: day === 1 && position === 'GM' ? 480 : null })
  const [draft, setDraft] = useState(() => entries.length ? entries.map(entry => entry.shift) : [initialShift()])
  useEffect(() => { dialog.current.showModal() }, [])
  const patch = (index, change) => setDraft(previous => previous.map((shift, i) => i === index ? { ...shift, ...change } : shift))
  return <dialog ref={dialog} aria-labelledby="labor-editor-title" className="labor-editor" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onApply(draft); dialog.current.close() }} className="space-y-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="labor-editor-title" className="font-brand text-lg font-bold">{days[day]} · {row.name === 'Unassigned' ? position : row.name}</h2>
        <button type="button" className={button} onClick={() => dialog.current.close()}>Cancel</button>
      </header>
      {draft.map((shift, index) => <fieldset key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-3 dark:border-tm-dark-border">
        <legend className="px-1 text-sm font-semibold">Shift {index + 1}</legend>
        <label className="col-span-2 grid gap-1 text-sm">Position
          <select className={control} value={shift.role} onChange={e => patch(index, { role: e.target.value })}>
            {roles.map(role => <option key={role}>{role}</option>)}
          </select>
        </label>
        <label className="col-span-2 grid gap-1 text-sm">Employee
          <select className={control} value={shift.employeeId || ''} onChange={e => patch(index, { employeeId: e.target.value })}>
            <option value="">Unassigned</option>
            {shift.employeeId && !roster.some(e => e.id === shift.employeeId) && <option value={shift.employeeId}>Inactive or unavailable</option>}
            {roster.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        {['start', 'end', ...(shift.role === 'GM' ? (day === 1 ? ['adminStart'] : []) : ['breakStart'])].map(key =>
          <label key={key} className="grid min-w-0 gap-1 text-sm">{({ adminStart: 'Admin starts', breakStart: 'Break starts', start: 'Start', end: 'End' })[key]}
            <input type="time" className={control + ' min-w-0'} value={key === 'end' && shift.end === 1440 ? '00:00' : clock(shift[key])}
              onChange={e => patch(index, { [key]: key === 'end' && e.target.value === '00:00' ? 1440 : minutes(e.target.value) })} />
          </label>)}
        {shift.role !== 'GM' && <p className="self-center text-xs">{breakLength(shift)} min {breakLength(shift) === 30 ? 'unpaid' : 'paid'}</p>}
        <button type="button" className={button + ' col-span-2'} onClick={() => setDraft(previous => previous.filter((_, i) => i !== index))}>Remove shift</button>
      </fieldset>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => setDraft(previous => [...previous, initialShift()])}>Add shift</button>
        <button type="submit" className={button}>Apply shifts</button>
      </div>
    </form>
  </dialog>
}
