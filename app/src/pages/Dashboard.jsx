import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'
import DateSelector from '../components/DateSelector'
import LocationSelector from '../components/LocationSelector'
import DailyLogTable from '../components/DailyLogTable'
import EmployeeSummary from '../components/EmployeeSummary'
import MonthlyRollup from '../components/MonthlyRollup'

export default function Dashboard() {
  const { profile, locations } = useAuth()
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab] = useState('daily')

  useEffect(() => {
    if (locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id)
    }
  }, [locations])

  const location  = locations.find(l => l.id === selectedLocationId)
  const canEdit   =
    profile?.role === 'admin' ||
    profile?.role === 'area_manager' ||
    profile?.location_id === selectedLocationId

  return (
    <div className="min-h-screen bg-tm-cream/40" style={{ backgroundColor: '#F5F2EA' }}>
      <NavBar />

      <div className="max-w-screen-2xl mx-auto px-4 py-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center mb-4">
          {locations.length > 1 && (
            <LocationSelector
              locations={locations}
              value={selectedLocationId}
              onChange={setSelectedLocationId}
            />
          )}
          <DateSelector value={selectedDate} onChange={setSelectedDate} />
        </div>

        {!selectedLocationId ? (
          <div className="bg-white rounded-xl shadow p-16 text-center text-gray-400">
            <p className="text-lg font-medium">Select a location to begin</p>
            <p className="text-sm mt-1">Use the dropdown above to choose your site</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {/* Location header */}
            <div className="bg-tm-navy text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-brand font-bold text-sm tracking-wide">{location?.name}</span>
                {!canEdit && (
                  <span className="text-xs bg-tm-blue/70 text-tm-sky px-2 py-0.5 rounded font-brand tracking-wide">View Only</span>
                )}
              </div>
              <span className="text-tm-teal text-xs font-brand">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              </span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              {[
                { key: 'daily',   label: 'Daily Log'      },
                { key: 'monthly', label: 'Monthly Rollup' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-6 py-3 text-sm font-brand font-semibold transition-colors border-b-2 ${
                    activeTab === key
                      ? 'border-tm-blue text-tm-blue bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {activeTab === 'daily' ? (
                <>
                  <DailyLogTable
                    locationId={selectedLocationId}
                    selectedDate={selectedDate}
                    canEdit={canEdit}
                  />
                  <div className="mt-8 pt-4 border-t border-gray-100">
                    <EmployeeSummary
                      locationId={selectedLocationId}
                      selectedDate={selectedDate}
                    />
                  </div>
                </>
              ) : (
                <MonthlyRollup
                  locationId={selectedLocationId}
                  selectedDate={selectedDate}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
