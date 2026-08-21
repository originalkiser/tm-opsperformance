import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import NavBar from '../components/NavBar'
import NetworkDayView from '../components/NetworkDayView'
import TmLoader from '../components/TmLoader'
import DateSelector, { fmtDateRange, loadSavedDateRange, saveDateRange } from '../components/DateSelector'
import { MarketMultiSelect, ShopMultiSelect } from '../components/FilterControls'
import SiteMetricTable from '../components/SiteMetricTable'
import TeamSalesTable from '../components/TeamSalesTable'
import DailyTrendsSection from '../components/DailyTrendsSection'
import DayOfWeekSection from '../components/DayOfWeekSection'
import DowntimeSection from '../components/DowntimeSection'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Layout persistence ────────────────────────────────────────────────────────

const DEFAULT_SECTIONS = [
  { id: 'network',   label: 'Network Day View' },
  { id: 'sites',     label: 'Sites Performance' },
  { id: 'team',      label: 'Team Sales' },
  { id: 'daily',     label: 'Daily Trends' },
  { id: 'dow',       label: 'Day of Week' },
  { id: 'downtime',  label: 'Downtime' },
]

function loadLayout() {
  try {
    const raw = localStorage.getItem('tm_insights_layout')
    if (raw) {
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        const savedIds = new Set(saved.map(s => s.id))
        const newSections = DEFAULT_SECTIONS
          .filter(d => !savedIds.has(d.id))
          .map(d => ({ ...d, visible: true }))
        return [...saved, ...newSections]
      }
    }
  } catch {}
  return DEFAULT_SECTIONS.map(d => ({ ...d, visible: true }))
}

function saveLayout(layout) {
  localStorage.setItem('tm_insights_layout', JSON.stringify(layout))
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
    </svg>
  )
}

// Collapsible section — persists open/closed state per id
function Section({ id, badge, badgeCls, subtitle, children, defaultOpen = true }) {
  const storageKey = `tm_section_open_${id}`
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved !== null ? saved === 'true' : defaultOpen
    } catch { return defaultOpen }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(storageKey, String(next)) } catch {}
  }

  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md dark:border dark:border-tm-dark-border overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-tm-dark-card transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest ${badgeCls}`}>{badge}</span>
          <span className="text-sm text-gray-500 dark:text-tm-dark-muted">{subtitle}</span>
        </div>
        <span className="text-gray-400 dark:text-tm-dark-muted">
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100 dark:border-tm-dark-border">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Customize panel ───────────────────────────────────────────────────────────

function CustomizePanel({ layout, onSave, onClose }) {
  const [local, setLocal] = useState(layout.map(s => ({ ...s })))

  const move = (idx, dir) => {
    const next = [...local]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setLocal(next)
  }

  const toggleVisible = (idx) => {
    const next = [...local]
    next[idx] = { ...next[idx], visible: !next[idx].visible }
    setLocal(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-tm-dark-card rounded-xl shadow-2xl border border-gray-200 dark:border-tm-dark-border w-full max-w-sm mx-4 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-brand font-bold text-tm-blue dark:text-tm-teal text-base tracking-wide">Customize Dashboard</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>

        <p className="text-xs text-gray-400 dark:text-tm-dark-muted mb-4">Drag to reorder · toggle visibility</p>

        <div className="space-y-2">
          {local.map((s, idx) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                s.visible
                  ? 'border-gray-200 dark:border-tm-dark-border bg-gray-50 dark:bg-tm-dark-surface'
                  : 'border-dashed border-gray-200 dark:border-tm-dark-border bg-white dark:bg-tm-dark-bg opacity-50'
              }`}
            >
              {/* Visibility toggle */}
              <button
                onClick={() => toggleVisible(idx)}
                className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
                  s.visible
                    ? 'bg-tm-teal/20 text-tm-teal hover:bg-tm-teal/30'
                    : 'bg-gray-100 dark:bg-tm-dark-card text-gray-300 dark:text-tm-dark-muted hover:bg-gray-200'
                }`}
                title={s.visible ? 'Hide section' : 'Show section'}
              >
                {s.visible
                  ? <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M10.5 8a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/></svg>
                  : <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 00-2.79.588l.77.771A5.944 5.944 0 018 2.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0114.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/><path d="M11.297 9.176a3.5 3.5 0 00-4.474-4.474l.823.823a2.5 2.5 0 012.829 2.829l.822.822zm-2.943 1.299l.822.822a3.5 3.5 0 01-4.474-4.474l.823.823a2.5 2.5 0 002.829 2.829z"/><path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 001.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 018 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884l-12-12 .708-.708 12 12-.708.708z"/></svg>
                }
              </button>

              <span className="flex-1 text-sm font-brand text-gray-700 dark:text-tm-dark-text truncate">{s.label}</span>

              {/* Reorder arrows */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="p-0.5 rounded text-gray-400 hover:text-tm-blue dark:hover:text-tm-teal disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  title="Move up"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M8 3.293L3.146 8.146a.5.5 0 01-.707-.707l5-5a.5.5 0 01.707 0l5 5a.5.5 0 01-.707.707L8 3.293z" clipRule="evenodd"/>
                  </svg>
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === local.length - 1}
                  className="p-0.5 rounded text-gray-400 hover:text-tm-blue dark:hover:text-tm-teal disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  title="Move down"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M8 12.707l4.854-4.853a.5.5 0 01.707.707l-5 5a.5.5 0 01-.707 0l-5-5a.5.5 0 01.707-.707L8 12.707z" clipRule="evenodd"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-brand text-gray-500 dark:text-tm-dark-muted hover:text-gray-700 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(local); onClose() }}
            className="px-4 py-1.5 text-sm font-brand font-semibold bg-tm-teal text-tm-navy rounded-lg hover:brightness-110 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Insights() {
  const { locations: allLocations } = useAuth()
  const locations = useMemo(
    () => allLocations.filter(l => !l.exclude_from_reporting),
    [allLocations],
  )
  const [dark] = useDarkModeCtx()

  const [logs, setLogs]               = useState([])
  const [downtimeLogs, setDowntimeLogs] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selectedShops, setSelectedShops]     = useState(null)
  const [trendLocIds, setTrendLocIds]         = useState(null)
  const [selectedMarkets, setSelectedMarkets] = useState(() => {
    try {
      const raw = localStorage.getItem('tm_market_filter')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  })
  const [dateRange, setDateRange] = useState(() => loadSavedDateRange('tm_insights_date_range'))
  const [layout, setLayout]       = useState(loadLayout)
  const [showCustomize, setShowCustomize] = useState(false)

  const markets = [...new Set(locations.map(l => l.market).filter(Boolean))].sort()

  const marketLocations = selectedMarkets === null
    ? locations
    : locations.filter(l => selectedMarkets.includes(l.market))

  useEffect(() => {
    if (locations.length) fetchData()
  }, [locations, dateRange])

  useEffect(() => { setSelectedShops(null) }, [selectedMarkets])

  useEffect(() => {
    if (trendLocIds === null) return
    const visibleIds = (selectedShops === null
      ? marketLocations
      : marketLocations.filter(l => selectedShops.includes(l.id))
    ).map(l => l.id)
    const pruned = trendLocIds.filter(id => visibleIds.includes(id))
    if (pruned.length !== trendLocIds.length) {
      setTrendLocIds(pruned.length ? pruned : null)
    }
  }, [selectedShops, selectedMarkets])

  const fetchData = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    const PAGE = 1000
    const all = []
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from('daily_logs')
        .select('*')
        .in('location_id', locIds)
        .gte('log_date', dateRange.start)
        .lte('log_date', dateRange.end)
        .order('id')
        .range(from, from + PAGE - 1)
      if (data?.length) all.push(...data)
      if (!data || data.length < PAGE) break
    }
    setLogs(all)

    // Fetch downtime logs for the period
    const { data: dt } = await supabase
      .from('downtime_logs')
      .select('*')
      .in('location_id', locIds)
      .gte('started_at', dateRange.start + 'T00:00:00')
      .lte('started_at', dateRange.end   + 'T23:59:59')
      .order('started_at', { ascending: false })
    setDowntimeLogs(dt || [])

    setLoading(false)
  }

  const handleDateRangeChange = (newRange) => {
    setDateRange(newRange)
    saveDateRange('tm_insights_date_range', newRange)
  }

  const handleLayoutSave = (newLayout) => {
    setLayout(newLayout)
    saveLayout(newLayout)
  }

  const visibleLocations = selectedShops === null
    ? marketLocations
    : marketLocations.filter(l => selectedShops.includes(l.id))

  const filterLogs = (allLogs) => {
    const locIds = visibleLocations.map(l => l.id)
    return allLogs.filter(r => locIds.includes(r.location_id))
  }

  const trendLogs  = trendLocIds === null
    ? filterLogs(logs)
    : logs.filter(r => trendLocIds.includes(r.location_id))

  const rangeLabel = fmtDateRange(dateRange.start, dateRange.end)

  const SECTION_CFG = {
    network: {
      badge: 'NETWORK', badgeCls: 'bg-tm-blue',
      subtitle: 'Day view across shops',
      content: (
        <div className="mt-3">
          <NetworkDayView locations={visibleLocations} date={todayStr()} />
        </div>
      ),
    },
    sites: {
      badge: 'SITES', badgeCls: 'bg-tm-blue',
      subtitle: `Site Performance — ${rangeLabel}`,
      content: (
        <div className="mt-3">
          <SiteMetricTable data={filterLogs(logs)} locations={visibleLocations} dateRange={dateRange} />
        </div>
      ),
    },
    team: {
      badge: 'TEAM', badgeCls: 'bg-[#1A3555]',
      subtitle: `Team Member Sales — ${rangeLabel}`,
      content: (
        <div className="mt-3">
          <TeamSalesTable data={filterLogs(logs)} locations={visibleLocations} dateRange={dateRange} />
        </div>
      ),
    },
    daily: {
      badge: 'DAILY', badgeCls: 'bg-orange-600',
      subtitle: `Daily Trends — ${rangeLabel}`,
      content: (
        <div className="mt-3">
          <DailyTrendsSection
            logs={trendLogs}
            dark={dark}
            locations={visibleLocations}
            selected={trendLocIds}
            onSelectedChange={setTrendLocIds}
            dateRange={dateRange}
          />
        </div>
      ),
    },
    dow: {
      badge: 'DOW', badgeCls: 'bg-tm-teal text-tm-navy',
      subtitle: `Day of Week — ${rangeLabel}`,
      content: (
        <div className="mt-3">
          <DayOfWeekSection
            logs={filterLogs(logs)}
            locations={visibleLocations}
            dark={dark}
            dateRange={dateRange}
          />
        </div>
      ),
    },
    downtime: {
      badge: 'DOWNTIME', badgeCls: 'bg-red-600',
      subtitle: `Downtime Events — ${rangeLabel}`,
      content: (
        <DowntimeSection
          logs={downtimeLogs.filter(r => visibleLocations.some(l => l.id === r.location_id))}
          locations={visibleLocations}
          dark={dark}
          dateRange={dateRange}
        />
      ),
    },
  }

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />

      <div className="sticky top-0 z-30 bg-tm-cream dark:bg-tm-dark-bg border-b border-gray-200 dark:border-tm-dark-border shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal tracking-wide">Dashboard</h1>
            <button
              onClick={() => setShowCustomize(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-brand font-semibold rounded-lg border border-gray-200 dark:border-tm-dark-border bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue hover:border-tm-teal dark:hover:text-white shadow-sm transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M9.5 13a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0-5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0-5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
              </svg>
              Customize
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {markets.length > 0 && (
              <MarketMultiSelect
                markets={markets}
                selected={selectedMarkets}
                onChange={v => {
                  setSelectedMarkets(v)
                  localStorage.setItem('tm_market_filter', JSON.stringify(v))
                }}
              />
            )}
            {marketLocations.length > 1 && (
              <ShopMultiSelect locations={marketLocations} selected={selectedShops} onChange={setSelectedShops} />
            )}
            <DateSelector dateRange={dateRange} onChange={handleDateRangeChange} />
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md p-12 flex items-center justify-center">
            <TmLoader />
          </div>
        ) : (
          <div className="space-y-4">
            {layout.filter(s => s.visible).map(s => {
              const cfg = SECTION_CFG[s.id]
              if (!cfg) return null
              return (
                <Section key={s.id} id={s.id} badge={cfg.badge} badgeCls={cfg.badgeCls} subtitle={cfg.subtitle}>
                  {cfg.content}
                </Section>
              )
            })}
          </div>
        )}
      </div>

      {showCustomize && (
        <CustomizePanel
          layout={layout}
          onSave={handleLayoutSave}
          onClose={() => setShowCustomize(false)}
        />
      )}
    </div>
  )
}
