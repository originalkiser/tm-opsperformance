import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { supabaseAdmin } from '../lib/supabaseAdmin'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'
import TmLoader from '../components/TmLoader'
import { DEFAULT_THRESHOLDS } from '../utils/metricColors'

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function daysLeft(deletedAt) {
  const diff = 30 - Math.floor((Date.now() - new Date(deletedAt)) / 86400000)
  return Math.max(0, diff)
}

export default function Admin() {
  const { profile: currentProfile, locations: myLocations } = useAuth()
  const isAdmin   = currentProfile?.role === 'admin'
  const isAreaMgr = currentProfile?.role === 'area_manager'

  const [locations,    setLocations]    = useState([])
  const [users,        setUsers]        = useState([])
  const [deletedUsers, setDeletedUsers] = useState([])
  const [managerLocs,  setManagerLocs]  = useState([])
  const [selectedLocId, setSelectedLocId] = useState('')
  const [employees,    setEmployees]    = useState([])
  const [newEmpName,   setNewEmpName]   = useState('')
  const [tab,          setTab]          = useState('users')
  const [loading,      setLoading]      = useState(true)

  const [addEmail,  setAddEmail]  = useState('')
  const [addName,   setAddName]   = useState('')
  const [addStatus, setAddStatus] = useState(null)
  const [addError,  setAddError]  = useState('')

  const [resetResults,  setResetResults]  = useState({})
  const [showDeleted,   setShowDeleted]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editingEmail,  setEditingEmail]  = useState({})
  const [emailStatus,   setEmailStatus]   = useState({})

  useEffect(() => {
    const tasks = [fetchLocations(), fetchUsers(), fetchManagerLocs()]
    if (isAdmin) tasks.push(fetchDeletedUsers())
    Promise.all(tasks).then(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selectedLocId) fetchEmployees()
    else setEmployees([])
  }, [selectedLocId])

  const fetchLocations = async () => {
    const { data } = await supabase.from('locations').select('*').order('site_code')
    setLocations(data || [])
  }

  const fetchUsers = async () => {
    const { data } = await supabase
      .from('user_profiles')
      .select('id, name, role, location_id, email, is_active, locations(name)')
      .is('deleted_at', null)
    setUsers(data || [])
  }

  const fetchDeletedUsers = async () => {
    const { data } = await supabase
      .from('user_profiles')
      .select('id, name, role, email, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    setDeletedUsers(data || [])
  }

  const fetchManagerLocs = async () => {
    const { data } = await supabase.from('manager_locations').select('manager_id, location_id')
    setManagerLocs(data || [])
  }

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees').select('*').eq('location_id', selectedLocId).order('name')
    setEmployees(data || [])
  }

  const updateUser = async (userId, updates) => {
    await supabase.from('user_profiles').update(updates).eq('id', userId)
    fetchUsers()
  }

  const deactivateUser = async (userId) => {
    await supabase.from('user_profiles').update({ is_active: false }).eq('id', userId)
    fetchUsers()
  }

  const reactivateUser = async (userId) => {
    await supabase.from('user_profiles').update({ is_active: true }).eq('id', userId)
    fetchUsers()
  }

  const softDeleteUser = async (userId) => {
    await supabase.from('user_profiles')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', userId)
    fetchUsers()
    if (isAdmin) fetchDeletedUsers()
  }

  const restoreUser = async (userId) => {
    await supabase.from('user_profiles')
      .update({ deleted_at: null, is_active: true })
      .eq('id', userId)
    fetchDeletedUsers()
    fetchUsers()
  }

  const permanentDeleteUser = async (userId) => {
    if (!supabaseAdmin) return
    await supabaseAdmin.auth.admin.deleteUser(userId)
    setDeletedUsers(prev => prev.filter(u => u.id !== userId))
    setConfirmDelete(null)
  }

  const changeUserEmail = async (userId) => {
    if (!supabaseAdmin) return
    const newEmail = (editingEmail[userId] || '').trim()
    if (!newEmail) return
    setEmailStatus(p => ({ ...p, [userId]: 'saving' }))
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email: newEmail })
    if (!error) {
      await supabase.from('user_profiles').update({ email: newEmail }).eq('id', userId)
      fetchUsers()
      setEditingEmail(p => { const n = { ...p }; delete n[userId]; return n })
      setEmailStatus(p => ({ ...p, [userId]: 'done' }))
      setTimeout(() => setEmailStatus(p => { const n = { ...p }; delete n[userId]; return n }), 2000)
    } else {
      setEmailStatus(p => ({ ...p, [userId]: error.message }))
    }
  }

  const updateLocationFormula = async (locId, formula) => {
    await supabase.from('locations').update({ opportunities_formula: formula }).eq('id', locId)
    fetchLocations()
  }

  const updateLocationMarket = async (locId, market) => {
    await supabase.from('locations').update({ market: market || null }).eq('id', locId)
    fetchLocations()
  }

  const updateLocationThresholds = async (locId, thresholds) => {
    await supabase.from('locations').update({ metric_thresholds: thresholds }).eq('id', locId)
    fetchLocations()
  }

  const updateLocationExclude = async (locId, exclude) => {
    await supabase.from('locations').update({ exclude_from_reporting: exclude }).eq('id', locId)
    fetchLocations()
  }

  const addManagerToLocation = async (managerId, locId) => {
    if (!managerId || !locId) return
    await supabase.from('manager_locations').upsert({ manager_id: managerId, location_id: locId })
    fetchManagerLocs()
  }

  const removeManagerFromLocation = async (managerId, locId) => {
    await supabase.from('manager_locations')
      .delete().eq('manager_id', managerId).eq('location_id', locId)
    fetchManagerLocs()
  }

  const addUser = async (e) => {
    e.preventDefault()
    if (!supabaseAdmin) { setAddError('Service key not configured.'); return }
    setAddError('')
    setAddStatus('saving')
    const tempPw = generatePassword()
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: addEmail.trim(),
      password: tempPw,
      email_confirm: true,
      user_metadata: { name: addName.trim() },
    })
    if (error) { setAddError(error.message); setAddStatus('error'); return }
    setTimeout(() => fetchUsers(), 1200)
    setAddStatus({ tempPw })
    setAddEmail('')
    setAddName('')
  }

  const resetAddForm = () => { setAddStatus(null); setAddError('') }

  const resetPassword = async (userId, userEmail) => {
    if (!supabaseAdmin) return
    const tempPw = generatePassword()
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPw })
    setResetResults(prev => ({
      ...prev,
      [userId]: error ? { error: error.message } : { tempPw, email: userEmail },
    }))
  }

  const canResetUser = (u) => {
    if (isAdmin) return true
    if (isAreaMgr && u.location_id) return myLocations.some(l => l.id === u.location_id)
    return false
  }

  const addEmployee = async () => {
    const name = newEmpName.trim()
    if (!name || !selectedLocId) return
    await supabase.from('employees').insert({ location_id: selectedLocId, name })
    setNewEmpName('')
    fetchEmployees()
  }

  const toggleEmployee = async (emp) => {
    await supabase.from('employees').update({ is_active: !emp.is_active }).eq('id', emp.id)
    fetchEmployees()
  }

  const deleteEmployee = async (id) => {
    if (!window.confirm('Delete this employee permanently?')) return
    await supabase.from('employees').delete().eq('id', id)
    fetchEmployees()
  }

  const areaManagers = users.filter(u => u.role === 'area_manager')

  if (loading) return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />
      <div className="flex items-center justify-center h-64"><TmLoader /></div>
    </div>
  )

  const tabs = isAdmin
    ? ['users', 'add_user', 'employees', 'locations']
    : ['users', 'employees']

  const tabLabel = (t) => {
    if (t === 'add_user') return 'Add User'
    return t.charAt(0).toUpperCase() + t.slice(1)
  }

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal mb-6 tracking-wide">
          {isAdmin ? 'Admin Panel' : 'Manager Panel'}
        </h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-0 flex-wrap">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-t-lg text-sm font-brand font-semibold capitalize transition-colors ${
                tab === t
                  ? 'bg-white dark:bg-tm-dark-surface text-tm-blue dark:text-tm-teal shadow-sm border-b-2 border-tm-blue dark:border-tm-teal'
                  : 'bg-gray-200 dark:bg-tm-dark-card text-gray-500 dark:text-tm-dark-muted hover:bg-gray-300 dark:hover:bg-tm-dark-border'
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>

        <div className="bg-white dark:bg-tm-dark-surface rounded-b-xl rounded-tr-xl shadow-md p-5 dark:border dark:border-tm-dark-border">

          {/* ── Users ── */}
          {tab === 'users' && (
            <div>
              <p className="text-xs text-gray-500 dark:text-tm-dark-muted mb-3">
                {isAdmin
                  ? 'Manage roles, locations, passwords, and account status.'
                  : 'Reset passwords for users at your assigned locations.'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-tm-dark-card text-gray-600 dark:text-tm-dark-muted text-xs uppercase tracking-wide font-brand">
                      <th className="px-3 py-2 text-left">Name / Email</th>
                      {isAdmin && <th className="px-3 py-2 text-left">Role</th>}
                      {isAdmin && <th className="px-3 py-2 text-left">Primary Location</th>}
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => {
                      const isInactive = u.is_active === false
                      return (
                        <tr key={u.id} className={`${i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-row-alt'} ${isInactive ? 'opacity-60' : ''}`}>
                          <td className="px-3 py-2">
                            {/* Email editing */}
                            {isAdmin && editingEmail[u.id] !== undefined ? (
                              <div className="flex items-center gap-1 mb-1">
                                <input
                                  type="email"
                                  value={editingEmail[u.id]}
                                  onChange={e => setEditingEmail(p => ({ ...p, [u.id]: e.target.value }))}
                                  className="border border-tm-teal rounded px-2 py-0.5 text-xs bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none w-44"
                                  onKeyDown={e => { if (e.key === 'Enter') changeUserEmail(u.id); if (e.key === 'Escape') setEditingEmail(p => { const n = {...p}; delete n[u.id]; return n }) }}
                                />
                                <button onClick={() => changeUserEmail(u.id)} disabled={emailStatus[u.id] === 'saving'}
                                  className="text-[10px] bg-tm-blue text-white px-1.5 py-0.5 rounded hover:bg-[#0E1D33] disabled:opacity-50">
                                  {emailStatus[u.id] === 'saving' ? '…' : '✓'}
                                </button>
                                <button onClick={() => setEditingEmail(p => { const n = {...p}; delete n[u.id]; return n })}
                                  className="text-[10px] text-gray-400 hover:text-red-500 px-1">✕</button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <div className="font-medium text-gray-700 dark:text-tm-dark-text">{u.name || '—'}</div>
                                {isInactive && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded">Inactive</span>}
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <div className="text-xs text-gray-400 dark:text-tm-dark-muted">{u.email || ''}</div>
                              {isAdmin && editingEmail[u.id] === undefined && (
                                <button
                                  onClick={() => setEditingEmail(p => ({ ...p, [u.id]: u.email || '' }))}
                                  title="Change email"
                                  className="text-gray-300 dark:text-tm-dark-muted hover:text-tm-teal transition-colors"
                                >
                                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                                  </svg>
                                </button>
                              )}
                              {emailStatus[u.id] && emailStatus[u.id] !== 'saving' && emailStatus[u.id] !== 'done' && (
                                <span className="text-[10px] text-red-500">{emailStatus[u.id]}</span>
                              )}
                              {emailStatus[u.id] === 'done' && (
                                <span className="text-[10px] text-green-600">✓ Saved</span>
                              )}
                            </div>
                          </td>
                          {isAdmin && (
                            <td className="px-3 py-2">
                              <select
                                value={u.role}
                                onChange={e => updateUser(u.id, { role: e.target.value })}
                                className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal"
                              >
                                <option value="store">Store</option>
                                <option value="area_manager">Area Manager</option>
                                <option value="admin">Admin</option>
                              </select>
                            </td>
                          )}
                          {isAdmin && (
                            <td className="px-3 py-2">
                              <select
                                value={u.location_id || ''}
                                onChange={e => updateUser(u.id, { location_id: e.target.value || null })}
                                className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal"
                              >
                                <option value="">— None —</option>
                                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1 items-start">
                              {canResetUser(u) && (
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => resetPassword(u.id, u.email)}
                                    className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 px-2 py-0.5 rounded transition-colors"
                                  >
                                    Reset Pw
                                  </button>
                                  {resetResults[u.id] && (
                                    <div className="text-xs p-1.5 rounded bg-gray-50 dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border max-w-[180px]">
                                      {resetResults[u.id].error ? (
                                        <span className="text-red-600 dark:text-red-400">{resetResults[u.id].error}</span>
                                      ) : (
                                        <span className="font-mono font-bold text-tm-blue dark:text-tm-teal select-all">
                                          {resetResults[u.id].tempPw}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => isInactive ? reactivateUser(u.id) : deactivateUser(u.id)}
                                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                      isInactive
                                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-tm-dark-card dark:text-tm-dark-muted dark:hover:bg-tm-dark-border'
                                    }`}
                                  >
                                    {isInactive ? 'Reactivate' : 'Deactivate'}
                                  </button>
                                  <button
                                    onClick={() => { if (window.confirm(`Move ${u.name || u.email} to deleted users? They can be restored within 30 days.`)) softDeleteUser(u.id) }}
                                    className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!users.length && (
                      <tr><td colSpan={isAdmin ? 4 : 2} className="px-3 py-6 text-center text-gray-400 dark:text-tm-dark-muted text-sm">
                        No active users.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Deleted Users */}
              {isAdmin && (
                <div className="mt-6 pt-4 border-t border-gray-100 dark:border-tm-dark-border">
                  <button
                    onClick={() => setShowDeleted(s => !s)}
                    className="flex items-center gap-2 text-sm font-brand font-semibold text-gray-500 dark:text-tm-dark-muted hover:text-red-500 transition-colors"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 transition-transform ${showDeleted ? '' : '-rotate-90'}`}>
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
                    </svg>
                    Deleted Users ({deletedUsers.length})
                  </button>

                  {showDeleted && (
                    <div className="mt-3">
                      {deletedUsers.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-tm-dark-muted py-2">No deleted users.</p>
                      ) : (
                        <table className="w-full text-sm mt-2">
                          <thead>
                            <tr className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs uppercase tracking-wide font-brand">
                              <th className="px-3 py-2 text-left">Name / Email</th>
                              <th className="px-3 py-2 text-left">Deletes In</th>
                              <th className="px-3 py-2 text-left">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deletedUsers.map((u, i) => {
                              const days = daysLeft(u.deleted_at)
                              return (
                                <tr key={u.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-row-alt'}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-gray-600 dark:text-tm-dark-muted">{u.name || '—'}</div>
                                    <div className="text-xs text-gray-400 dark:text-tm-dark-muted">{u.email || ''}</div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`text-xs font-semibold ${days <= 5 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-tm-dark-muted'}`}>
                                      {days}d
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex gap-2 items-center">
                                      <button
                                        onClick={() => restoreUser(u.id)}
                                        className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-0.5 rounded transition-colors"
                                      >
                                        Restore
                                      </button>
                                      {confirmDelete === u.id ? (
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-red-600 dark:text-red-400 font-semibold">Permanently delete?</span>
                                          <button
                                            onClick={() => permanentDeleteUser(u.id)}
                                            className="text-xs bg-red-600 text-white hover:bg-red-700 px-2 py-0.5 rounded transition-colors"
                                          >
                                            Yes, Delete Forever
                                          </button>
                                          <button
                                            onClick={() => setConfirmDelete(null)}
                                            className="text-xs text-gray-400 hover:text-gray-600 px-1"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setConfirmDelete(u.id)}
                                          className="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-2 py-0.5 rounded transition-colors"
                                        >
                                          Perm. Delete
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                      {!supabaseAdmin && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">Service key required for permanent deletion.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Add User ── */}
          {tab === 'add_user' && (
            <div className="max-w-md">
              <p className="text-sm text-gray-600 dark:text-tm-dark-muted mb-4">
                Create a new account. A temporary password will be generated — share it with the user so they can log in and update it.
              </p>

              {addStatus && typeof addStatus === 'object' ? (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/40 rounded-lg p-4 mb-4">
                  <p className="text-green-700 dark:text-green-300 font-semibold text-sm mb-1">User created!</p>
                  <p className="text-gray-600 dark:text-tm-dark-muted text-xs mb-2">Temporary password to share:</p>
                  <div className="font-mono font-bold text-tm-blue dark:text-tm-teal text-xl tracking-wider select-all bg-white dark:bg-tm-dark-card border border-tm-teal/30 rounded px-3 py-2 inline-block">
                    {addStatus.tempPw}
                  </div>
                  <p className="text-gray-400 dark:text-tm-dark-muted text-xs mt-2">User can change it after logging in via Settings ⚙</p>
                  <button onClick={resetAddForm} className="mt-3 bg-tm-blue text-white px-4 py-2 rounded-md text-sm font-brand font-semibold hover:bg-[#0E1D33]">
                    Add Another User
                  </button>
                </div>
              ) : (
                <form onSubmit={addUser} className="space-y-3">
                  <div>
                    <label className="block text-xs font-brand font-semibold text-gray-600 dark:text-tm-dark-muted mb-1">Name</label>
                    <input type="text" value={addName} onChange={e => setAddName(e.target.value)}
                      placeholder="Full name"
                      className="w-full border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-2 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal" />
                  </div>
                  <div>
                    <label className="block text-xs font-brand font-semibold text-gray-600 dark:text-tm-dark-muted mb-1">Email *</label>
                    <input type="email" required value={addEmail} onChange={e => setAddEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-2 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal" />
                  </div>
                  {addError && <p className="text-red-600 dark:text-red-400 text-sm">{addError}</p>}
                  <button type="submit" disabled={addStatus === 'saving'}
                    className="bg-tm-blue text-white px-4 py-2 rounded-md text-sm font-brand font-semibold hover:bg-[#0E1D33] transition-colors disabled:opacity-50">
                    {addStatus === 'saving' ? 'Creating…' : 'Create User'}
                  </button>
                </form>
              )}

              {!supabaseAdmin && (
                <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/40 rounded text-xs text-yellow-700 dark:text-yellow-300">
                  <strong>Setup needed:</strong> Add <code>VITE_SUPABASE_SERVICE_KEY</code> to <code>.env</code> and GitHub Secrets, then redeploy.
                </div>
              )}
            </div>
          )}

          {/* ── Employees ── */}
          {tab === 'employees' && (
            <div>
              <div className="flex gap-3 items-center mb-5">
                <select
                  value={selectedLocId}
                  onChange={e => setSelectedLocId(e.target.value)}
                  className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal"
                >
                  <option value="">Select a location</option>
                  {(isAdmin ? locations : myLocations).map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {selectedLocId && (
                <>
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="Employee name"
                      value={newEmpName}
                      onChange={e => setNewEmpName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addEmployee()}
                      className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal w-52"
                    />
                    <button onClick={addEmployee}
                      className="bg-tm-blue text-white px-4 py-1.5 rounded-md text-sm font-brand font-medium hover:bg-[#0E1D33] transition-colors">
                      Add
                    </button>
                  </div>
                  <div className="space-y-1">
                    {employees.map(emp => (
                      <div key={emp.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-tm-dark-border">
                        <span className={`flex-1 text-sm ${!emp.is_active ? 'line-through text-gray-400 dark:text-tm-dark-muted' : 'text-gray-700 dark:text-tm-dark-text'}`}>
                          {emp.name}
                        </span>
                        <button onClick={() => toggleEmployee(emp)}
                          className={`text-xs px-2 py-0.5 rounded transition-colors ${
                            emp.is_active
                              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}>
                          {emp.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button onClick={() => deleteEmployee(emp.id)}
                          className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors">
                          Delete
                        </button>
                      </div>
                    ))}
                    {!employees.length && (
                      <p className="text-sm text-gray-400 dark:text-tm-dark-muted py-3">No employees added yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Locations ── */}
          {tab === 'locations' && (
            <LocationsTab
              locations={locations}
              users={users}
              areaManagers={areaManagers}
              managerLocs={managerLocs}
              onUpdateFormula={updateLocationFormula}
              onUpdateMarket={updateLocationMarket}
              onAddManager={addManagerToLocation}
              onRemoveManager={removeManagerFromLocation}
              onUpdateThresholds={updateLocationThresholds}
              onUpdateExclude={updateLocationExclude}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Locations tab ─────────────────────────────────────────────────────────────
function LocationsTab({ locations, users, areaManagers, managerLocs, onUpdateFormula, onUpdateMarket, onAddManager, onRemoveManager, onUpdateThresholds, onUpdateExclude }) {
  const [marketInputs,    setMarketInputs]    = useState({})
  const [addMgrOpen,      setAddMgrOpen]      = useState({})
  const [thresholdInputs, setThresholdInputs] = useState({})
  const [thresholdSaving, setThresholdSaving] = useState({})

  const dropdownRefs = useRef({})

  const existingMarkets = [...new Set(locations.map(l => l.market).filter(Boolean))].sort()

  // Close AM dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      setAddMgrOpen(prev => {
        const anyOpen = Object.values(prev).some(Boolean)
        if (!anyOpen) return prev
        const next = { ...prev }
        let changed = false
        Object.keys(next).forEach(locId => {
          if (next[locId] && dropdownRefs.current[locId] && !dropdownRefs.current[locId].contains(e.target)) {
            next[locId] = false
            changed = true
          }
        })
        return changed ? next : prev
      })
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleMarketBlur = (locId) => {
    const val = (marketInputs[locId] ?? locations.find(l => l.id === locId)?.market ?? '').trim()
    onUpdateMarket(locId, val)
  }

  const getAssignedMgrs = (locId) =>
    managerLocs
      .filter(ml => ml.location_id === locId)
      .map(ml => users.find(u => u.id === ml.manager_id))
      .filter(Boolean)

  const getPrimaryUsers = (locId) =>
    users.filter(u => u.location_id === locId && u.role === 'store')

  const unassignedMgrs = (locId) =>
    areaManagers.filter(am => !managerLocs.some(ml => ml.manager_id === am.id && ml.location_id === locId))

  const getThresholds = (loc) => ({
    pmix_green:  loc.metric_thresholds?.pmix_green  ?? DEFAULT_THRESHOLDS.pmix_green,
    conv_red:    loc.metric_thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red,
    conv_yellow: loc.metric_thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow,
  })

  const handleThresholdSave = async (loc) => {
    setThresholdSaving(p => ({ ...p, [loc.id]: true }))
    const current = getThresholds(loc)
    const inputs = thresholdInputs[loc.id] || {}
    const merged = {
      pmix_green:  parseFloat(inputs.pmix_green  ?? current.pmix_green),
      conv_red:    parseFloat(inputs.conv_red    ?? current.conv_red),
      conv_yellow: parseFloat(inputs.conv_yellow ?? current.conv_yellow),
    }
    await onUpdateThresholds(loc.id, merged)
    setThresholdInputs(p => { const n = {...p}; delete n[loc.id]; return n })
    setThresholdSaving(p => ({ ...p, [loc.id]: false }))
  }

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-tm-dark-muted mb-4">
        Configure each location's opportunities formula and area manager assignments.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <datalist id="market-list">
            {existingMarkets.map(m => <option key={m} value={m} />)}
          </datalist>
          <thead>
            <tr className="bg-gray-100 dark:bg-tm-dark-card text-gray-600 dark:text-tm-dark-muted text-xs uppercase tracking-wide font-brand">
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Market</th>
              <th className="px-3 py-2 text-left">Opportunities Formula</th>
              <th className="px-3 py-2 text-center">Exclude from Reporting</th>
              <th className="px-3 py-2 text-left">Area Manager(s)</th>
              <th className="px-3 py-2 text-left">Store User(s)</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((loc, i) => {
              const assignedMgrs  = getAssignedMgrs(loc.id)
              const primaryUsers  = getPrimaryUsers(loc.id)
              const availableMgrs = unassignedMgrs(loc.id)

              return (
                <tr key={loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-row-alt'}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-brand font-medium text-tm-blue dark:text-tm-teal whitespace-nowrap">
                    {loc.name}
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2">
                    <input
                      type="text"
                      list="market-list"
                      value={marketInputs[loc.id] ?? (loc.market || '')}
                      onChange={e => setMarketInputs(p => ({ ...p, [loc.id]: e.target.value }))}
                      onBlur={() => handleMarketBlur(loc.id)}
                      placeholder="e.g. North Atlanta"
                      className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal w-full max-w-[200px]"
                    />
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2">
                    <select
                      value={loc.opportunities_formula || 'detailed'}
                      onChange={e => onUpdateFormula(loc.id, e.target.value)}
                      className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal w-full max-w-[200px]"
                    >
                      <option value="simple">Simple — TW − MW</option>
                      <option value="detailed">Detailed — TW − MW + MS</option>
                    </select>
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center">
                    <button
                      role="switch"
                      aria-checked={!!loc.exclude_from_reporting}
                      onClick={() => onUpdateExclude(loc.id, !loc.exclude_from_reporting)}
                      title={loc.exclude_from_reporting
                        ? 'Excluded from reporting — click to include'
                        : 'Included in reporting — click to exclude'}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors align-middle ${
                        loc.exclude_from_reporting ? 'bg-red-500' : 'bg-gray-300 dark:bg-tm-dark-border'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        loc.exclude_from_reporting ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`} />
                    </button>
                    {loc.exclude_from_reporting && (
                      <div className="text-[10px] text-red-500 font-brand font-semibold mt-0.5">Hidden</div>
                    )}
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {assignedMgrs.map(am => (
                        <span
                          key={am.id}
                          className="inline-flex items-center gap-1 bg-tm-blue/10 dark:bg-tm-blue/30 text-tm-blue dark:text-tm-sky text-xs px-2 py-0.5 rounded-full font-brand"
                        >
                          {am.name || am.email || am.id.slice(0, 8)}
                          <button
                            onClick={() => onRemoveManager(am.id, loc.id)}
                            className="text-tm-blue/50 hover:text-red-500 transition-colors leading-none"
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {/* Inline add AM button */}
                      {availableMgrs.length > 0 && (
                        <div className="relative" ref={el => dropdownRefs.current[loc.id] = el}>
                          <button
                            onClick={() => setAddMgrOpen(p => ({ ...p, [loc.id]: !p[loc.id] }))}
                            title="Add area manager"
                            className="inline-flex items-center gap-0.5 text-gray-400 dark:text-tm-dark-muted hover:text-tm-teal transition-colors"
                          >
                            {/* Headshot silhouette */}
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/>
                            </svg>
                            <span className="text-[11px] font-bold leading-none">+</span>
                          </button>
                          {addMgrOpen[loc.id] && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[160px] py-1">
                              {availableMgrs.map(am => (
                                <button
                                  key={am.id}
                                  onClick={() => {
                                    onAddManager(am.id, loc.id)
                                    setAddMgrOpen(p => ({ ...p, [loc.id]: false }))
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs font-brand text-gray-700 dark:text-tm-dark-text hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors"
                                >
                                  {am.name || am.email}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {primaryUsers.length ? primaryUsers.map(u => (
                        <span key={u.id} className="inline-flex items-center bg-gray-100 dark:bg-tm-dark-card text-gray-600 dark:text-tm-dark-muted text-xs px-2 py-0.5 rounded-full">
                          {u.name || u.email || '—'}
                        </span>
                      )) : (
                        <span className="text-xs text-gray-300 dark:text-tm-dark-muted italic">None assigned</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-2 border-t border-gray-100 dark:border-tm-dark-border text-xs text-gray-400 dark:text-tm-dark-muted space-y-1">
        <p><strong className="text-gray-500 dark:text-tm-dark-text">Simple (TW − MW):</strong> All non-member washes count as opportunities</p>
        <p><strong className="text-gray-500 dark:text-tm-dark-text">Detailed (TW − MW + MS):</strong> Add memberships sold back — true opportunities including sold memberships</p>
      </div>

      {/* ── Performance Thresholds ── */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-tm-dark-border">
        <h3 className="text-sm font-brand font-bold text-tm-blue dark:text-tm-teal mb-1 tracking-wide">Performance Thresholds</h3>
        <p className="text-xs text-gray-500 dark:text-tm-dark-muted mb-4">
          Set per-location color thresholds for P-Mix and Conversion. Defaults: P-Mix green ≥ 60%, Conversion red &lt; 7%, yellow 7–9.9%, green ≥ 10%.
        </p>
        <div className="space-y-3">
          {locations.map(loc => {
            const saved = getThresholds(loc)
            const inp   = thresholdInputs[loc.id] || {}
            const dirty = Object.keys(inp).some(k => String(inp[k]) !== String(saved[k]))

            const field = (key, label) => (
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-400 dark:text-tm-dark-muted font-brand uppercase tracking-wide">{label}</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={inp[key] ?? saved[key]}
                    onChange={e => setThresholdInputs(p => ({ ...p, [loc.id]: { ...(p[loc.id] || {}), [key]: e.target.value } }))}
                    className="border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal w-16"
                  />
                  <span className="ml-0.5 text-xs text-gray-400">%</span>
                </div>
              </div>
            )

            return (
              <div key={loc.id} className="flex flex-wrap items-end gap-4 p-3 rounded-lg bg-gray-50 dark:bg-tm-dark-card border border-gray-100 dark:border-tm-dark-border">
                <div className="w-36 shrink-0">
                  <div className="text-xs font-brand font-semibold text-tm-blue dark:text-tm-teal">{loc.name}</div>
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-brand uppercase tracking-wide text-green-600 dark:text-green-400">P-Mix Green ≥</span>
                    {field('pmix_green', '')}
                  </div>
                  <div className="h-8 border-l border-gray-200 dark:border-tm-dark-border hidden sm:block" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-brand uppercase tracking-wide text-red-500">Conv Red &lt;</span>
                    {field('conv_red', '')}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-brand uppercase tracking-wide text-yellow-600 dark:text-yellow-400">Conv Green ≥</span>
                    {field('conv_yellow', '')}
                  </div>
                  {dirty && (
                    <button
                      onClick={() => handleThresholdSave(loc)}
                      disabled={thresholdSaving[loc.id]}
                      className="text-xs bg-tm-blue text-white px-3 py-1.5 rounded hover:bg-[#0E1D33] transition-colors disabled:opacity-50 self-end"
                    >
                      {thresholdSaving[loc.id] ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
