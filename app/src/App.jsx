import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { DarkModeContext } from './contexts/DarkModeContext'
import { useDarkMode } from './hooks/useDarkMode'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Insights from './pages/Insights'
import Reports from './pages/Reports'
import AdminEntry from './pages/AdminEntry'
import UpdateBanner from './components/UpdateBanner'
import TargetsBanner from './components/TargetsBanner'
import TmLoader from './components/TmLoader'
import { useVersionCheck } from './hooks/useVersionCheck'
import { isActiveProfile, isSupportedRole } from './utils/permissions'

function ProtectedRoute({ children }) {
  const { user, profile, loading, signOut } = useAuth()
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-tm-cream dark:bg-tm-dark-bg">
        <TmLoader />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!isActiveProfile(profile) || !isSupportedRole(profile.role)) return (
    <div className="p-8 bg-tm-cream dark:bg-tm-dark-bg text-tm-navy dark:text-tm-dark-text min-h-screen">
      <p role="alert">Your account requires administrator review before accessing TM Operations.</p>
      <button className="mt-4 underline" onClick={signOut}>Sign Out</button>
    </div>
  )
  return children
}

function AdminRoute({ children }) {
  const { profile } = useAuth()
  if (!profile) return null
  return profile.role === 'admin' ? children : <Navigate to="/" replace />
}

function VersionWatcher() {
  const updateAvailable = useVersionCheck()
  return updateAvailable ? <UpdateBanner /> : null
}

export default function App() {
  const [dark, setDark] = useDarkMode()

  return (
    <DarkModeContext.Provider value={[dark, setDark]}>
      <AuthProvider>
        <VersionWatcher />
        <HashRouter>
          <TargetsBanner />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route
              path="/insights"
              element={<ProtectedRoute><Insights /></ProtectedRoute>}
            />
            <Route
              path="/reports"
              element={<ProtectedRoute><AdminRoute><Reports /></AdminRoute></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute><AdminRoute><Admin /></AdminRoute></ProtectedRoute>}
            />
            <Route
              path="/admin-entry"
              element={<ProtectedRoute><AdminRoute><AdminEntry /></AdminRoute></ProtectedRoute>}
            />
            <Route path="/am-entry" element={<Navigate to="/admin-entry" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </DarkModeContext.Provider>
  )
}
