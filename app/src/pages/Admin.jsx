import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'

export default function Admin() {
  const [locations, setLocations] = useState([])
  const [users, setUsers] = useState([])
  const [selectedLocId, setSelectedLocId] = useState('')
  const [employees, setEmployees] = useState([])
  const [newEmpName, setNewEmpName] = useState('')
  const [tab, setTab] = useState('users')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([fetchLocations(), fetchUsers()]).then(() => setLoading(false))
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
      .select('id, name, role, location_id, locations(name)')
    setUsers(data || [])
  }

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('*')
      .eq('location_id', selectedLocId)
      .order('name')
    setEmployees(data || [])
  }

  const updateUser = async (userId, updates) => {
    setSaving(true)
    await supabase.from('user_profiles').update(updates).eq('id', userId)
    await fetchUsers()
    setSaving(false)
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
    if (!window.confirm('Delete this employee?')) return
    await supabase.from('employees').delete().eq('id', id)
    fetchEmployees()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <NavBar />
        <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-800">Admin Panel</h1>
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          {['users', 'employees', 'locations'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-t-lg text-sm font-semibold capitalize transition-colors ${
                tab === t
                  ? 'bg-white text-blue-700 shadow-sm border-b-2 border-blue-700'
                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
              }`}
            >
              {t === 'users' ? 'Users' : t === 'employees' ? 'Employees' : 'Locations'}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-b-xl rounded-tr-xl shadow-md p-5">

          {/* ── Users Tab ── */}
          {tab === 'users' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                Set each user's role and their primary location. Area managers use the Locations tab to assign additional sites.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wide">
                      <th className="px-3 py-2 text-left rounded-tl">Name</th>
                      <th className="px-3 py-2 text-left">Role</th>
                      <th className="px-3 py-2 text-left rounded-tr">Primary Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr key={u.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 font-medium text-gray-700">
                          {u.name || <span className="text-gray-400 italic">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={u.role}
                            onChange={e => updateUser(u.id, { role: e.target.value })}
                            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="store">Store</option>
                            <option value="area_manager">Area Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={u.location_id || ''}
                            onChange={e => updateUser(u.id, { location_id: e.target.value || null })}
                            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">— None —</option>
                            {locations.map(l => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {!users.length && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-gray-400 text-sm">
                          No users yet. Users appear here after their first sign-in.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Employees Tab ── */}
          {tab === 'employees' && (
            <div>
              <div className="flex gap-3 items-center mb-5">
                <select
                  value={selectedLocId}
                  onChange={e => setSelectedLocId(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {selectedLocId && (
                <>
                  {/* Add employee */}
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="Employee name"
                      value={newEmpName}
                      onChange={e => setNewEmpName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addEmployee()}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                    />
                    <button
                      onClick={addEmployee}
                      className="bg-blue-700 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-blue-800 transition-colors"
                    >
                      Add
                    </button>
                  </div>

                  {/* Employee list */}
                  <div className="space-y-1">
                    {employees.map(emp => (
                      <div key={emp.id} className="flex items-center gap-2 py-1 border-b border-gray-100">
                        <span className={`flex-1 text-sm ${!emp.is_active ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                          {emp.name}
                        </span>
                        <button
                          onClick={() => toggleEmployee(emp)}
                          className={`text-xs px-2 py-0.5 rounded transition-colors ${
                            emp.is_active
                              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {emp.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          onClick={() => deleteEmployee(emp.id)}
                          className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                    {!employees.length && (
                      <p className="text-sm text-gray-400 py-3">No employees added yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Locations Tab ── */}
          {tab === 'locations' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                {locations.length} locations loaded. Site codes are truncated to text before the second hyphen.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {locations.map(l => (
                  <div
                    key={l.id}
                    className="text-xs border border-gray-200 rounded-md px-3 py-2 bg-gray-50 text-gray-700"
                  >
                    {l.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
