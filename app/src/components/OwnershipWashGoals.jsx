import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const blank = { goal_1: '', goal_2: '', goal_3: '' }
export default function OwnershipWashGoals({ locationId }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(blank)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setLoading(true); setEditing(false); setSaved(null); setDraft(blank); setError('')
    supabase.from('ownership_wash_goals').select('*').eq('location_id', locationId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError('Unable to load wash goals. Reload before editing.')
        else { setSaved(data); setDraft(data || blank) }
        setLoading(false)
      }).catch(() => { if (!cancelled) { setError('Unable to load wash goals. Reload before editing.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [locationId])
  async function save() {
    setSaving(true); setError('')
    try {
      const payload = { location_id: locationId, ...Object.fromEntries(Object.keys(blank).map(key => [key, draft[key].trim()])) }
      let query = saved
        ? supabase.from('ownership_wash_goals').update(payload).eq('location_id', locationId).eq('updated_at', saved.updated_at)
        : supabase.from('ownership_wash_goals').insert(payload)
      const { data, error } = await query.select().single()
      if (error) throw error
      setSaved(data); setDraft(data); setEditing(false)
    } catch { setError('Goals were not saved. Another user may have changed them; reload and try again.') }
    finally { setSaving(false) }
  }
  return <section className="space-y-3 text-gray-800 dark:text-tm-dark-text">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-bold uppercase">GOALS FOR MY WASH</h4>
      {!editing && <button type="button" disabled={loading || !!error} onClick={() => setEditing(true)} className="text-sm font-semibold text-tm-blue dark:text-tm-teal disabled:opacity-50">Edit goals</button>}
    </div>
    <p className="text-xs">These goals stay in place until you choose to edit them, usually monthly or quarterly.</p>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {loading ? <p>Loading wash goals…</p> : <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.keys(blank).map((key, index) => <label key={key} className="block text-xs font-semibold">
          Goal {index + 1}
          <textarea aria-label={`Goal ${index + 1} for my wash`} rows={3} maxLength={2000} readOnly={!editing} disabled={saving} value={draft[key] || ''} onChange={e => setDraft(old => ({ ...old, [key]: e.target.value }))} className="block w-full mt-1 border rounded-lg p-3 text-sm bg-white dark:bg-tm-dark-surface border-gray-300 dark:border-tm-dark-border read-only:bg-gray-100 dark:read-only:bg-tm-dark-card focus:outline-none focus:ring-2 focus:ring-tm-teal" />
        </label>)}
      </div>
      {editing && <div className="flex gap-3">
        <button type="button" disabled={saving} onClick={save} className="rounded-lg px-4 py-2 bg-tm-teal text-tm-navy font-bold">{saving ? 'Saving…' : 'Save goals'}</button>
        <button type="button" disabled={saving} onClick={() => { setDraft(saved || blank); setEditing(false); setError('') }}>Cancel</button>
      </div>}
    </>}
  </section>
}
