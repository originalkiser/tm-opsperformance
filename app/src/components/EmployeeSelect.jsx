import { useState, useRef, useEffect, useId } from 'react'

export default function EmployeeSelect({ value, onChange, employees = [], disabled = false,
  loading = false, error = '', onRefresh, label = 'Employee name', align = 'left' }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef(null)
  const id = useId()
  const options = (loading || error ? [] : employees).filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
  const close = () => { setOpen(false); setSearch(''); setHighlight(-1) }
  useEffect(() => { close() }, [value])
  useEffect(() => { setHighlight(-1) }, [employees, loading, error])
  const select = name => { onChange(name); close() }
  const historical = value && !employees.some(e => e.name === value)
  const message = error ? 'Roster unavailable. Retry before selecting a name.'
    : loading ? 'Loading active employees…' : !employees.length ? 'No active employees.' : !options.length ? 'No matching active employees.' : ''
  return (
    <div ref={wrapRef} className="relative w-full" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) close() }}>
      <input type="text" role="combobox" aria-label={label} aria-autocomplete="list"
        aria-expanded={open} aria-controls={`${id}-list`} aria-describedby={`${id}-help`}
        aria-activedescendant={open && options[highlight] ? `${id}-${highlight}` : undefined}
        className="w-full min-w-0 py-1.5 px-1 bg-transparent focus:outline-none focus:ring-2 focus:ring-tm-teal rounded text-base md:text-xs font-brand text-gray-800 dark:text-tm-dark-text placeholder:text-gray-500 dark:placeholder:text-tm-dark-muted"
        value={open ? search : value || ''} disabled={disabled} placeholder={open ? 'Search active employees…' : 'Select employee…'}
        onFocus={() => { setOpen(true); setSearch(''); onRefresh?.() }}
        onChange={e => { setSearch(e.target.value); setOpen(true); setHighlight(-1) }}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); close() }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); setOpen(true)
            setHighlight(h => e.key === 'ArrowDown' ? Math.min(h + 1, options.length - 1) : Math.max(0, h - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (open && !loading && !error && options[highlight]) select(options[highlight].name)
            else setOpen(true)
          } else if (e.key === 'Tab') close()
        }} />
      <span id={`${id}-help`} className="sr-only">Search, then select an active employee. Unselected searches do not change the recorded name. Missing a name? Use the Employees tab.</span>
      {!open && historical && !loading && !error && <span className="block text-[10px] text-gray-500 dark:text-tm-dark-muted">Recorded name retained</span>}
      {open && !disabled && <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-50 w-64 max-w-[80vw] rounded-lg border border-gray-200 dark:border-tm-dark-border bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text shadow-lg`}>
        <ul id={`${id}-list`} role="listbox" aria-label="Active employees" className="max-h-48 overflow-y-auto">
          {!loading && !error && options.map((employee, index) => <li key={employee.id} id={`${id}-${index}`} role="option" aria-selected={highlight === index}
            className={`px-3 py-3 text-xs whitespace-normal break-words cursor-pointer ${highlight === index ? 'bg-tm-sky/50 dark:bg-tm-teal/20' : 'hover:bg-tm-sky/30 dark:hover:bg-tm-teal/10'}`}
            onMouseDown={e => e.preventDefault()} onClick={() => select(employee.name)}>{employee.name}</li>)}
        </ul>
        {message && <p role="status" className="px-3 py-2 text-xs">{message}</p>}
        {error && <button type="button" className="px-3 py-2 text-xs underline" onClick={onRefresh}>Retry roster</button>}
        <a href="#/employees" className="block border-t border-gray-200 dark:border-tm-dark-border p-3 text-xs text-tm-blue dark:text-tm-teal underline">Missing a name? Manage it in Employees.</a>
      </div>}
    </div>
  )
}
