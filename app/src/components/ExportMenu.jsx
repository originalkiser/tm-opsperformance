import { useState, useEffect, useRef } from 'react'

export default function ExportMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-brand font-semibold rounded-lg border border-gray-200 dark:border-tm-dark-border bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue hover:border-tm-teal dark:hover:text-white shadow-sm transition-colors"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M8.5 1.5a.5.5 0 00-1 0v7.793L5.354 7.146a.5.5 0 10-.708.708l3 3a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 9.293V1.5z"/>
          <path d="M2 11.5a.5.5 0 011 0v2a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-2a.5.5 0 011 0v2A1.5 1.5 0 0112.5 15.5h-9A1.5 1.5 0 012 13.5v-2z"/>
        </svg>
        Export
        <span className="text-gray-400 dark:text-tm-dark-muted text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[170px] py-1">
          {items.map(({ label, run }) => (
            <button
              key={label}
              onClick={() => { setOpen(false); run() }}
              className="w-full px-4 py-2 text-left text-xs font-brand font-medium text-gray-700 dark:text-tm-dark-text hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
