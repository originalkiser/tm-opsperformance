import ManagerViewSwitch from './ManagerViewSwitch'
import HelpPanel from './HelpPanel'
import { useState } from 'react'
import tmLogo from '../assets/TM-Logo 1-1.png'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useDisplayAuth as useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import SettingsModal from './SettingsModal'
import TargetsBell from './TargetsBell'
import { useChecklistAccess } from '../hooks/useChecklistAccess'
import { resourceAccess } from '../utils/resourceLibrary'

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
  const { pathname } = useLocation()
  const navClass = path => `flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3 py-1.5 my-auto rounded-md border transition-colors font-brand font-semibold text-xs tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-teal ${pathname === path
    ? 'bg-tm-teal border-tm-teal text-tm-navy font-bold'
    : 'bg-tm-blue/60 border-tm-teal/30 text-tm-teal hover:bg-tm-blue hover:text-white'}`
  const currentPage = path => pathname === path ? 'page' : undefined
  const isManager = profile?.role === 'admin'
  const checklistAccess = useChecklistAccess()
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [, setAppearance, appearance = 'system'] = useDarkModeCtx()

  return (
    <>
      <nav className="tm-navy-controls bg-tm-navy dark:bg-tm-dark-nav text-white px-4 py-2 xl:py-0 flex flex-wrap xl:flex-nowrap gap-y-2 items-stretch justify-between shadow-lg border-b border-tm-teal/20 min-h-[52px]">

        {/* ── Left: Logo + action buttons ── */}
        <div className="flex flex-wrap xl:flex-nowrap w-full xl:w-auto items-center gap-1">
          {/* Brand badge */}
          <Link to="/" className="flex shrink-0 items-center gap-3 pr-4 border-r border-tm-teal/20 mr-2 py-1.5">
            <img src={tmLogo} alt="Trademark Car Wash" className="h-8 w-auto" />
            <span className="font-brand font-bold text-sm tracking-wide hidden sm:block">TM Operations</span>
          </Link>

          {/* Dashboard — managers → Insights; store users → Snapshot tab */}
          {isManager ? (
            <Link
              to="/insights"
              className={navClass('/insights')}
              aria-current={currentPage('/insights')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zm5-4a1 1 0 011-1h2a1 1 0 011 1v7a1 1 0 01-1 1H8a1 1 0 01-1-1V7zm5-5a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V2z"/>
              </svg>
              Dashboard
            </Link>
          ) : (
            <button
              onClick={() => navigate('/insights')}
              className={navClass('/insights')}
              aria-current={currentPage('/insights')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zm5-4a1 1 0 011-1h2a1 1 0 011 1v7a1 1 0 01-1 1H8a1 1 0 01-1-1V7zm5-5a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V2z"/>
              </svg>
              My Dashboard
            </button>
          )}

          {/* Reports — managers only */}
          {isManager && (
            <Link
              to="/reports"
              className={navClass('/reports')}
              aria-current={currentPage('/reports')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M4 11a1 1 0 011-1h2a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zm5-4a1 1 0 011-1h2a1 1 0 011 1v7a1 1 0 01-1 1h-2a1 1 0 01-1-1V7zm-5 1a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z"/>
              </svg>
              Reports
            </Link>
          )}

          {['admin', 'store'].includes(profile?.role) && (
            <Link to="/employees" className={navClass('/employees')} aria-current={currentPage('/employees')}>Employees</Link>
          )}

          {checklistAccess && <Link to="/checklists" className={navClass('/checklists')} aria-current={currentPage('/checklists')}>Manager Checklists</Link>}
          {resourceAccess(profile) && <Link to="/resources" className={navClass('/resources')} aria-current={currentPage('/resources')}>Resources</Link>}

          {/* AM Entry — admins/area managers only */}
          {isManager && (
            <Link
              to="/am-entry"
              className={navClass('/am-entry')}
              aria-current={currentPage('/am-entry')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6zm2 1a1 1 0 011 1v.5c0 1.5-1.5 3-3 3s-3-1.5-3-3V10a1 1 0 011-1h4zm3.5-2a1.5 1.5 0 10-.001-3.001A1.5 1.5 0 0013.5 7zm-11 0a1.5 1.5 0 10-.001-3.001A1.5 1.5 0 002.5 7zM16 9.5a1 1 0 00-1-1h-1.35c.222.418.35.895.35 1.4v.6a2.97 2.97 0 01-.5 1.65 3.5 3.5 0 002.5-3.35v-.3zM0 9.8c0 1.457.964 2.693 2.5 3.35A2.97 2.97 0 012 11.5v-.6c0-.505.128-.982.35-1.4H1a1 1 0 00-1 1v.3z" clipRule="evenodd"/>
              </svg>
              AM Entry
            </Link>
          )}

          {/* Site Entry — everyone */}
          <button
            onClick={() => navigate('/')}
            className={navClass('/')}
            aria-current={currentPage('/')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M8.354 1.146a.5.5 0 00-.708 0l-6 6A.5.5 0 002 8h1v5a1 1 0 001 1h3v-3h2v3h3a1 1 0 001-1V8h1a.5.5 0 00.354-.854l-6-6z"/>
            </svg>
            Site Entry
          </button>
        </div>

        {/* ── Right: User info + actions ── */}
        <div className="flex flex-wrap xl:flex-nowrap w-full xl:w-auto justify-end items-center gap-2">
          {profile?.name && (
            <span className="text-tm-sky text-xs hidden md:block font-brand">{profile.name}</span>
          )}

          {/* Admin/Manager panel — managers only */}
          {isManager && (
            <Link
              to="/admin"
              className={navClass('/admin')}
              aria-current={currentPage('/admin')}
            >
              {profile?.role === 'admin' ? 'Admin' : 'Manager'}
            </Link>
          )}

          {/* Budget targets bell — admins/area managers only, appears when a site needs targets set */}
          {isManager && <TargetsBell />}

          <select aria-label="Appearance" value={appearance} onChange={event => setAppearance(event.target.value)}
            className="tm-focus min-h-11 rounded-md border border-tm-teal/40 bg-tm-navy px-2 text-sm text-white">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>

          <ManagerViewSwitch />

          {/* Settings cog */}
          <button
            onClick={() => setShowSettings(true)}
            type="button"
            aria-label="Settings"
            aria-haspopup="dialog"
            className="tm-focus inline-grid min-h-11 min-w-11 place-items-center rounded-md text-tm-sky hover:text-white hover:bg-tm-blue/60 transition-colors"
          >
            <CogIcon />
          </button>

          <button type="button" onClick={() => setShowHelp(true)} aria-haspopup="dialog"
            className="rounded-md border border-tm-teal bg-tm-teal px-3 py-1.5 text-xs font-bold text-tm-navy hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            Help
          </button>

          <button
            onClick={signOut}
            className="text-xs bg-tm-blue/60 hover:bg-tm-blue border border-tm-teal/20 px-3 py-1.5 rounded-md transition-colors font-brand tracking-wide"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
