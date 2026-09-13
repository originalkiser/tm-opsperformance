import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMissingTargets } from '../hooks/useMissingTargets'

export default function TargetsBell() {
  const { missing, loading } = useMissingTargets()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (loading || !missing.length) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Sites needing budget targets"
        className="relative p-1.5 rounded-md text-tm-sky hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM8.5 16a1.5 1.5 0 003 0h-3z"/>
        </svg>
        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
          {missing.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-xl min-w-[260px] py-1">
          <div className="px-3 py-2 text-[10px] font-brand font-bold uppercase tracking-wide text-gray-400 dark:text-tm-dark-muted border-b border-gray-100 dark:border-tm-dark-border">
            Sites needing budget targets
          </div>
          {missing.map(m => (
            <button
              key={`${m.location.id}-${m.month}`}
              onClick={() => { setOpen(false); navigate('/reports') }}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors"
            >
              <span className="text-xs font-brand font-semibold text-gray-700 dark:text-tm-dark-text">{m.location.name}</span>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                {m.reason === 'current' ? 'This month' : 'Next month'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
