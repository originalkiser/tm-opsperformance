import { managementAudits } from './utils/managementAudits.js'
import NavBar from './components/NavBar'
import LocationRepair from './components/LocationRepair'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { DarkModeContext } from './contexts/DarkModeContext'
import { useDarkMode } from './hooks/useDarkMode'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Employees from './pages/Employees'
import WeeklyLaborPlanner from './pages/WeeklyLaborPlanner'
import Insights from './pages/Insights'
import Reports from './pages/Reports'
import DailyPosImport from './pages/DailyPosImport'
import SalesReconciliation from './pages/SalesReconciliation'
import AmEntry from './pages/AmEntry'
import ManagerChecklists from './pages/ManagerChecklists'
import ChecklistCompliance from './pages/ChecklistCompliance'
import Resources from './pages/Resources'
import GuestChecklists from './pages/GuestChecklists'
import UpdateBanner from './components/UpdateBanner'
import DailyLogSaveNotice from './components/DailyLogSaveNotice'
import TargetsBanner from './components/TargetsBanner'
import TmLoader from './components/TmLoader'
import { useVersionCheck } from './hooks/useVersionCheck'

function ProtectedRoute({ children, auditReturn }) {
  const { user, profile, loading, locationError } = useAuth()
  if (locationError || (user && (loading || !profile))) return <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg">
    <NavBar />
    <div className="mx-auto max-w-xl p-4"><LocationRepair /></div>
  </div>
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-tm-cream dark:bg-tm-dark-bg">
        <TmLoader />
      </div>
    )
  }
  if (user && profile && !['admin','store'].includes(profile.role)) return <div><NavBar /><p role="alert">This account role is not supported. Ask an Admin to review your account.</p></div>
  return user ? children : <Navigate to="/login" replace state={auditReturn ? { auditReturn } : undefined} />
}

function AdminRoute({ children }) {
  const { profile } = useAuth()
  if (!profile) return null
  return profile.role === 'admin' ? children : <Navigate to="/" replace />
}

function ManagerRoute({ children }) {
  const { profile, managerPreview } = useAuth()
  if (!profile) return null
  return profile.role === 'admin' && !managerPreview ? children : <Navigate to="/" replace />
}

function VersionWatcher() {
  const updateAvailable = useVersionCheck()
  return updateAvailable ? <UpdateBanner /> : null
}

function ViewPages({ children }) {
  const { managerPreview, previewSiteId } = useAuth()
  return <div key={managerPreview ? `preview:${previewSiteId}` : 'normal'}>{children}</div>
}

function AccountApp() {
  return (
      <AuthProvider>
        <VersionWatcher />

          <TargetsBanner />
          <DailyLogSaveNotice />
          <ViewPages><Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route
              path="/insights"
              element={<ProtectedRoute><Insights /></ProtectedRoute>}
            />
            <Route
              path="/reports"
              element={<ProtectedRoute><ManagerRoute><Reports /></ManagerRoute></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute><ManagerRoute><Admin /></ManagerRoute></ProtectedRoute>}
            />
            <Route
              path="/am-entry"
              element={<ProtectedRoute><ManagerRoute><AmEntry /></ManagerRoute></ProtectedRoute>}
            />
            <Route path="/weekly-labor-planner" element={<ProtectedRoute><WeeklyLaborPlanner /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
            <Route path="/daily-pos-import" element={<ProtectedRoute><ManagerRoute><DailyPosImport /></ManagerRoute></ProtectedRoute>} />
            <Route path="/sales-reconciliation" element={<ProtectedRoute><ManagerRoute><SalesReconciliation /></ManagerRoute></ProtectedRoute>} />
            <Route path="/checklists" element={<ProtectedRoute><ManagerChecklists /></ProtectedRoute>} />
            {managementAudits.map(audit => <Route key={audit.key} path={audit.path}
              element={<ProtectedRoute auditReturn={audit.path}><ManagerChecklists key={audit.key} audit={audit} /></ProtectedRoute>} />)}
            <Route path="/checklist-compliance" element={<ProtectedRoute><ChecklistCompliance /></ProtectedRoute>} />
            <Route path="/resources" element={<ProtectedRoute><Resources /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></ViewPages>

      </AuthProvider>

  )
}

export default function App() {
  const appearance = useDarkMode()
  return <DarkModeContext.Provider value={appearance}>
    <HashRouter><Routes>
      <Route path="/guest-checklists" element={<GuestChecklists />} />
      <Route path="/*" element={<AccountApp />} />
    </Routes></HashRouter>
  </DarkModeContext.Provider>
}
