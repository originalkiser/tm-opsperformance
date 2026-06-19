import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import SettingsModal from './SettingsModal'

function CogIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
    </svg>
  )
}

export default function NavBar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const isManager = ['admin', 'area_manager'].includes(profile?.role)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      <nav className="bg-tm-navy text-white px-4 py-0 flex items-stretch justify-between shadow-lg border-b border-tm-teal/20 min-h-[52px]">

        {/* ── Left: Logo + action buttons ── */}
        <div className="flex items-center gap-1">
          {/* Brand badge */}
          <Link to="/" className="flex items-center gap-3 pr-4 border-r border-tm-teal/20 mr-2 py-2">
            <div className="flex flex-col items-center justify-center bg-tm-navy border border-tm-teal/40 rounded px-2 py-0.5 leading-none">
              <span className="text-tm-teal font-brand font-semibold tracking-widest text-[6px] uppercase">Trademark</span>
              <span className="text-white font-brand font-bold tracking-wider text-[11px] uppercase leading-tight">Car Wash</span>
            </div>
            <span className="font-brand font-bold text-sm tracking-wide hidden sm:block">TM Operations</span>
          </Link>

          {/* Insights — managers only */}
          {isManager && (
            <Link
              to="/insights"
              className="flex items-center gap-1.5 px-3 py-1.5 my-auto rounded-md bg-tm-blue/60 border border-tm-teal/30 text-tm-teal hover:bg-tm-blue hover:text-white transition-colors font-brand font-semibold text-xs tracking-wide"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zm5-4a1 1 0 011-1h2a1 1 0 011 1v7a1 1 0 01-1 1H8a1 1 0 01-1-1V7zm5-5a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V2z"/>
              </svg>
              Insights
            </Link>
          )}

          {/* Shop Entry — everyone */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 px-3 py-1.5 my-auto rounded-md bg-tm-teal text-tm-navy hover:brightness-110 transition-colors font-brand font-bold text-xs tracking-wide"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 8h1v5a1 1 0 001 1h3v-3h2v3h3a1 1 0 001-1V8h1a.5.5 0 00.354-.854l-6-6z"/>
            </svg>
            Shop Entry
          </button>

          {/* Admin/Manager panel — managers only */}
          {isManager && (
            <Link
              to="/admin"
              className="flex items-center gap-1.5 px-3 py-1.5 my-auto rounded-md border border-tm-teal/30 text-tm-sky hover:border-tm-teal hover:text-white transition-colors font-brand font-semibold text-xs tracking-wide"
            >
              {profile?.role === 'admin' ? 'Admin' : 'Manager'}
            </Link>
          )}
        </div>

        {/* ── Right: User info + actions ── */}
        <div className="flex items-center gap-2">
          {profile?.name && (
            <span className="text-tm-sky text-xs hidden md:block font-brand">{profile.name}</span>
          )}

          {/* Settings cog */}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="p-1.5 rounded-md text-tm-sky hover:text-white hover:bg-tm-blue/60 transition-colors"
          >
            <CogIcon />
          </button>

          <button
            onClick={signOut}
            className="text-xs bg-tm-blue/60 hover:bg-tm-blue border border-tm-teal/20 px-3 py-1.5 rounded-md transition-colors font-brand tracking-wide"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
