import { useState, useEffect } from 'react'
import { useMissingTargets } from '../hooks/useMissingTargets'
import SetTargetsModal from './SetTargetsModal'

const DISMISS_KEY = 'tm_targets_banner_dismissed_at'
const TWELVE_HOURS = 12 * 60 * 60 * 1000
const RETURN_GAP   = 2 * 60 * 1000 // treat >2min away as "returning to the app"

export default function TargetsBanner() {
  const { missing, loading, refetch } = useMissingTargets()
  const [showModal, setShowModal] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < TWELVE_HOURS
  })

  // Re-arm after 12h even with the tab left open
  useEffect(() => {
    if (!dismissed) return
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    const remaining = TWELVE_HOURS - (Date.now() - at)
    const t = setTimeout(() => setDismissed(false), Math.max(0, remaining))
    return () => clearTimeout(t)
  }, [dismissed])

  // Re-arm when the user comes back to the tab after a real absence
  useEffect(() => {
    let hiddenAt = null
    const handler = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt >= RETURN_GAP) {
        setDismissed(false)
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  if (loading || dismissed || !missing.length) return null

  const names = missing.map(m => m.location.name)
  const label = names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`

  return (
    <>
      <div className="bg-amber-500 dark:bg-amber-600 text-white px-4 py-2 flex items-center justify-between gap-3 flex-wrap text-sm font-brand">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.28 11.164c.75 1.334-.213 2.987-1.742 2.987H3.72c-1.53 0-2.492-1.653-1.743-2.987L8.257 3.1zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          <span>
            <strong>Set targets:</strong> {label} {missing.length === 1 ? 'needs' : 'need'} budget targets for {missing.some(m => m.reason === 'current') ? 'this' : 'next'} month.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowModal(true)}
            className="px-3 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors font-semibold text-xs"
          >
            Set Targets
          </button>
          <button
            onClick={() => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setDismissed(true) }}
            className="text-white/80 hover:text-white text-lg leading-none px-1"
            title="Dismiss — will reappear when you return or after 12 hours"
          >
            ×
          </button>
        </div>
      </div>

      {showModal && (
        <SetTargetsModal missing={missing} onClose={() => { setShowModal(false); refetch() }} />
      )}
    </>
  )
}
