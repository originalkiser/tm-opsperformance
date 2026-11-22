import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function SettingsModal({ onClose }) {
  const { managerPreview, profile } = useAuth()
  const dialogRef = useRef(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  const dismiss = () => {
    dialogRef.current.close()
    onClose()
  }
  const [newPw, setNewPw]     = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwStatus, setPwStatus] = useState(null) // null | 'saving' | 'done' | 'error'
  const [pwError, setPwError]   = useState('')

  const submitPw = async (e) => {
    e.preventDefault()
    setPwError('')
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters.'); return }
    if (newPw !== confirm)  { setPwError('Passwords do not match.'); return }
    setPwStatus('saving')
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setPwError(error.message); setPwStatus('error') }
    else { setPwStatus('done'); setNewPw(''); setConfirm('') }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="settings-title"
      onCancel={event => { event.preventDefault(); dismiss() }}
      className="tm-shared-panel max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-auto rounded-2xl border p-0 shadow-2xl backdrop:bg-black/50">
      {/* Header */}
      <div className="tm-navy-controls bg-tm-navy px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tm-teal">
            <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
          </svg>
          <h2 id="settings-title" className="text-white font-brand font-bold text-sm tracking-wide">Settings</h2>
        </div>
        <button type="button" aria-label="Close settings" onClick={dismiss} className="tm-focus min-h-11 min-w-11 rounded-md text-tm-teal hover:text-white">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
          </svg>
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Account info */}
        <div className="rounded-lg border border-current/20 px-4 py-3">
          <p className="text-xs text-[var(--tm-muted)] font-brand uppercase tracking-widest mb-0.5">Signed in as</p>
          <p className="text-sm font-brand font-semibold text-[var(--tm-text)]">{profile?.name || '—'}</p>
          <p className="text-xs text-[var(--tm-muted)]">{profile?.role}</p>
        </div>

        {/* Change password */}
        <div>
          <h3 className="text-xs font-brand font-semibold text-[var(--tm-text)] uppercase tracking-widest mb-3">
            Change Password
          </h3>
          {pwStatus === 'done' ? (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <p role="status" className="text-green-700 text-sm font-semibold">Password updated!</p>
              <button
                onClick={() => setPwStatus(null)}
                className="text-xs text-green-600 underline mt-1"
              >
                Change again
              </button>
            </div>
          ) : (
            <form onSubmit={submitPw} className="space-y-3"><fieldset disabled={managerPreview} className="space-y-3">
              <div>
                <label htmlFor="settings-password" className="tm-field-label">
                  New Password
                </label>
                <input
                  id="settings-password"
                  autoComplete="new-password"
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  required
                  className="tm-field"
                />
              </div>
              <div>
                <label htmlFor="settings-confirm" className="tm-field-label">
                  Confirm Password
                </label>
                <input
                  id="settings-confirm"
                  autoComplete="new-password"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  className="tm-field"
                />
              </div>
              {pwError && <p role="alert" className="tm-form-error">{pwError}</p>}
              <button
                type="submit"
                disabled={pwStatus === 'saving'}
                className="tm-primary w-full"
              >
                {pwStatus === 'saving' ? 'Saving…' : 'Update Password'}
              </button>
            </fieldset></form>
          )}
        </div>
      </div>
    </dialog>
  )
}
