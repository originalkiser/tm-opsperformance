import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'
import DateSelector from '../components/DateSelector'
import LocationSelector from '../components/LocationSelector'
import DailyLogTable from '../components/DailyLogTable'
import EmployeeSummary from '../components/EmployeeSummary'
import MonthlyRollup from '../components/MonthlyRollup'
import DailySnapshot from '../components/DailySnapshot'
import { shopTotals } from '../utils/logMath'

const formatTimeSlot = (ts) => {
  if (!ts) return null
  const h = parseInt(ts.split(':')[0])
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${h12}:00 ${ampm}`
}

export default function Dashboard() {
  const { profile, locations } = useAuth()
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  const [selectedDate, setSelectedDate]             = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
  const [activeTab, setActiveTab]                   = useState('daily')
  const [liveRows, setLiveRows]                     = useState([])
  const [selectedMarket, setSelectedMarket]         = useState(
    () => localStorage.getItem('tm_market_filter') || ''
  )

  // Unique markets from all locations (only shown when markets are configured)
  const markets = [...new Set(locations.map(l => l.market).filter(Boolean))].sort()

  // Locations filtered by selected market
  const filteredLocations = selectedMarket
    ? locations.filter(l => l.market === selectedMarket)
    : locations

  useEffect(() => {
    if (filteredLocations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(filteredLocations[0].id)
    }
  }, [filteredLocations])

  // When market changes, clear location if it's no longer in scope
  useEffect(() => {
    if (selectedLocationId && !filteredLocations.find(l => l.id === selectedLocationId)) {
      setSelectedLocationId(null)
    }
  }, [selectedMarket])

  const location    = locations.find(l => l.id === selectedLocationId)
  const latestHour  = formatTimeSlot(shopTotals(liveRows)?.time_slot ?? null)
  const canEdit  =
    profile?.role === 'admin' ||
    profile?.role === 'area_manager' ||
    profile?.location_id === selectedLocationId

  const opportunitiesFormula = location?.opportunities_formula ?? 'detailed'
  const isManager = ['admin', 'area_manager'].includes(profile?.role)

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />

      <div className="max-w-screen-2xl mx-auto px-4 py-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center mb-4">
          {/* Market filter — only for managers when markets are configured */}
          {isManager && markets.length > 0 && (
            <select
              value={selectedMarket}
              onChange={e => {
                setSelectedMarket(e.target.value)
                localStorage.setItem('tm_market_filter', e.target.value)
              }}
              className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand"
            >
              <option value="">All Markets</option>
              {markets.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}

          {filteredLocations.length > 1 && (
            <LocationSelector
              locations={filteredLocations}
              value={selectedLocationId}
              onChange={setSelectedLocationId}
            />
          )}
          <DateSelector value={selectedDate} onChange={setSelectedDate} />
        </div>

        {!selectedLocationId ? (
          <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow p-16 text-center text-gray-400 dark:text-tm-dark-muted border border-transparent dark:border-tm-dark-border">
            <p className="text-lg font-medium font-brand">Select a location to begin</p>
            <p className="text-sm mt-1">Use the dropdown above to choose your site</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md overflow-hidden dark:border dark:border-tm-dark-border">
            {/* Location header */}
            <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-brand font-bold text-sm tracking-wide">
                  {location?.name}
                  {latestHour && (
                    <span className="ml-1.5 font-normal text-tm-teal/80 text-xs">({latestHour})</span>
                  )}
                </span>
                {location?.market && (
                  <span className="text-xs bg-tm-blue/60 text-tm-sky px-2 py-0.5 rounded font-brand tracking-wide">
                    {location.market}
                  </span>
                )}
                {!canEdit && (
                  <span className="text-xs bg-tm-blue/70 text-tm-sky px-2 py-0.5 rounded font-brand tracking-wide">
                    View Only
                  </span>
                )}
              </div>
              <span className="text-tm-teal text-xs font-brand">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              </span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-tm-dark-border bg-gray-50 dark:bg-tm-dark-bg">
              {[
                { key: 'daily',    label: 'Daily Log'      },
                { key: 'snapshot', label: 'Snapshot'       },
                { key: 'monthly',  label: 'Monthly Rollup' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-6 py-3 text-sm font-brand font-semibold transition-colors border-b-2 ${
                    activeTab === key
                      ? 'border-tm-blue dark:border-tm-teal text-tm-blue dark:text-tm-teal bg-white dark:bg-tm-dark-surface'
                      : 'border-transparent text-gray-500 dark:text-tm-dark-muted hover:text-gray-700 dark:hover:text-tm-dark-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content — CSS show/hide keeps DailyLogTable mounted */}
            <div className="p-4">
              <div className={activeTab === 'daily' ? 'block' : 'hidden'}>
                <DailyLogTable
                  locationId={selectedLocationId}
                  locationName={location?.name}
                  selectedDate={selectedDate}
                  canEdit={canEdit}
                  opportunitiesFormula={opportunitiesFormula}
                  onRowsChange={setLiveRows}
                  profile={profile}
                />
                <div className="mt-8 pt-4 border-t border-gray-100 dark:border-tm-dark-border">
                  <EmployeeSummary
                    rows={liveRows}
                    opportunitiesFormula={opportunitiesFormula}
                    locationName={location?.name}
                    selectedDate={selectedDate}
                  />
                </div>
              </div>

              <div className={activeTab === 'snapshot' ? 'block' : 'hidden'}>
                <DailySnapshot
                  rows={liveRows}
                  date={selectedDate}
                  locationName={location?.name}
                  opportunitiesFormula={opportunitiesFormula}
                />
              </div>

              <div className={activeTab === 'monthly' ? 'block' : 'hidden'}>
                <MonthlyRollup
                  locationId={selectedLocationId}
                  selectedDate={selectedDate}
                  opportunitiesFormula={opportunitiesFormula}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
