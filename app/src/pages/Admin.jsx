import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { supabaseAdmin } from '../lib/supabaseAdmin'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function Admin() {
  const { profile: currentProfile, locations: myLocations } = useAuth()
  const isAdmin   = currentProfile?.role === 'admin'
  const isAreaMgr = currentProfile?.role === 'area_manager'

  const [locations,    setLocations]    = useState([])
  const [users,        setUsers]        = useState([])
  const [managerLocs,  setManagerLocs]  = useState([])  // [{manager_id, location_id}]
  const [selectedLocId, setSelectedLocId] = useState('')
  const [employees,    setEmployees]    = useState([])
  const [newEmpName,   setNewEmpName]   = useState('')
  const [tab,          setTab]          = useState('users')
  const [loading,      setLoading]      = useState(true)

  // Add user
  const [addEmail,  setAddEmail]  = useState('')
  const [addName,   setAddName]   = useState('')
  const [addStatus, setAddStatus] = useState(null)
  const [addError,  setAddError]  = useState('')

  // Reset password results per userId
  const [resetResults, setResetResults] = useState({})

  useEffect(() => {
    Promise.all([fetchLocations(), fetchUsers(), fetchManagerLocs()])
      .then(() => setLoading(false))
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
      .select('id, name, role, location_id, email, locations(name)')
    setUsers(data || [])
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

  // ── Location config helpers ──────────────────────────────────
  const updateLocationFormula = async (locId, formula) => {
    await supabase.from('locations').update({ opportunities_formula: formula }).eq('id', locId)
    fetchLocations()
  }

  const addManagerToLocation = async (managerId, locId) => {
    if (!managerId || !locId) return
    await supabase.from('manager_locations').upsert({ manager_id: managerId, location_id: locId })
    fetchManagerLocs()
  }

  const removeManagerFromLocation = async (managerId, locId) => {
    await supabase.from('manager_locations')
      .delete()
      .eq('manager_id', managerId)
      .eq('location_id', locId)
    fetchManagerLocs()
  }

  // ── Add User ─────────────────────────────────────────────────
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

  // ── Reset Password ────────────────────────────────────────────
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

  // ── Employees ─────────────────────────────────────────────────
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

  // ── Derived data ──────────────────────────────────────────────
  const areaManagers = users.filter(u => u.role === 'area_manager')

  if (loading) return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F2EA' }}>
      <NavBar />
      <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>
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
    <div className="min-h-screen" style={{ backgroundColor: '#F5F2EA' }}>
      <NavBar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-brand font-bold text-tm-blue mb-6 tracking-wide">
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
                  ? 'bg-white text-tm-blue shadow-sm border-b-2 border-tm-blue'
                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-b-xl rounded-tr-xl shadow-md p-5">

          {/* ── Users ── */}
          {tab === 'users' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                {isAdmin
                  ? 'Assign roles and primary locations. Reset passwords as needed.'
                  : 'Reset passwords for users at your assigned locations.'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wide font-brand">
                      <th className="px-3 py-2 text-left">Name / Email</th>
                      {isAdmin && <th className="px-3 py-2 text-left">Role</th>}
                      {isAdmin && <th className="px-3 py-2 text-left">Primary Location</th>}
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr key={u.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-700">{u.name || '—'}</div>
                          <div className="text-xs text-gray-400">{u.email || ''}</div>
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-2">
                            <select
                              value={u.role}
                              onChange={e => updateUser(u.id, { role: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tm-teal"
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
                              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tm-teal"
                            >
                              <option value="">— None —</option>
                              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                          </td>
                        )}
                        <td className="px-3 py-2">
                          {canResetUser(u) && (
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => resetPassword(u.id, u.email)}
                                className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 px-2 py-1 rounded transition-colors w-fit"
                              >
                                Reset Password
                              </button>
                              {resetResults[u.id] && (
                                <div className="text-xs mt-1 p-2 rounded bg-gray-50 border border-gray-200 max-w-xs">
                                  {resetResults[u.id].error ? (
                                    <span className="text-red-600">{resetResults[u.id].error}</span>
                                  ) : (
                                    <>
                                      <span className="text-gray-500">Temp password:</span>
                                      <span className="font-mono font-bold text-tm-blue text-sm select-all ml-1">
                                        {resetResults[u.id].tempPw}
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!users.length && (
                      <tr><td colSpan={isAdmin ? 4 : 2} className="px-3 py-6 text-center text-gray-400 text-sm">
                        No users yet.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Add User ── */}
          {tab === 'add_user' && (
            <div className="max-w-md">
              <p className="text-sm text-gray-600 mb-4">
                Create a new account. A temporary password will be generated — share it with the user so they can log in and update it.
              </p>

              {addStatus && typeof addStatus === 'object' ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <p className="text-green-700 font-semibold text-sm mb-1">User created!</p>
                  <p className="text-gray-600 text-xs mb-2">Temporary password to share:</p>
                  <div className="font-mono font-bold text-tm-blue text-xl tracking-wider select-all bg-white border border-tm-teal/30 rounded px-3 py-2 inline-block">
                    {addStatus.tempPw}
                  </div>
                  <p className="text-gray-400 text-xs mt-2">User can change it after logging in via Settings ⚙</p>
                  <button onClick={resetAddForm} className="mt-3 bg-tm-blue text-white px-4 py-2 rounded-md text-sm font-brand font-semibold hover:bg-[#0E1D33]">
                    Add Another User
                  </button>
                </div>
              ) : (
                <form onSubmit={addUser} className="space-y-3">
                  <div>
                    <label className="block text-xs font-brand font-semibold text-gray-600 mb-1">Name</label>
                    <input type="text" value={addName} onChange={e => setAddName(e.target.value)}
                      placeholder="Full name"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal" />
                  </div>
                  <div>
                    <label className="block text-xs font-brand font-semibold text-gray-600 mb-1">Email *</label>
                    <input type="email" required value={addEmail} onChange={e => setAddEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal" />
                  </div>
                  {addError && <p className="text-red-600 text-sm">{addError}</p>}
                  <button type="submit" disabled={addStatus === 'saving'}
                    className="bg-tm-blue text-white px-4 py-2 rounded-md text-sm font-brand font-semibold hover:bg-[#0E1D33] transition-colors disabled:opacity-50">
                    {addStatus === 'saving' ? 'Creating…' : 'Create User'}
                  </button>
                </form>
              )}

              {!supabaseAdmin && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
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
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal"
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
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-tm-teal w-52"
                    />
                    <button onClick={addEmployee}
                      className="bg-tm-blue text-white px-4 py-1.5 rounded-md text-sm font-brand font-medium hover:bg-[#0E1D33] transition-colors">
                      Add
                    </button>
                  </div>
                  <div className="space-y-1">
                    {employees.map(emp => (
                      <div key={emp.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100">
                        <span className={`flex-1 text-sm ${!emp.is_active ? 'line-through text-gray-400' : 'text-gray-700'}`}>
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
                    {!employees.length && <p className="text-sm text-gray-400 py-3">No employees added yet.</p>}
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
              onAddManager={addManagerToLocation}
              onRemoveManager={removeManagerFromLocation}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Locations tab as sub-component ────────────────────────────
function LocationsTab({ locations, users, areaManagers, managerLocs, onUpdateFormula, onAddManager, onRemoveManager }) {
  // Per-location state for the "add AM" select
  const [addMgrSelections, setAddMgrSelections] = useState({})

  const getAssignedMgrs = (locId) =>
    managerLocs
      .filter(ml => ml.location_id === locId)
      .map(ml => users.find(u => u.id === ml.manager_id))
      .filter(Boolean)

  const getPrimaryUsers = (locId) =>
    users.filter(u => u.location_id === locId && u.role === 'store')

  const unassignedMgrs = (locId) =>
    areaManagers.filter(am => !managerLocs.some(ml => ml.manager_id === am.id && ml.location_id === locId))

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Configure each location's opportunities formula and area manager assignments.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wide font-brand">
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Opportunities Formula</th>
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
                <tr key={loc.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {/* Location name */}
                  <td className="border border-gray-200 px-3 py-2 font-brand font-medium text-tm-blue whitespace-nowrap">
                    {loc.name}
                  </td>

                  {/* Formula select */}
                  <td className="border border-gray-200 px-3 py-2">
                    <select
                      value={loc.opportunities_formula || 'detailed'}
                      onChange={e => onUpdateFormula(loc.id, e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tm-teal w-full max-w-[200px]"
                    >
                      <option value="simple">Simple — TW − MW</option>
                      <option value="detailed">Detailed — TW − MW − MS</option>
                    </select>
                  </td>

                  {/* Area Managers */}
                  <td className="border border-gray-200 px-3 py-2">
                    <div className="flex flex-wrap gap-1 mb-1">
                      {assignedMgrs.map(am => (
                        <span
                          key={am.id}
                          className="inline-flex items-center gap-1 bg-tm-blue/10 text-tm-blue text-xs px-2 py-0.5 rounded-full font-brand"
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
                    </div>
                    {availableMgrs.length > 0 && (
                      <div className="flex gap-1">
                        <select
                          value={addMgrSelections[loc.id] || ''}
                          onChange={e => setAddMgrSelections(p => ({ ...p, [loc.id]: e.target.value }))}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-tm-teal"
                        >
                          <option value="">+ Add AM…</option>
                          {availableMgrs.map(am => (
                            <option key={am.id} value={am.id}>{am.name || am.email}</option>
                          ))}
                        </select>
                        {addMgrSelections[loc.id] && (
                          <button
                            onClick={() => {
                              onAddManager(addMgrSelections[loc.id], loc.id)
                              setAddMgrSelections(p => ({ ...p, [loc.id]: '' }))
                            }}
                            className="text-xs bg-tm-blue text-white px-2 py-0.5 rounded hover:bg-[#0E1D33] transition-colors"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Primary store users */}
                  <td className="border border-gray-200 px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {primaryUsers.length ? primaryUsers.map(u => (
                        <span key={u.id} className="inline-flex items-center bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                          {u.name || u.email || '—'}
                        </span>
                      )) : (
                        <span className="text-xs text-gray-300 italic">None assigned</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 space-y-1">
        <p><strong className="text-gray-500">Simple (TW − MW):</strong> All non-member washes count as opportunities</p>
        <p><strong className="text-gray-500">Detailed (TW − MW − MS):</strong> Subtract memberships sold — shows missed conversion opportunities</p>
      </div>
    </div>
  )
}
