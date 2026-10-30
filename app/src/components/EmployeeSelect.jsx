import { useId } from 'react'

export default function EmployeeSelect({ value, onChange, employees = [], disabled = false,
  loading = false, error = '', onRefresh, label = 'Employee name' }) {
  const id = useId()
  const options = loading || error ? [] : employees.filter(e => e.is_active === true)
  const historical = value && !options.some(e => e.name === value)
  const message = error ? 'Roster unavailable. Retry before selecting a name.'
    : loading ? 'Loading active employees…' : !options.length ? 'No active employees.' : ''
  return (
    <div className="w-full">
      <select aria-label={label} aria-describedby={`${id}-help`}
        className="w-full min-w-0 py-1.5 px-1 bg-white dark:bg-tm-dark-card focus:outline-none focus:ring-2 focus:ring-tm-teal rounded text-base md:text-xs font-brand text-gray-800 dark:text-tm-dark-text disabled:cursor-default"
        value={value || ''} disabled={disabled || loading || !!error}
        onChange={e => {
          // Blank, stale, or synthetic changes must never become recorded names.
          const employee = options.find(option => option.name === e.target.value)
          if (!disabled && employee) onChange(employee.name)
        }}>
        <option value="" disabled>Select employee…</option>
        {historical && <option value={value} disabled>{value} (recorded name)</option>}
        {options.map(employee => <option key={employee.id} value={employee.name}>{employee.name}</option>)}
      </select>
      <span id={`${id}-help`} className="sr-only">Select an active employee. Missing a name? Use the Employees tab.</span>
      {historical && !loading && !error && <span className="block text-[10px] text-gray-500 dark:text-tm-dark-muted">Recorded name retained</span>}
      {message && <p role="status" className="text-xs text-gray-500 dark:text-tm-dark-muted">{message}</p>}
      {onRefresh && <button type="button" disabled={loading || disabled} className="text-xs text-tm-blue dark:text-tm-teal underline" onClick={onRefresh}>{error ? 'Retry roster' : 'Refresh roster'}</button>}
      <a href="#/employees" className="block text-xs text-tm-blue dark:text-tm-teal underline">Missing a name? Manage it in Employees.</a>
    </div>
  )
}
