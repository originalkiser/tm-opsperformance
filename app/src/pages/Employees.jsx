import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { addRosterEmployee, filterRoster, loadRoster, reviewRosterDuplicates, rosterError, updateRosterEmployee, validateDuplicateReview } from '../utils/employeeRoster.js'

const control = 'rounded border border-gray-300 dark:border-tm-dark-border bg-white dark:bg-tm-dark-card p-2 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tm-teal'
export default function Employees() {
  const { user, profile, locations = [] } = useAuth()
  const [selected, setSelected] = useState('')
  const allowed = ['admin', 'area_manager', 'store'].includes(profile?.role)
    && profile?.is_active === true && !profile?.deleted_at
  const locationId = locations.some(row => row.id === selected) ? selected : locations[0]?.id || ''
  return <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg text-gray-800 dark:text-tm-dark-text">
    <NavBar />
    <main className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-brand font-bold">Employees</h1>
      {!allowed ? <p role="alert">Your active account must be authorized to maintain a location.</p> : <>
        <label className="block">Location <select className={control} value={locationId} onChange={e => setSelected(e.target.value)}>
          {!locations.length && <option value="">No assigned locations</option>}
          {locations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        {locationId ? <Roster key={`${user.id}:${locationId}`} locationId={locationId} isAdmin={profile.role === 'admin'} />
          : <p>No location is assigned. Ask Admin to check your access.</p>}
      </>}
    </main>
  </div>
}

export function Roster({ locationId, isAdmin }) {
  const [rows, setRows] = useState([]), [filter, setFilter] = useState('active')
  const [name, setName] = useState(''), [editing, setEditing] = useState(null), [editName, setEditName] = useState('')
  const [selected, setSelected] = useState([]), [review, setReview] = useState(false), [primary, setPrimary] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('')
  const alive = useRef(true), request = useRef(0), saving = useRef(false)
  async function reload() {
    const version = ++request.current
    setLoading(true); setVerified(false); setError('')
    try {
      const data = await loadRoster(supabase, locationId)
      if (alive.current && version === request.current) { setRows(data); setVerified(true); setSelected([]); setReview(false); setEditing(null) }
    } catch (e) { if (alive.current && version === request.current) { setRows([]); setError(rosterError(e)) } }
    finally { if (alive.current && version === request.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; request.current++ } }, [locationId])
  async function save(action, success) {
    if (saving.current) return
    saving.current = true; setBusy(true); setError(''); setMessage('')
    try {
      await action()
      if (alive.current) { setMessage(success); setName(''); await reload() }
    } catch (e) { if (alive.current) setError(rosterError(e)) }
    finally { saving.current = false; if (alive.current) setBusy(false) }
  }
  function startReview() {
    try { validateDuplicateReview(rows, selected, selected[0]); setEditing(null); setPrimary(selected[0]); setConfirmed(false); setReview(true); setError('') }
    catch (e) { setError(e.message) }
  }
  const disabled = busy || loading || !verified
  const reviewRows = rows.filter(row => selected.includes(row.id))
  return <section className="space-y-4" aria-label="Employee roster">
    <p className="text-sm">Your existing roster is ready to review. Deactivation keeps employee records and historical sales. Names are reserved across active and inactive employees at this location.</p>
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); save(() => addRosterEmployee(supabase, locationId, name), 'Employee added.') }}>
      <label>Employee name <input className={control} value={name} onChange={e => setName(e.target.value)} disabled={disabled || review} required /></label>
      <button className={control} disabled={disabled || review || !name.trim()}>Add Employee</button>
    </form>
    <div className="flex flex-wrap gap-2 items-center">
      <label>Status <select className={control} value={filter} disabled={disabled || review} onChange={e => { setFilter(e.target.value); setSelected([]) }}>
        <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
      </select></label>
      <button className={control} disabled={busy || loading || review} onClick={reload}>Reload roster</button>
      {isAdmin && <button className={control} disabled={disabled || review || selected.length < 2} onClick={startReview}>Review selected duplicates ({selected.length})</button>}
    </div>
    {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading roster…</p> : <ul className="space-y-2">
      {filterRoster(rows, filter).map(row => <li key={row.id} className="border border-gray-200 dark:border-tm-dark-border rounded p-3 flex flex-wrap gap-3 items-center">
        {isAdmin && <input type="checkbox" aria-label={`Select ${row.name} (${row.id})`} checked={selected.includes(row.id)} disabled={disabled || review}
          onChange={e => setSelected(ids => e.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} />}
        <div className="flex-1 min-w-0"><strong className="break-words">{row.name}</strong><span className="ml-2 text-sm">{row.is_active === true ? 'Active' : 'Inactive'}</span>
          {isAdmin && <div className="text-xs break-all text-gray-500 dark:text-tm-dark-muted">ID: {row.id}</div>}
        </div>
        <button className={control} disabled={disabled || review} onClick={() => { setEditing(row); setEditName(row.name) }}>Edit Name</button>
        <button className={control} disabled={disabled || review} onClick={() => save(() => updateRosterEmployee(supabase, row, { is_active: row.is_active !== true }), 'Employee status updated.')}>
          {row.is_active === true ? 'Deactivate' : 'Activate'}</button>
      </li>)}
      {!filterRoster(rows, filter).length && <li>No employees match this filter.</li>}
    </ul>}
    {editing && !review && <form aria-label="Edit employee name" className="border rounded p-3 space-y-3" onSubmit={e => {
      e.preventDefault()
      if (window.confirm(`Change “${editing.name}” to “${editName.trim()}”? Historical sales retain their originally recorded names and may appear separately in Team Member Sales. No Daily Logs will be renamed.`))
        save(() => updateRosterEmployee(supabase, editing, { name: editName }), 'Employee name updated. Historical sales retain their original names.')
    }}>
      <p>Historical sales retain their original names. This changes the roster display name only.</p>
      <label>New display name <input className={control} value={editName} onChange={e => setEditName(e.target.value)} disabled={busy} required /></label>
      <button className={control} disabled={disabled || !editName.trim() || editName === editing.name}>Confirm name change</button>
      <button type="button" className={control} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
    </form>}
    {review && isAdmin && <section aria-label="Duplicate review" className="border-2 border-tm-teal rounded p-4 space-y-3">
      <h2 className="font-bold">Review duplicate records</h2>
      <p>Choose the record to keep active. All other selected records will be deactivated together. Every ID, name and historical Daily Log is retained. This does not merge historical sales.</p>
      <fieldset disabled={busy}><legend>Retain one active record</legend>
        {reviewRows.map(row => <label key={row.id} className="block py-2 break-all"><input type="radio" name="primary" value={row.id} checked={primary === row.id} onChange={() => setPrimary(row.id)} /> {row.name} — {row.id} — {row.is_active === true ? 'Active' : 'Inactive'}</label>)}
      </fieldset>
      <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> I confirm every selected record belongs to the same actual person.</label>
      <button className={control} disabled={disabled || !confirmed} onClick={() => save(() => reviewRosterDuplicates(supabase, rows, selected, primary, confirmed), 'Duplicate review completed. Original records and history retained.')}>Retain selected record and deactivate duplicates</button>
      <button className={control} disabled={busy} onClick={() => { setReview(false); setConfirmed(false) }}>Cancel review</button>
    </section>}
  </section>
}
