import { useState, useRef, useEffect } from 'react'

// ── Date utilities ────────────────────────────────────────────────────────────

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay() // 0 = Sunday
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

export function computeDateRange(preset) {
  const today    = new Date()
  const todayStr = toDateStr(today)

  if (preset === 'today') {
    return { preset, start: todayStr, end: todayStr }
  }
  if (preset === 'current_week') {
    const mon = getMonday(today)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { preset, start: toDateStr(mon), end: toDateStr(sun) }
  }
  if (preset === 'last_week') {
    const mon = getMonday(today); mon.setDate(mon.getDate() - 7)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { preset, start: toDateStr(mon), end: toDateStr(sun) }
  }
  if (preset === 'two_weeks_ago') {
    const mon = getMonday(today); mon.setDate(mon.getDate() - 14)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { preset, start: toDateStr(mon), end: toDateStr(sun) }
  }
  if (preset === 'month_to_date') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return { preset, start: toDateStr(start), end: todayStr }
  }
  if (preset === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end   = new Date(today.getFullYear(), today.getMonth(), 0)
    return { preset, start: toDateStr(start), end: toDateStr(end) }
  }
  return null
}

export function fmtDateRange(start, end) {
  if (!start || !end) return ''
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  if (start === end) return `${DAY[s.getDay()]} ${fmt(s)}`
  return `${DAY[s.getDay()]} ${fmt(s)} – ${DAY[e.getDay()]} ${fmt(e)}`
}

const ONE_HOUR = 60 * 60 * 1000

// Load a saved date range from localStorage. Falls back to 'today' if the
// saved selection is older than one hour or missing.
export function loadSavedDateRange(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key))
    if (saved?.preset && saved?.start && saved?.end) {
      const age = Date.now() - (saved.savedAt || 0)
      if (age <= ONE_HOUR) {
        // Recompute preset ranges so "current week" etc. stay current
        return saved.preset === 'custom' ? saved : computeDateRange(saved.preset)
      }
    }
  } catch {}
  return computeDateRange('today')
}

// Save a date range to localStorage with a timestamp.
export function saveDateRange(key, range) {
  localStorage.setItem(key, JSON.stringify({ ...range, savedAt: Date.now() }))
}

// ── Component ─────────────────────────────────────────────────────────────────

const PRESETS = [
  { key: 'today',         label: 'Today'          },
  { key: 'current_week',  label: 'Current Week'   },
  { key: 'last_week',     label: 'Last Week'       },
  { key: 'two_weeks_ago', label: 'Two Weeks Ago'   },
  { key: 'month_to_date', label: 'Month to Date'   },
  { key: 'last_month',    label: 'Last Month'      },
]

export default function DateSelector({ dateRange, onChange }) {
  const [open, setOpen]               = useState(false)
  const [customStart, setCustomStart] = useState(dateRange?.start || '')
  const [customEnd,   setCustomEnd]   = useState(dateRange?.end   || '')
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Keep custom inputs in sync when dateRange changes externally
  useEffect(() => {
    setCustomStart(dateRange?.start || '')
    setCustomEnd(dateRange?.end   || '')
  }, [dateRange?.start, dateRange?.end])

  const applyCustom = () => {
    if (customStart && customEnd && customStart <= customEnd) {
      onChange({ preset: 'custom', start: customStart, end: customEnd })
      setOpen(false)
    }
  }

  const currentPresetLabel =
    PRESETS.find(p => p.key === dateRange?.preset)?.label ||
    (dateRange?.preset === 'custom' ? 'Custom' : 'Select Range')

  // For 'today' preset, hide the date range suffix in the trigger (it's redundant)
  const showRangeSuffix = dateRange?.preset !== 'today' && dateRange?.start

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 dark:border-tm-dark-border bg-white dark:bg-tm-dark-card text-sm font-brand text-gray-700 dark:text-tm-dark-text hover:border-tm-teal dark:hover:border-tm-teal transition-colors whitespace-nowrap"
      >
        <span className="font-semibold">{currentPresetLabel}</span>
        {showRangeSuffix && (
          <span className="text-xs text-gray-400 dark:text-tm-dark-muted font-normal">
            {fmtDateRange(dateRange.start, dateRange.end)}
          </span>
        )}
        <span className="text-gray-400 dark:text-tm-dark-muted text-[10px] ml-1">▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-xl shadow-2xl py-1 min-w-[300px]">

          {/* Preset options */}
          {PRESETS.map(p => {
            const range  = computeDateRange(p.key)
            const active = dateRange?.preset === p.key
            return (
              <button
                key={p.key}
                onClick={() => { onChange(range); setOpen(false) }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                  active
                    ? 'bg-tm-sky/30 dark:bg-tm-teal/15'
                    : 'hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10'
                }`}
              >
                <span className={`text-sm font-brand flex items-center gap-2 ${
                  active ? 'font-semibold text-tm-blue dark:text-tm-teal' : 'font-medium text-gray-700 dark:text-tm-dark-text'
                }`}>
                  <span className="text-[9px] leading-none">{active ? '●' : '○'}</span>
                  {p.label}
                </span>
                {range && p.key !== 'today' && (
                  <span className="text-xs text-gray-400 dark:text-tm-dark-muted ml-4 whitespace-nowrap">
                    {fmtDateRange(range.start, range.end)}
                  </span>
                )}
              </button>
            )
          })}

          {/* Custom range */}
          <div className="border-t border-gray-100 dark:border-tm-dark-border mt-1 pt-2 pb-3 px-4">
            <div className={`flex items-center gap-1.5 mb-2 text-xs font-brand font-semibold ${
              dateRange?.preset === 'custom'
                ? 'text-tm-blue dark:text-tm-teal'
                : 'text-gray-500 dark:text-tm-dark-muted'
            }`}>
              <span className="text-[9px]">{dateRange?.preset === 'custom' ? '●' : '○'}</span>
              Custom Range
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal font-brand"
              />
              <span className="text-gray-400 dark:text-tm-dark-muted text-xs">–</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={e => setCustomEnd(e.target.value)}
                className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal font-brand"
              />
              <button
                onClick={applyCustom}
                disabled={!customStart || !customEnd || customStart > customEnd}
                className="px-3 py-1 text-xs bg-tm-blue text-white rounded font-brand font-semibold hover:bg-tm-navy disabled:opacity-40 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
