import { useState, useEffect, useRef } from 'react'

export function MarketMultiSelect({ markets, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allSelected  = selected === null || selected.length === markets.length
  const noneSelected = selected !== null && selected.length === 0

  const label = allSelected
    ? 'All Markets'
    : noneSelected
      ? 'No Markets'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} of ${markets.length} markets`

  const toggleAll = () => { allSelected ? onChange([]) : onChange(null) }

  const toggle = (market) => {
    const current = selected === null ? [...markets] : selected
    if (current.includes(market)) {
      onChange(current.filter(m => m !== market))
    } else {
      const next = [...current, market]
      onChange(next.length === markets.length ? null : next)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text hover:border-tm-teal focus:outline-none focus:ring-2 focus:ring-tm-teal transition-colors font-brand"
      >
        <span>{label}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[200px] py-1">
          <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-tm-teal w-3.5 h-3.5" />
            <span className="text-xs font-brand font-semibold text-gray-700 dark:text-tm-dark-text">All Markets</span>
          </label>
          <div className="border-t border-gray-100 dark:border-tm-dark-border my-1" />
          {markets.map(market => (
            <label key={market} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
              <input
                type="checkbox"
                checked={allSelected || (selected !== null && selected.includes(market))}
                onChange={() => toggle(market)}
                className="accent-tm-teal w-3.5 h-3.5"
              />
              <span className="text-xs font-brand text-gray-700 dark:text-tm-dark-text">{market}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function ShopMultiSelect({ locations, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allSelected  = selected === null || selected.length === locations.length
  const noneSelected = selected !== null && selected.length === 0

  const label = allSelected
    ? 'All Sites'
    : noneSelected
      ? 'No Sites'
      : selected.length === 1
        ? locations.find(l => l.id === selected[0])?.name ?? '1 site'
        : `${selected.length} of ${locations.length} sites`

  const toggleAll = () => { allSelected ? onChange([]) : onChange(null) }

  const toggle = (id) => {
    const current = selected === null ? locations.map(l => l.id) : selected
    if (current.includes(id)) {
      onChange(current.filter(s => s !== id))
    } else {
      const next = [...current, id]
      onChange(next.length === locations.length ? null : next)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text hover:border-tm-teal focus:outline-none focus:ring-2 focus:ring-tm-teal transition-colors font-brand"
      >
        <span>{label}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[220px] py-1 max-h-64 overflow-y-auto">
          <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors sticky top-0 bg-white dark:bg-tm-dark-card border-b border-gray-100 dark:border-tm-dark-border">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-tm-teal w-3.5 h-3.5" />
            <span className="text-xs font-brand font-semibold text-gray-700 dark:text-tm-dark-text">All Sites</span>
          </label>
          {locations.map(loc => (
            <label key={loc.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
              <input
                type="checkbox"
                checked={allSelected || (selected !== null && selected.includes(loc.id))}
                onChange={() => toggle(loc.id)}
                className="accent-tm-teal w-3.5 h-3.5"
              />
              <span className="text-xs font-brand text-gray-700 dark:text-tm-dark-text truncate">{loc.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
