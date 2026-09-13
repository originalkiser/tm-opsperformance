import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { firstOfMonth } from '../utils/budgetMath'

const CATEGORIES = [
  { key: 'problem_solving',     label: 'Problem Solving' },
  { key: 'consistency',         label: 'Consistency / Dependability' },
  { key: 'stay_open_mentality', label: 'Stay Open Mentality' },
  { key: 'team_leadership',     label: 'Team Leadership' },
  { key: 'compliance',          label: 'Compliance' },
  { key: 'communication',       label: 'Communication' },
  { key: 'car_wash_knowledge',  label: 'Car Wash Knowledge' },
  { key: 'kpi_targeting',       label: 'KPI Targeting' },
  { key: 'team_player',         label: 'Team Player' },
  { key: 'site_management',     label: 'Site Management' },
]
const MAX_TOTAL = CATEGORIES.length * 10 // 100 — each category is out of 10

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const emptyForm = () => ({ manager_name: '', ...Object.fromEntries(CATEGORIES.map(c => [c.key, ''])) })

const totalScore = (row) => CATEGORIES.reduce((s, c) => s + (Number(row?.[c.key]) || 0), 0)
const pctLabel = (row) => row ? `${Math.round(totalScore(row) / MAX_TOTAL * 100)}%` : '—'

// ── Edit modal ────────────────────────────────────────────────────────────────

function ScoreModal({ location, month, existing, onClose, onSaved }) {
  const [form, setForm] = useState(() => existing
    ? { manager_name: existing.manager_name || '', ...Object.fromEntries(CATEGORIES.map(c => [c.key, existing[c.key] ?? ''])) }
    : emptyForm())
  const [saving, setSaving] = useState(false)

  const liveTotal = CATEGORIES.reduce((s, c) => s + (Number(form[c.key]) || 0), 0)
  const livePct = Math.round(liveTotal / MAX_TOTAL * 100)

  const handleSave = async () => {
    setSaving(true)
    const payload = {
      location_id: location.id,
      score_month: month,
      manager_name: form.manager_name || null,
      ...Object.fromEntries(CATEGORIES.map(c => [c.key, form[c.key] === '' ? null : parseInt(form[c.key])])),
      updated_at: new Date().toISOString(),
    }
    await supabase.from('ownership_scorecard_entries').upsert(payload, { onConflict: 'location_id,score_month' })
    setSaving(false)
    onSaved()
  }

  const inputCls = 'w-16 border border-gray-300 dark:border-tm-dark-border rounded-lg px-2 py-1.5 text-sm text-center bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <div className="font-brand font-bold text-sm">{location.name}</div>
            <div className="text-tm-teal text-xs mt-0.5">{monthLabel(month)} Ownership Scorecard</div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Manager</label>
            <input value={form.manager_name} onChange={e => setForm(f => ({ ...f, manager_name: e.target.value }))}
              className="w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CATEGORIES.map(c => (
              <div key={c.key} className="flex items-center justify-between gap-2">
                <label className="text-xs text-gray-600 dark:text-tm-dark-text">{c.label}</label>
                <input type="number" min="0" max="10" placeholder="0" value={form[c.key]}
                  onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
          </div>

          <div className="bg-tm-sky/20 dark:bg-tm-teal/10 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide">Overall Score</span>
            <span className="font-brand font-bold text-xl text-tm-blue dark:text-tm-teal">{livePct}%</span>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-tm-dark-border flex gap-2 shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Score'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-tm-dark-border text-gray-500 dark:text-tm-dark-muted text-sm hover:bg-gray-50 dark:hover:bg-tm-dark-surface transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OwnershipScorecardSection({ locations, canManage }) {
  const [month, setMonth]     = useState(() => firstOfMonth(todayStr()))
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingLoc, setEditingLoc] = useState(null)

  useEffect(() => { fetchEntries() }, [locations, month])

  const fetchEntries = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setEntries([]); setLoading(false); return }
    const { data } = await supabase
      .from('ownership_scorecard_entries')
      .select('*')
      .in('location_id', locIds)
      .eq('score_month', month)
    setEntries(data || [])
    setLoading(false)
  }

  const shiftMonth = (n) => {
    const d = new Date(month + 'T00:00:00')
    setMonth(firstOfMonth(`${d.getFullYear()}-${String(d.getMonth() + 1 + n).padStart(2, '0')}-01`))
  }

  if (!locations.length) {
    return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Ownership Tools enabled yet. Turn it on in Admin → Locations.</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">‹</button>
          <span className="font-brand font-semibold text-tm-blue dark:text-tm-teal text-sm w-36 text-center">{monthLabel(month)}</span>
          <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">›</button>
        </div>
        {!canManage && <span className="text-xs text-gray-400 dark:text-tm-dark-muted">View only — area managers and admins can enter scores</span>}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><TmLoader size={56} /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
          <table className="w-full text-xs font-brand border-collapse">
            <thead>
              <tr className="bg-tm-blue dark:bg-tm-navy text-white">
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-left">Manager</th>
                {CATEGORIES.map(c => (
                  <th key={c.key} className="px-2 py-2 text-center whitespace-nowrap" title={c.label}>{c.label}</th>
                ))}
                <th className="px-3 py-2 text-center">Overall</th>
                {canManage && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => {
                const existing = entries.find(e => e.location_id === loc.id)
                return (
                  <tr key={loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                    <td className="px-3 py-2 font-semibold text-tm-blue dark:text-tm-teal whitespace-nowrap">{loc.name}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-text">{existing?.manager_name || '—'}</td>
                    {CATEGORIES.map(c => (
                      <td key={c.key} className="px-1 py-2 text-center text-gray-600 dark:text-tm-dark-text">{existing?.[c.key] ?? '—'}</td>
                    ))}
                    <td className="px-3 py-2 text-center font-bold text-tm-blue dark:text-tm-teal">{pctLabel(existing)}</td>
                    {canManage && (
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        <button onClick={() => setEditingLoc(loc)}
                          className="text-[10px] font-semibold text-tm-teal hover:text-tm-blue dark:hover:text-white transition-colors uppercase tracking-wide">
                          {existing ? 'Edit' : 'Score'}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingLoc && (
        <ScoreModal
          location={editingLoc}
          month={month}
          existing={entries.find(e => e.location_id === editingLoc.id)}
          onClose={() => setEditingLoc(null)}
          onSaved={() => { setEditingLoc(null); fetchEntries() }}
        />
      )}
    </div>
  )
}
