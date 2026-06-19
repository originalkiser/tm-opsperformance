import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import ChangePasswordModal from './ChangePasswordModal'

export default function NavBar() {
  const { profile, signOut } = useAuth()
  const isManager = ['admin', 'area_manager'].includes(profile?.role)
  const [showChangePw, setShowChangePw] = useState(false)

  return (
    <>
      <nav className="bg-tm-navy text-white px-4 py-3 flex items-center justify-between shadow-lg border-b border-tm-teal/20">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-3">
            {/* Compact badge logo */}
            <div className="flex flex-col items-center justify-center bg-tm-navy border border-tm-teal/40 rounded-md px-2.5 py-1 leading-none">
              <span className="text-tm-teal font-brand font-semibold tracking-widest text-[7px] uppercase">Trademark</span>
              <span className="text-white font-brand font-bold tracking-wider text-[13px] uppercase leading-tight">Car Wash</span>
            </div>
            <div className="hidden sm:block">
              <div className="text-white font-brand font-bold text-sm tracking-wide leading-tight">TM Operations</div>
              <div className="text-tm-teal text-[10px] tracking-widest uppercase leading-tight">Powered by Strickland Brothers</div>
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {isManager && (
            <Link to="/insights" className="text-tm-teal text-xs hover:text-white transition-colors font-brand font-semibold tracking-wide">
              Insights
            </Link>
          )}
          {isManager && (
            <Link
              to="/admin"
              className="text-tm-teal text-xs hover:text-white transition-colors border border-tm-teal/40 hover:border-tm-teal rounded px-2 py-1 font-brand font-semibold tracking-wide"
            >
              {profile?.role === 'admin' ? 'Admin' : 'Manager'}
            </Link>
          )}
          {profile?.name && (
            <span className="text-tm-sky text-xs hidden sm:block">{profile.name}</span>
          )}
          <button
            onClick={() => setShowChangePw(true)}
            className="text-xs text-tm-sky hover:text-white transition-colors"
          >
            Change Password
          </button>
          <button
            onClick={signOut}
            className="text-xs bg-tm-blue hover:bg-[#0E1D33] border border-tm-teal/30 px-3 py-1.5 rounded transition-colors font-brand"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </>
  )
}
