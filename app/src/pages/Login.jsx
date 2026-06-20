import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    else navigate('/')
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg flex items-center justify-center px-4 transition-colors"
      style={{ backgroundImage: 'radial-gradient(circle at 60% 20%, #d4eeed 0%, #EDEADE 60%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="bg-white dark:bg-tm-dark-surface rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-tm-dark-border">
          <h2 className="text-center text-sm font-brand font-semibold text-tm-blue dark:text-tm-teal tracking-widest uppercase mb-6">
            Operations Portal
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-brand font-semibold text-tm-blue dark:text-tm-dark-muted mb-1 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                className="w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal focus:border-transparent transition"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-brand font-semibold text-tm-blue dark:text-tm-dark-muted mb-1 uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                className="w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal focus:border-transparent transition"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg px-3 py-2 border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-tm-blue text-white rounded-lg py-2.5 text-sm font-brand font-semibold hover:bg-[#0E1D33] transition-colors disabled:opacity-50 mt-2 tracking-wide"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
