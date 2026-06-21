import { useState, useRef, useEffect } from 'react'

export default function EmployeeSelect({
  value,
  onChange,
  onBlur,
  employees = [],
  placeholder = 'Name…',
  disabled = false,
}) {
  const [open, setOpen]           = useState(false)
  const [search, setSearch]       = useState(value || '')
  const [highlight, setHighlight] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)

  // Sync display when value changes from parent
  useEffect(() => { setSearch(value || '') }, [value])

  const filtered = employees
    .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 20)

  const exactMatch = employees.some(e => e.name.toLowerCase() === search.toLowerCase())
  const showFreeText = search.trim() && !exactMatch
  const options = [...filtered, ...(showFreeText ? [{ id: '__free__', name: search.trim() }] : [])]

  const select = (name) => {
    onChange(name)
    setSearch(name)
    setOpen(false)
    setHighlight(-1)
    onBlur?.()
  }

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
        setHighlight(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight >= 0 && options[highlight]) select(options[highlight].name)
      else if (search.trim()) select(search.trim())
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setHighlight(-1)
        onBlur?.()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onBlur])

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        className="w-full py-1.5 px-1 bg-transparent focus:outline-none focus:bg-white dark:focus:bg-tm-dark-card rounded text-xs font-brand text-gray-800 dark:text-tm-dark-text placeholder:text-gray-400 dark:placeholder:text-tm-dark-muted transition-colors disabled:cursor-default"
        value={search}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => {
          const v = e.target.value
          setSearch(v)
          onChange(v)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => { if (!disabled) setOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      {open && !disabled && options.length > 0 && (
        <div className="absolute left-0 top-full mt-0.5 z-50 w-max min-w-full bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {options.map((opt, idx) => (
            <div
              key={opt.id}
              className={`px-3 py-2 text-xs cursor-pointer font-brand transition-colors
                ${idx === highlight
                  ? 'bg-tm-sky/50 dark:bg-tm-teal/20'
                  : 'hover:bg-tm-sky/30 dark:hover:bg-tm-teal/10'}
                ${opt.id === '__free__'
                  ? 'text-tm-teal italic border-t border-gray-100 dark:border-tm-dark-border'
                  : 'text-gray-800 dark:text-tm-dark-text'}
              `}
              onMouseDown={(e) => { e.preventDefault(); select(opt.name) }}
            >
              {opt.id === '__free__' ? `Use "${opt.name}"` : opt.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
