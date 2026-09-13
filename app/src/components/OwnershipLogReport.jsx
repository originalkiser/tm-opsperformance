import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { PercentInput } from './OwnershipLogSection'
import { ownershipLogStatus, STATUS_LABEL } from '../utils/ownershipLog'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
    </svg>
  )
}

function StatusBadge({ status }) {
  const cls = status === 'complete'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : status === 'overdue'
    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
    : status === 'pending'
    ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
    : 'bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cls}`}>{STATUS_LABEL[status]}</span>
}

const emptyForm = () => ({ yesterday_conversion_pct: '', biggest_challenge: '', what_you_did: '', plan_for_today: '', comments: '' })

// Admin/AM override modal — unlike the self-service form, any date can be edited.
function EditModal({ location, onClose, onSaved }) {
  const [date, setDate]     = useState(todayStr())
  const [form, setForm]     = useState(emptyForm())
  const [existing, setExisting] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  useEffect(() => { fetchEntry() }, [date])

  const fetchEntry = async () => {
    setLoading(true)
    const { data } = await supabase.from('ownership_log_entries').select('*')
      .eq('location_id', location.id).eq('log_date', date).maybeSingle()
    setExisting(data || null)
    setForm(data ? {
      yesterday_conversion_pct: data.yesterday_conversion_pct ?? '',
      biggest_challenge: data.biggest_challenge || '',
      what_you_did:      data.what_you_did      || '',
      plan_for_today:    data.plan_for_today     || '',
      comments:          data.comments           || '',
    } : emptyForm())
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('ownership_log_entries').upsert({
      location_id: location.id,
      log_date: date,
      yesterday_conversion_pct: form.yesterday_conversion_pct === '' ? null : parseFloat(form.yesterday_conversion_pct),
      biggest_challenge: form.biggest_challenge || null,
      what_you_did:      form.what_you_did      || null,
      plan_for_today:    form.plan_for_today     || null,
      comments:          form.comments           || null,
      submitted_at:      existing?.submitted_at || new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'location_id,log_date' })
    setSaving(false)
    onSaved()
  }

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div className="font-brand font-bold text-sm">{location.name}</div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Date</label>
            <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </div>
          {loading ? <div className="flex justify-center py-6"><TmLoader size={48} /></div> : (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Yesterday's Conversion</label>
                <PercentInput value={form.yesterday_conversion_pct} onChange={v => setForm(f => ({ ...f, yesterday_conversion_pct: v }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Biggest Challenge</label>
                <textarea rows={2} value={form.biggest_challenge} onChange={e => setForm(f => ({ ...f, biggest_challenge: e.target.value }))} className={inputCls + ' resize-none'} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">What You Did</label>
                <textarea rows={2} value={form.what_you_did} onChange={e => setForm(f => ({ ...f, what_you_did: e.target.value }))} className={inputCls + ' resize-none'} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Plan for Today</label>
                <textarea rows={2} value={form.plan_for_today} onChange={e => setForm(f => ({ ...f, plan_for_today: e.target.value }))} className={inputCls + ' resize-none'} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Comments</label>
                <textarea rows={2} value={form.comments} onChange={e => setForm(f => ({ ...f, comments: e.target.value }))} className={inputCls + ' resize-none'} />
              </div>
            </>
          )}
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-tm-dark-border flex gap-2 shrink-0">
          <button onClick={handleSave} disabled={saving || loading}
            className="flex-1 py-2.5 rounded-xl bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : existing ? 'Update Post' : 'Submit Post'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-tm-dark-border text-gray-500 dark:text-tm-dark-muted text-sm hover:bg-gray-50 dark:hover:bg-tm-dark-surface transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OwnershipLogReport({ locations }) {
  const [latest, setLatest]   = useState([]) // one row per site (most recent log_date)
  const [loading, setLoading] = useState(true)
  const [editingLoc, setEditingLoc] = useState(null)

  useEffect(() => { fetchAll() }, [locations])

  const fetchAll = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setLoading(false); return }
    const { data } = await supabase.from('ownership_log_entries').select('*')
      .in('location_id', locIds).order('log_date', { ascending: false })
    const seen = {}
    ;(data || []).forEach(r => { if (!seen[r.location_id]) seen[r.location_id] = r })
    setLatest(Object.values(seen))
    setLoading(false)
  }

  if (loading) return <div className="flex justify-center py-12"><TmLoader /></div>
  if (!locations.length) return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Ownership Tools enabled yet. Turn it on in Admin → Locations.</div>

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
        <table className="w-full text-xs font-brand border-collapse">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              <th className="px-3 py-2 text-left">Site</th>
              <th className="px-3 py-2 text-center">Today's Status</th>
              <th className="px-3 py-2 text-center">Last Post</th>
              <th className="px-3 py-2 text-center">Yesterday Conv %</th>
              <th className="px-3 py-2 text-left">Biggest Challenge</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {locations.map((loc, i) => {
              const entry = latest.find(r => r.location_id === loc.id)
              const isToday = entry?.log_date === todayStr()
              const status = ownershipLogStatus(isToday ? entry : null, loc.timezone)
              return (
                <tr key={loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                  <td className="px-3 py-2 font-semibold text-tm-blue dark:text-tm-teal whitespace-nowrap">{loc.name}</td>
                  <td className="px-3 py-2 text-center"><StatusBadge status={status} /></td>
                  <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{fmtDate(entry?.log_date)}</td>
                  <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{entry?.yesterday_conversion_pct != null ? `${entry.yesterday_conversion_pct}%` : '—'}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-muted max-w-[240px] truncate" title={entry?.biggest_challenge}>{entry?.biggest_challenge || '—'}</td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => setEditingLoc(loc)} title="Edit this site's post"
                      className="text-gray-400 hover:text-tm-teal dark:hover:text-tm-teal transition-colors">
                      <EditIcon />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editingLoc && (
        <EditModal location={editingLoc} onClose={() => setEditingLoc(null)} onSaved={() => { setEditingLoc(null); fetchAll() }} />
      )}
    </div>
  )
}
