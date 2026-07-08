import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { DarkModeContext } from './contexts/DarkModeContext'
import { useDarkMode } from './hooks/useDarkMode'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Insights from './pages/Insights'
import UpdateBanner from './components/UpdateBanner'
import { useVersionCheck } from './hooks/useVersionCheck'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-tm-cream dark:bg-tm-dark-bg">
        <div className="text-tm-blue dark:text-tm-dark-text text-sm font-brand font-medium tracking-wide">Loading…</div>
      </div>
    )
  }
  return user ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { profile } = useAuth()
  if (!profile) return null
  return profile.role === 'admin' ? children : <Navigate to="/" replace />
}

function ManagerRoute({ children }) {
  const { profile } = useAuth()
  if (!profile) return null
  return ['admin', 'area_manager'].includes(profile.role) ? children : <Navigate to="/" replace />
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
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route
              path="/insights"
              element={<ProtectedRoute><Insights /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute><ManagerRoute><Admin /></ManagerRoute></ProtectedRoute>}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </DarkModeContext.Provider>
  )
}
