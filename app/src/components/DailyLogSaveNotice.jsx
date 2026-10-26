import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

// A request can fail after navigation unmounts its Daily Log. Keep the failure
// visible outside that table, scoped to the signed-in user and business date.
export default function DailyLogSaveNotice() {
  const { profile } = useAuth()
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    const show = event => { if (event.detail.userId === profile?.id) setNotice(event.detail) }
    window.addEventListener('daily-log-save-error', show)
    return () => window.removeEventListener('daily-log-save-error', show)
  }, [profile?.id])
  if (!notice || notice.userId !== profile?.id) return null
  return <div role="alert" className="m-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
    <p>Daily Log for {notice.date} could not finish saving. {notice.message} Reopen that location and date to review the server records before continuing.</p>
    <button className="mt-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
  </div>
}
