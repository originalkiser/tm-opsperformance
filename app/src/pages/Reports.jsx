import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import NavBar from '../components/NavBar'
import TmLoader from '../components/TmLoader'
import DateSelector, { fmtDateRange, loadSavedDateRange, saveDateRange } from '../components/DateSelector'
import { MarketMultiSelect, ShopMultiSelect } from '../components/FilterControls'
import NetworkDayView from '../components/NetworkDayView'
import SiteMetricTable from '../components/SiteMetricTable'
import TeamSalesTable from '../components/TeamSalesTable'
import DailyTrendsSection from '../components/DailyTrendsSection'
import DayOfWeekSection from '../components/DayOfWeekSection'
import MonthlyRollup from '../components/MonthlyRollup'
import DailySnapshot from '../components/DailySnapshot'
import DowntimeSection from '../components/DowntimeSection'
import { supabase as supabaseClient } from '../lib/supabase'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Sidebar items ─────────────────────────────────────────────────────────────

const REPORTS = [
  {
    id:    'network',
    label: 'Network Day View',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
        <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
      </svg>
    ),
    filterNeeds: { date: 'single', markets: true, shops: true },
    badge: { text: 'NETWORK', cls: 'bg-tm-blue' },
  },
  {
    id:    'sites',
    label: 'Site Performance',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"/>
      </svg>
    ),
    filterNeeds: { date: 'range', markets: true, shops: true },
    badge: { text: 'SITES', cls: 'bg-tm-blue' },
  },
  {
    id:    'team',
    label: 'Team Sales',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/>
      </svg>
    ),
    filterNeeds: { date: 'range', markets: true, shops: true },
    badge: { text: 'TEAM', cls: 'bg-[#1A3555]' },
  },
  {
    id:    'daily',
    label: 'Daily Trends',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd"/>
      </svg>
    ),
    filterNeeds: { date: 'range', markets: true, shops: true },
    badge: { text: 'DAILY', cls: 'bg-orange-600' },
  },
  {
    id:    'dow',
    label: 'Day of Week',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
      </svg>
    ),
    filterNeeds: { date: 'range', markets: true, shops: true },
    badge: { text: 'DOW', cls: 'bg-tm-teal text-tm-navy' },
  },
  {
    id:    'snapshot',
    label: 'Daily Snapshot',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
      </svg>
    ),
    filterNeeds: { date: 'single', markets: false, shops: 'single' },
    badge: { text: 'SNAP', cls: 'bg-purple-600' },
  },
  {
    id:    'monthly',
    label: 'Monthly Rollup',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zM8 7a1 1 0 011-1h2a1 1 0 011 1v7a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v10a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
      </svg>
    ),
    filterNeeds: { date: 'range', markets: false, shops: 'single' },
    badge: { text: 'MTH', cls: 'bg-indigo-600' },
  },
  {
    id:    'downtime',
    label: 'Downtime',
    icon:  (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
      </svg>
    ),
    filterNeeds: { date: 'range', markets: true, shops: true },
    badge: { text: 'DOWN', cls: 'bg-red-600' },
  },
]

// ── Snapshot data fetcher ─────────────────────────────────────────────────────

function useSnapshotRows(locationId, date) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!locationId || !date) return
    setLoading(true)
    supabaseClient
      .from('daily_logs')
      .select('*')
      .eq('location_id', locationId)
      .eq('log_date', date)
      .order('time_slot')
      .then(({ data }) => {
        setRows(data || [])
        setLoading(false)
      })
  }, [locationId, date])

  return { rows, loading }
}

// ── Single-shop selector ──────────────────────────────────────────────────────

function SingleShopSelect({ locations, value, onChange }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text hover:border-tm-teal focus:outline-none focus:ring-2 focus:ring-tm-teal transition-colors font-brand"
    >
      <option value="">Select shop…</option>
      {locations.map(l => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Reports() {
  const { locations: allLocations } = useAuth()
  const locations = useMemo(
    () => allLocations.filter(l => !l.exclude_from_reporting),
    [allLocations],
  )
  const [dark] = useDarkModeCtx()

  const [activeReport, setActiveReport]   = useState(() => localStorage.getItem('tm_reports_active') || 'sites')
  const [sidebarOpen,  setSidebarOpen]    = useState(true)
  const [logs,          setLogs]          = useState([])
  const [downtimeLogs,  setDowntimeLogs]  = useState([])
  const [loading,       setLoading]       = useState(false)

  // Shared filters
  const [selectedShops,   setSelectedShops]   = useState(null)
  const [selectedMarkets, setSelectedMarkets] = useState(() => {
    try {
      const raw = localStorage.getItem('tm_reports_market_filter')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  })
  const [dateRange, setDateRange] = useState(() => loadSavedDateRange('tm_reports_date_range'))

  // Per-report single-shop state
  const [snapshotLocId,  setSnapshotLocId]  = useState(() => locations[0]?.id || null)
  const [monthlyLocId,   setMonthlyLocId]   = useState(() => locations[0]?.id || null)
  const [trendLocIds,    setTrendLocIds]    = useState(null)

  const report = REPORTS.find(r => r.id === activeReport) || REPORTS[0]
  const markets = [...new Set(locations.map(l => l.market).filter(Boolean))].sort()

  const marketLocations = selectedMarkets === null
    ? locations
    : locations.filter(l => selectedMarkets.includes(l.market))

  const visibleLocations = selectedShops === null
    ? marketLocations
    : marketLocations.filter(l => selectedShops.includes(l.id))

  // Fetch bulk log data for reports that need a date range
  useEffect(() => {
    if (!report.filterNeeds.date || report.filterNeeds.date === 'single') return
    if (report.filterNeeds.shops === 'single') return
    if (!locations.length) return
    if (activeReport === 'downtime') fetchDowntimeLogs()
    else fetchLogs()
  }, [locations, dateRange, activeReport])

  useEffect(() => {
    setSelectedShops(null)
  }, [selectedMarkets])

  const fetchLogs = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    const PAGE = 1000
    const all = []
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabaseClient
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
    setLoading(false)
  }

  const fetchDowntimeLogs = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    const { data } = await supabaseClient
      .from('downtime_logs')
      .select('*')
      .in('location_id', locIds)
      .gte('started_at', dateRange.start + 'T00:00:00')
      .lte('started_at', dateRange.end   + 'T23:59:59')
      .order('started_at', { ascending: false })
    setDowntimeLogs(data || [])
    setLoading(false)
  }

  const handleDateRangeChange = (newRange) => {
    setDateRange(newRange)
    saveDateRange('tm_reports_date_range', newRange)
  }

  const handleReportChange = (id) => {
    setActiveReport(id)
    localStorage.setItem('tm_reports_active', id)
  }

  const filterLogs = (allLogs) => {
    const locIds = visibleLocations.map(l => l.id)
    return allLogs.filter(r => locIds.includes(r.location_id))
  }

  const trendLogs = trendLocIds === null
    ? filterLogs(logs)
    : logs.filter(r => trendLocIds.includes(r.location_id))

  // Snapshot fetch
  const snapshotDate = dateRange.end
  const { rows: snapshotRows, loading: snapshotLoading } = useSnapshotRows(snapshotLocId, snapshotDate)
  const snapshotLoc = locations.find(l => l.id === snapshotLocId)

  // Monthly rollup loc
  const monthlyLoc = locations.find(l => l.id === monthlyLocId)

  const rangeLabel = fmtDateRange(dateRange.start, dateRange.end)

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors flex flex-col">
      <NavBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`flex-shrink-0 transition-all duration-200 bg-white dark:bg-tm-dark-surface border-r border-gray-200 dark:border-tm-dark-border flex flex-col ${
            sidebarOpen ? 'w-52' : 'w-14'
          }`}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="flex items-center justify-end px-3 py-3 text-gray-400 dark:text-tm-dark-muted hover:text-tm-blue dark:hover:text-tm-teal transition-colors border-b border-gray-100 dark:border-tm-dark-border"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`}>
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
          </button>

          <nav className="flex-1 py-2 overflow-y-auto">
            {REPORTS.map(r => (
              <button
                key={r.id}
                onClick={() => handleReportChange(r.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors font-brand text-sm group ${
                  activeReport === r.id
                    ? 'bg-tm-sky/20 dark:bg-tm-teal/10 text-tm-blue dark:text-tm-teal border-r-2 border-tm-teal'
                    : 'text-gray-600 dark:text-tm-dark-muted hover:bg-gray-50 dark:hover:bg-tm-dark-card hover:text-tm-blue dark:hover:text-tm-teal'
                }`}
                title={!sidebarOpen ? r.label : undefined}
              >
                <span className="flex-shrink-0">{r.icon}</span>
                {sidebarOpen && (
                  <span className="truncate text-xs font-semibold tracking-wide">{r.label}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Sticky filter bar */}
          <div className="sticky top-0 z-20 bg-tm-cream dark:bg-tm-dark-bg border-b border-gray-200 dark:border-tm-dark-border shadow-sm">
            <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`text-white text-xs font-brand font-bold px-2.5 py-1 rounded tracking-widest ${report.badge.cls}`}>
                  {report.badge.text}
                </span>
                <h2 className="font-brand font-bold text-tm-blue dark:text-tm-teal text-base tracking-wide">
                  {report.label}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Single-shop picker (Snapshot / Monthly) */}
                {report.filterNeeds.shops === 'single' && report.id === 'snapshot' && (
                  <SingleShopSelect
                    locations={locations}
                    value={snapshotLocId}
                    onChange={v => { setSnapshotLocId(v); localStorage.setItem('tm_reports_snapshot_loc', v) }}
                  />
                )}
                {report.filterNeeds.shops === 'single' && report.id === 'monthly' && (
                  <SingleShopSelect
                    locations={locations}
                    value={monthlyLocId}
                    onChange={v => { setMonthlyLocId(v); localStorage.setItem('tm_reports_monthly_loc', v) }}
                  />
                )}
                {/* Multi-filters */}
                {report.filterNeeds.markets && markets.length > 0 && (
                  <MarketMultiSelect
                    markets={markets}
                    selected={selectedMarkets}
                    onChange={v => {
                      setSelectedMarkets(v)
                      localStorage.setItem('tm_reports_market_filter', JSON.stringify(v))
                    }}
                  />
                )}
                {report.filterNeeds.shops === true && marketLocations.length > 1 && (
                  <ShopMultiSelect locations={marketLocations} selected={selectedShops} onChange={setSelectedShops} />
                )}
                <DateSelector
                  dateRange={dateRange}
                  onChange={handleDateRangeChange}
                />
              </div>
            </div>
          </div>

          {/* Report content */}
          <div className="px-5 py-6">
            {/* Network Day View */}
            {activeReport === 'network' && (
              <NetworkDayView locations={visibleLocations} date={dateRange.end} />
            )}

            {/* Site Performance */}
            {activeReport === 'sites' && (
              loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <p className="text-xs text-gray-400 dark:text-tm-dark-muted mb-4 font-brand">{rangeLabel}</p>
                  <SiteMetricTable data={filterLogs(logs)} locations={visibleLocations} dateRange={dateRange} />
                </div>
              )
            )}

            {/* Team Sales */}
            {activeReport === 'team' && (
              loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <p className="text-xs text-gray-400 dark:text-tm-dark-muted mb-4 font-brand">{rangeLabel}</p>
                  <TeamSalesTable data={filterLogs(logs)} locations={visibleLocations} dateRange={dateRange} />
                </div>
              )
            )}

            {/* Daily Trends */}
            {activeReport === 'daily' && (
              loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <DailyTrendsSection
                    logs={trendLogs}
                    dark={dark}
                    locations={visibleLocations}
                    selected={trendLocIds}
                    onSelectedChange={setTrendLocIds}
                    dateRange={dateRange}
                  />
                </div>
              )
            )}

            {/* Day of Week */}
            {activeReport === 'dow' && (
              loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <p className="text-xs text-gray-400 dark:text-tm-dark-muted mb-4 font-brand">{rangeLabel}</p>
                  <DayOfWeekSection
                    logs={filterLogs(logs)}
                    locations={visibleLocations}
                    dark={dark}
                    dateRange={dateRange}
                  />
                </div>
              )
            )}

            {/* Daily Snapshot */}
            {activeReport === 'snapshot' && (
              snapshotLoading ? <div className="flex justify-center py-12"><TmLoader /></div> : !snapshotLocId ? (
                <p className="text-gray-400 dark:text-tm-dark-muted text-sm py-6">Select a shop above to view the snapshot.</p>
              ) : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <DailySnapshot
                    rows={snapshotRows}
                    date={snapshotDate}
                    locationName={snapshotLoc?.name}
                    opportunitiesFormula={snapshotLoc?.opportunities_formula}
                    metricThresholds={snapshotLoc?.metric_thresholds}
                  />
                </div>
              )
            )}

            {/* Monthly Rollup */}
            {activeReport === 'monthly' && (
              !monthlyLocId ? (
                <p className="text-gray-400 dark:text-tm-dark-muted text-sm py-6">Select a shop above to view the monthly rollup.</p>
              ) : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <MonthlyRollup
                    locationId={monthlyLocId}
                    dateStart={dateRange.start}
                    dateEnd={dateRange.end}
                    opportunitiesFormula={monthlyLoc?.opportunities_formula}
                    metricThresholds={monthlyLoc?.metric_thresholds}
                  />
                </div>
              )
            )}

            {/* Downtime */}
            {activeReport === 'downtime' && (
              loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
                <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
                  <p className="text-xs text-gray-400 dark:text-tm-dark-muted mb-2 font-brand">{rangeLabel}</p>
                  <DowntimeSection
                    logs={downtimeLogs.filter(r => visibleLocations.some(l => l.id === r.location_id))}
                    locations={visibleLocations}
                    dark={dark}
                    dateRange={dateRange}
                  />
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
