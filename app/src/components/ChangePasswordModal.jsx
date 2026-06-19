import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ChangePasswordModal({ onClose }) {
  const [newPw, setNewPw]       = useState('')
  const [confirm, setConfirm]   = useState('')
  const [status, setStatus]     = useState(null)
  const [error, setError]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (newPw.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (newPw !== confirm) { setError('Passwords do not match.'); return }
    setStatus('saving')
    const { error: err } = await supabase.auth.updateUser({ password: newPw })
    if (err) { setError(err.message); setStatus(null) }
    else setStatus('done')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">Change Password</h2>

        {status === 'done' ? (
          <>
            <p className="text-green-600 text-sm mb-4">Password updated successfully.</p>
            <button onClick={onClose} className="bg-tm-blue text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-[#0E1D33]">
              Close
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal"
              />
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={status === 'saving'}
                className="bg-tm-blue text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-[#0E1D33] disabled:opacity-50"
              >
                {status === 'saving' ? 'Saving…' : 'Update Password'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md text-sm font-semibold text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
