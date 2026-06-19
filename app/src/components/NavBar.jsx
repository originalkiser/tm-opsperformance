import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function NavBar() {
  const { profile, signOut } = useAuth()

  return (
    <nav className="bg-blue-800 text-white px-4 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-xs font-bold">
            TM
          </div>
          <span className="font-bold text-base tracking-wide">TM Operations</span>
        </Link>
        <span className="text-blue-300 text-xs hidden sm:block">Performance Tracker</span>
      </div>

      <div className="flex items-center gap-3">
        {profile?.role === 'admin' && (
          <Link
            to="/admin"
            className="text-blue-200 text-xs hover:text-white transition-colors border border-blue-600 rounded px-2 py-1"
          >
            Admin
          </Link>
        )}
        {profile?.name && (
          <span className="text-blue-200 text-xs hidden sm:block">{profile.name}</span>
        )}
        <button
          onClick={signOut}
          className="text-xs bg-blue-700 hover:bg-blue-600 px-3 py-1.5 rounded transition-colors"
        >
          Sign Out
        </button>
      </div>
    </nav>
  )
}
