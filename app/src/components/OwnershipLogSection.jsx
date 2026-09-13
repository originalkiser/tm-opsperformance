import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { ownershipLogStatus, STATUS_LABEL } from '../utils/ownershipLog'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// How many days back a submitted post can still be edited.
const EDIT_WINDOW_DAYS = 3

function daysAgo(logDate) {
  const a = new Date(todayStr() + 'T00:00:00')
  const b = new Date(logDate + 'T00:00:00')
  return Math.round((a - b) / 86400000)
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusBadge({ status }) {
  const cls = status === 'complete'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : status === 'overdue'
    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 animate-pulse'
    : status === 'pending'
    ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
    : 'bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted'
  return <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${cls}`}>{STATUS_LABEL[status]}</span>
}

// Numeric input with a fixed trailing "%" so it's clear the value is a percentage
// as soon as the user starts typing, without polluting the stored numeric value.
export function PercentInput({ value, onChange, className }) {
  return (
    <div className="relative">
      <input
        type="number" step="0.1" min="0" max="100"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="e.g. 9.5"
        className={`${className} pr-7`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-tm-dark-muted text-sm pointer-events-none">%</span>
    </div>
  )
}

const EMPTY_DRAFT = { yesterday_conversion_pct: '', biggest_challenge: '', what_you_did: '', plan_for_today: '', comments: '' }

export default function OwnershipLogSection({ locations, profile, onSaved }) {
  const [selectedLocId, setSelectedLocId] = useState(() => profile?.location_id || locations[0]?.id || '')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingDate, setEditingDate] = useState(todayStr())
  const [draft, setDraft]     = useState(EMPTY_DRAFT)
  const [saving, setSaving]   = useState(false)
  const [now, setNow]         = useState(new Date())

  useEffect(() => {
    if (!selectedLocId && locations[0]) setSelectedLocId(locations[0].id)
  }, [locations])

  // Re-check the pending/overdue boundary every minute while the page is open
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!selectedLocId) return
    fetchEntries()
    setEditingDate(todayStr())
  }, [selectedLocId])

  const location   = locations.find(l => l.id === selectedLocId)
  const todayEntry = entries.find(e => e.log_date === todayStr())
  const editingEntry = entries.find(e => e.log_date === editingDate)
  const isEditingToday = editingDate === todayStr()

  useEffect(() => {
    setDraft(editingEntry ? {
      yesterday_conversion_pct: editingEntry.yesterday_conversion_pct ?? '',
      biggest_challenge: editingEntry.biggest_challenge || '',
      what_you_did:      editingEntry.what_you_did      || '',
      plan_for_today:    editingEntry.plan_for_today     || '',
      comments:          editingEntry.comments           || '',
    } : EMPTY_DRAFT)
  }, [editingEntry?.id, editingDate, selectedLocId])

  const fetchEntries = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ownership_log_entries')
      .select('*')
      .eq('location_id', selectedLocId)
      .order('log_date', { ascending: false })
      .limit(60)
    setEntries(data || [])
    setLoading(false)
  }

  const status = useMemo(
    () => ownershipLogStatus(todayEntry, location?.timezone, now),
    [todayEntry, location?.timezone, now],
  )

  const handleSave = async () => {
    setSaving(true)
    const payload = {
      location_id: selectedLocId,
      log_date:    editingDate,
      yesterday_conversion_pct: draft.yesterday_conversion_pct === '' ? null : parseFloat(draft.yesterday_conversion_pct),
      biggest_challenge: draft.biggest_challenge || null,
      what_you_did:      draft.what_you_did      || null,
      plan_for_today:    draft.plan_for_today     || null,
      comments:          draft.comments           || null,
      submitted_at:      editingEntry?.submitted_at || new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    }
    await supabase.from('ownership_log_entries').upsert(payload, { onConflict: 'location_id,log_date' })
    setSaving(false)
    fetchEntries()
    if (isEditingToday) onSaved?.()
    if (!isEditingToday) setEditingDate(todayStr())
  }

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand'

  if (!locations.length) {
    return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Ownership Tools enabled yet. Turn it on in Admin → Locations.</div>
  }

  return (
    <div className="space-y-5">
      {/* Site picker + status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={selectedLocId}
          onChange={e => setSelectedLocId(e.target.value)}
          className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand"
        >
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-tm-dark-muted font-brand">Today's post:</span>
          <StatusBadge status={status} />
          {status !== 'complete' && (
            <span className="text-[10px] text-gray-400 dark:text-tm-dark-muted">by 10am local</span>
          )}
        </div>
      </div>

      {/* Entry form — today by default, or a past post within the edit window */}
      <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-brand font-bold text-tm-blue dark:text-tm-teal">
            {fmtDate(editingDate)} — Ownership Post {!isEditingToday && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">(editing a past post)</span>}
          </h3>
          {!isEditingToday && (
            <button onClick={() => setEditingDate(todayStr())} className="text-xs text-tm-teal hover:text-tm-blue dark:hover:text-white font-semibold transition-colors">
              Back to today
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Yesterday's Conversion</label>
            <PercentInput
              value={draft.yesterday_conversion_pct}
              onChange={v => setDraft(d => ({ ...d, yesterday_conversion_pct: v }))}
              className={inputCls}
            />
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Biggest Challenge for Conversion</label>
            <textarea rows={2} value={draft.biggest_challenge} onChange={e => setDraft(d => ({ ...d, biggest_challenge: e.target.value }))} className={inputCls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">What You Did to Improve</label>
            <textarea rows={2} value={draft.what_you_did} onChange={e => setDraft(d => ({ ...d, what_you_did: e.target.value }))} className={inputCls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Plan for Today</label>
            <textarea rows={2} value={draft.plan_for_today} onChange={e => setDraft(d => ({ ...d, plan_for_today: e.target.value }))} className={inputCls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Comments</label>
            <textarea rows={2} value={draft.comments} onChange={e => setDraft(d => ({ ...d, comments: e.target.value }))} className={inputCls + ' resize-none'} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingEntry ? 'Update Post' : 'Submit Post'}
          </button>
          {editingEntry?.submitted_at && (
            <span className="text-xs text-gray-400 dark:text-tm-dark-muted">
              Last saved {new Date(editingEntry.updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* History */}
      <div>
        <h3 className="text-xs font-brand font-bold text-gray-400 dark:text-tm-dark-muted uppercase tracking-wide mb-2">Recent Posts</h3>
        {loading ? (
          <div className="flex justify-center py-8"><TmLoader size={56} /></div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
            <table className="w-full text-xs font-brand border-collapse">
              <thead>
                <tr className="bg-tm-blue dark:bg-tm-navy text-white">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-center">Yesterday Conv %</th>
                  <th className="px-3 py-2 text-left">Biggest Challenge</th>
                  <th className="px-3 py-2 text-left">What You Did</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Comments</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.filter(e => e.log_date !== todayStr()).map((e, i) => {
                  const editable = daysAgo(e.log_date) <= EDIT_WINDOW_DAYS
                  return (
                    <tr key={e.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                      <td className="px-3 py-2 text-gray-700 dark:text-tm-dark-text whitespace-nowrap">{fmtDate(e.log_date)}</td>
                      <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{e.yesterday_conversion_pct != null ? `${e.yesterday_conversion_pct}%` : '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-muted max-w-[200px] truncate" title={e.biggest_challenge}>{e.biggest_challenge || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-muted max-w-[200px] truncate" title={e.what_you_did}>{e.what_you_did || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-muted max-w-[200px] truncate" title={e.plan_for_today}>{e.plan_for_today || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-muted max-w-[160px] truncate" title={e.comments}>{e.comments || '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {editable && (
                          <button onClick={() => setEditingDate(e.log_date)} className="text-[10px] font-semibold text-tm-teal hover:text-tm-blue dark:hover:text-white uppercase tracking-wide transition-colors">
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {entries.filter(e => e.log_date !== todayStr()).length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-tm-dark-muted">No prior posts yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
