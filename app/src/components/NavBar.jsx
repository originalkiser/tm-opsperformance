import ManagerViewSwitch from './ManagerViewSwitch'
import HelpPanel from './HelpPanel'
import { useEffect, useRef, useState } from 'react'
import tmLogo from '../assets/TM-Logo 1-1.png'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useDisplayAuth as useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import SettingsModal from './SettingsModal'
import TargetsBell from './TargetsBell'
import { useChecklistAccess } from '../hooks/useChecklistAccess'
import { resourceAccess } from '../utils/resourceLibrary'

export default function NavBar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isManager = profile?.role === 'admin'
  const checklistAccess = useChecklistAccess()
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [, setAppearance, appearance = 'system'] = useDarkModeCtx()
  const menu = useRef(null)
  const menuTrigger = useRef(null)

  function closeMenu(restoreFocus = false) {
    if (!menu.current?.open) return
    menu.current.open = false
    if (restoreFocus) menuTrigger.current?.focus()
  }

  useEffect(() => {
    const panel = menu.current
    if (panel?.open) {
      const hadFocus = panel.contains(document.activeElement)
      panel.open = false
      if (hadFocus) menuTrigger.current?.focus()
    }
  }, [pathname])

  const currentPage = path => pathname === path ? 'page' : undefined
  const item = 'tm-nav-item inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold'
  const primary = [
    { path: '/insights', label: isManager ? 'Dashboard' : 'My Dashboard', useLink: isManager },
    { path: '/', label: 'Site Entry' },
    ...(isManager ? [{ path: '/reports', label: 'Reports', useLink: true }] : []),
  ]
  const secondary = [
    ...(['admin', 'store'].includes(profile?.role) ? [{ path: '/employees', label: 'Employees', useLink: true }] : []),
    ...(checklistAccess ? [{ path: '/checklists', label: 'Manager Checklists', useLink: true }] : []),
    ...(resourceAccess(profile) ? [{ path: '/resources', label: 'Resources', useLink: true }] : []),
    ...(isManager ? [
      { path: '/am-entry', label: 'AM Entry', useLink: true },
      { path: '/admin', label: 'Administration', useLink: true },
    ] : []),
  ]

  const destination = ({ path, label, useLink }, insideMenu = false) => useLink
    ? <Link key={path} to={path} className={item} aria-current={currentPage(path)}
        onClick={insideMenu ? event => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeMenu(true)
        } : undefined}>{label}</Link>
    : <button key={path} type="button" className={item} aria-current={currentPage(path)} onClick={() => {
        if (insideMenu) closeMenu(true)
        navigate(path)
      }}>{label}</button>

  const activeInMenu = secondary.find(entry => entry.path === pathname)
  const activePrimary = primary.find(entry => entry.path === pathname)

  return (
    <>
      <nav aria-label="Main navigation" className="tm-app-nav tm-navy-controls relative z-40 border-b border-tm-teal/20 bg-tm-navy text-white dark:bg-tm-dark-nav">
        <div className="mx-auto flex min-h-14 max-w-screen-2xl items-center gap-2 px-3 sm:gap-4 sm:px-5">
          <Link to="/" className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg">
            <img src={tmLogo} alt="Trademark Car Wash" className="h-7 w-auto" />
            <span className="hidden font-brand text-sm font-bold sm:inline">TM Operations</span>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {primary.map(entry => destination(entry))}
          </div>
          <span className="min-w-0 truncate text-sm font-semibold md:hidden" aria-hidden="true">
            {activePrimary?.label || activeInMenu?.label}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isManager && <TargetsBell />}
            <details ref={menu} className="relative" onKeyDown={event => {
              if (event.key === 'Escape' && !showHelp && !showSettings) {
                event.preventDefault()
                closeMenu(true)
              }
            }}>
              <summary ref={menuTrigger} className={`${item} tm-nav-summary cursor-pointer border ${activeInMenu ? 'border-tm-teal text-tm-teal' : 'border-white/30'}`}>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="mr-2 h-4 w-4">
                  <path d="M3 5h14M3 10h14M3 15h14" />
                </svg>
                Menu
              </summary>

              <div className="tm-nav-panel absolute right-0 top-full mt-2 grid w-80 max-w-[calc(100vw-1.5rem)] gap-3 rounded-xl border border-tm-teal/40 bg-tm-navy p-3 shadow-xl dark:bg-tm-dark-nav">
                <div className="grid gap-1 md:hidden">{primary.map(entry => destination(entry, true))}</div>
                {secondary.length > 0 && <div className="grid gap-1">
                  <p className="px-3 text-xs font-semibold text-tm-sky">Operations</p>
                  {secondary.map(entry => destination(entry, true))}
                </div>}

                <div className="grid gap-2 border-t border-white/20 pt-3">
                  {profile?.name && <p className="break-words px-3 text-sm text-tm-sky">{profile.name}</p>}
                  <ManagerViewSwitch />
                  <label className="flex items-center justify-between gap-2 px-3 text-sm font-semibold">
                    Appearance
                    <select aria-label="Appearance" value={appearance} onChange={event => setAppearance(event.target.value)}
                      className="tm-focus min-h-11 rounded-md border border-tm-teal/40 bg-tm-navy px-2 text-sm text-white">
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" aria-haspopup="dialog" onClick={() => setShowSettings(true)} className={item}>Settings</button>
                    <button type="button" aria-haspopup="dialog" onClick={() => setShowHelp(true)} className={item}>Help</button>
                    <button type="button" onClick={signOut} className={item}>Sign Out</button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </nav>
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
