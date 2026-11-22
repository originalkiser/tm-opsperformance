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
    <main className="tm-login flex min-h-screen items-center justify-center px-4 py-6">
      <div className="tm-shared-panel w-full max-w-sm rounded-2xl border p-6 shadow-xl sm:p-8">
        <h1 className="mb-6 text-center font-brand text-xl font-bold">TM Ops Performance</h1>

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
          <div>
            <label htmlFor="login-email" className="tm-field-label">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="tm-field"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="tm-field-label">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="tm-field"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {error && <p role="alert" className="tm-form-error">{error}</p>}

          <button type="submit" disabled={loading} className="tm-primary w-full">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  )
}
