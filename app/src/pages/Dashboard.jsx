import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'
import DateSelector from '../components/DateSelector'
import LocationSelector from '../components/LocationSelector'
import DailyLogTable from '../components/DailyLogTable'
import KioskSummary from '../components/KioskSummary'
import MonthlyRollup from '../components/MonthlyRollup'

export default function Dashboard() {
  const { profile, locations } = useAuth()
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab] = useState('daily')

  // Auto-select the only location for store users
  useEffect(() => {
    if (locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id)
    }
  }, [locations])

  const location = locations.find(l => l.id === selectedLocationId)

  // Store users can only edit their own location; area managers + admins can edit all they can see
  const canEdit =
    profile?.role === 'admin' ||
    profile?.role === 'area_manager' ||
    profile?.location_id === selectedLocationId

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />

      <div className="max-w-screen-2xl mx-auto px-4 py-4">
        {/* Top controls */}
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
            {/* Location header bar */}
            <div className="bg-blue-800 text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-bold text-sm">{location?.name}</span>
                {!canEdit && (
                  <span className="text-xs bg-blue-600 px-2 py-0.5 rounded">View Only</span>
                )}
              </div>
              <span className="text-blue-300 text-xs">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                })}
              </span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              <button
                onClick={() => setActiveTab('daily')}
                className={`px-6 py-3 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === 'daily'
                    ? 'border-blue-700 text-blue-700 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Daily Log
              </button>
              <button
                onClick={() => setActiveTab('monthly')}
                className={`px-6 py-3 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === 'monthly'
                    ? 'border-green-700 text-green-700 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Monthly Rollup
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {activeTab === 'daily' ? (
                <>
                  <DailyLogTable
                    locationId={selectedLocationId}
                    selectedDate={selectedDate}
                    canEdit={canEdit}
                  />
                  <div className="mt-8 pt-4 border-t border-gray-100">
                    <KioskSummary
                      locationId={selectedLocationId}
                      selectedDate={selectedDate}
                      canEdit={canEdit}
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
