import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Insights from './pages/Insights'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: '#F5F2EA' }}>
        <div className="text-tm-blue text-sm font-brand font-medium tracking-wide">Loading…</div>
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

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route
            path="/insights"
            element={<ProtectedRoute><ManagerRoute><Insights /></ManagerRoute></ProtectedRoute>}
          />
          <Route
            path="/admin"
            element={<ProtectedRoute><ManagerRoute><Admin /></ManagerRoute></ProtectedRoute>}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
