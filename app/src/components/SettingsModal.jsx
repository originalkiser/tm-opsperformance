import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function SettingsModal({ onClose }) {
  const { profile } = useAuth()
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-tm-navy px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tm-teal">
              <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
            </svg>
            <h2 className="text-white font-brand font-bold text-sm tracking-wide">Settings</h2>
          </div>
          <button onClick={onClose} className="text-tm-teal/60 hover:text-tm-teal transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Account info */}
          <div className="bg-gray-50 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400 font-brand uppercase tracking-widest mb-0.5">Signed in as</p>
            <p className="text-sm font-brand font-semibold text-tm-blue">{profile?.name || '—'}</p>
            <p className="text-xs text-gray-400">{profile?.role}</p>
          </div>

          {/* Change password */}
          <div>
            <h3 className="text-xs font-brand font-semibold text-tm-blue uppercase tracking-widest mb-3">
              Change Password
            </h3>
            {pwStatus === 'done' ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <p className="text-green-700 text-sm font-semibold">Password updated!</p>
                <button
                  onClick={() => setPwStatus(null)}
                  className="text-xs text-green-600 underline mt-1"
                >
                  Change again
                </button>
              </div>
            ) : (
              <form onSubmit={submitPw} className="space-y-3">
                <div>
                  <label className="block text-xs font-brand font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal"
                  />
                </div>
                <div>
                  <label className="block text-xs font-brand font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal"
                  />
                </div>
                {pwError && <p className="text-red-600 text-xs">{pwError}</p>}
                <button
                  type="submit"
                  disabled={pwStatus === 'saving'}
                  className="w-full bg-tm-blue text-white rounded-lg py-2 text-sm font-brand font-semibold hover:bg-[#0E1D33] transition-colors disabled:opacity-50"
                >
                  {pwStatus === 'saving' ? 'Saving…' : 'Update Password'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
