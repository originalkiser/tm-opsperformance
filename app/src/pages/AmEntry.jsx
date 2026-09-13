import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'
import OwnershipScorecardSection from '../components/OwnershipScorecardSection'
import BudgetTargetsTable from '../components/BudgetTargetsTable'
import EditAuditLog from '../components/EditAuditLog'

export default function AmEntry() {
  const { profile, locations: allLocations } = useAuth()
  // Area managers: their assigned sites (already scoped by useAuth). Admins:
  // every site — useAuth already returns the full network for admin, so no
  // special-casing is needed here for "sites they aren't assigned to."
  const locations = useMemo(
    () => allLocations.filter(l => !l.exclude_from_reporting),
    [allLocations],
  )
  const scorecardLocations = locations.filter(l => l.show_ownership_tools)
  const targetsLocations   = locations.filter(l => l.show_budget_tracking)
  const auditLocations = useMemo(() => {
    const ids = new Set([...scorecardLocations, ...targetsLocations].map(l => l.id))
    return locations.filter(l => ids.has(l.id))
  }, [locations])

  const [auditRefreshKey, setAuditRefreshKey] = useState(0)
  const bumpAudit = () => setAuditRefreshKey(k => k + 1)

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />

      <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal tracking-wide">AM Entry</h1>

        <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md dark:border dark:border-tm-dark-border p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest bg-purple-700">SCORECARD</span>
            <span className="text-sm text-gray-500 dark:text-tm-dark-muted">Ownership Scorecard — score your sites' managers</span>
          </div>
          <OwnershipScorecardSection
            locations={scorecardLocations}
            canManage
            profile={profile}
            onSaved={bumpAudit}
          />
        </div>

        <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md dark:border dark:border-tm-dark-border p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest bg-emerald-600">TARGETS</span>
            <span className="text-sm text-gray-500 dark:text-tm-dark-muted">Budget Targets — every site in one table</span>
          </div>
          <BudgetTargetsTable
            locations={targetsLocations}
            profile={profile}
            onSaved={bumpAudit}
          />
        </div>

        <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md dark:border dark:border-tm-dark-border p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest bg-gray-500">HISTORY</span>
            <span className="text-sm text-gray-500 dark:text-tm-dark-muted">Recent edits — who changed what, and when</span>
          </div>
          <EditAuditLog locations={auditLocations} refreshKey={auditRefreshKey} />
        </div>
      </div>
    </div>
  )
}
