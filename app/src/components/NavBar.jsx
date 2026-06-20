import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import SettingsModal from './SettingsModal'

function CogIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
    </svg>
  )
}

export default function NavBar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const isManager = ['admin', 'area_manager'].includes(profile?.role)
  const [showSettings, setShowSettings] = useState(false)
  const [dark, setDark] = useDarkModeCtx()

  return (
    <>
      <nav className="bg-tm-navy dark:bg-tm-dark-nav text-white px-4 py-0 flex items-stretch justify-between shadow-lg border-b border-tm-teal/20 min-h-[52px]">

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

          {/* Dashboard — managers only */}
          {isManager && (
            <Link
              to="/insights"
              className="flex items-center gap-1.5 px-3 py-1.5 my-auto rounded-md bg-tm-blue/60 border border-tm-teal/30 text-tm-teal hover:bg-tm-blue hover:text-white transition-colors font-brand font-semibold text-xs tracking-wide"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zm5-4a1 1 0 011-1h2a1 1 0 011 1v7a1 1 0 01-1 1H8a1 1 0 01-1-1V7zm5-5a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V2z"/>
              </svg>
              Dashboard
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
        </div>

        {/* ── Right: User info + actions ── */}
        <div className="flex items-center gap-2">
          {profile?.name && (
            <span className="text-tm-sky text-xs hidden md:block font-brand">{profile.name}</span>
          )}

          {/* Admin/Manager panel — managers only */}
          {isManager && (
            <Link
              to="/admin"
              className="flex items-center gap-1.5 px-3 py-1.5 my-auto rounded-md border border-tm-teal/30 text-tm-sky hover:border-tm-teal hover:text-white transition-colors font-brand font-semibold text-xs tracking-wide"
            >
              {profile?.role === 'admin' ? 'Admin' : 'Manager'}
            </Link>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(d => !d)}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 rounded-md text-tm-sky hover:text-white hover:bg-white/10 transition-colors"
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>

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
