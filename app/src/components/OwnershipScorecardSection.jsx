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

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const emptyForm = () => ({ manager_name: '', ...Object.fromEntries(CATEGORIES.map(c => [c.key, ''])) })

export default function OwnershipScorecardSection({ locations, canManage }) {
  const [month, setMonth]         = useState(() => firstOfMonth(todayStr()))
  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm]           = useState(emptyForm())
  const [saving, setSaving]       = useState(false)

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

  const totalScore = (row) => CATEGORIES.reduce((s, c) => s + (Number(row[c.key]) || 0), 0)

  const startEdit = (locId) => {
    const existing = entries.find(e => e.location_id === locId)
    setEditingId(locId)
    setForm(existing
      ? { manager_name: existing.manager_name || '', ...Object.fromEntries(CATEGORIES.map(c => [c.key, existing[c.key] ?? ''])) }
      : emptyForm())
  }

  const handleSave = async (locId) => {
    setSaving(true)
    const payload = {
      location_id: locId,
      score_month: month,
      manager_name: form.manager_name || null,
      ...Object.fromEntries(CATEGORIES.map(c => [c.key, form[c.key] === '' ? null : parseInt(form[c.key])])),
      updated_at: new Date().toISOString(),
    }
    await supabase.from('ownership_scorecard_entries').upsert(payload, { onConflict: 'location_id,score_month' })
    setSaving(false)
    setEditingId(null)
    fetchEntries()
  }

  const inputCls = 'w-14 border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-sm text-center bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal'

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
                <th className="px-3 py-2 text-center">Total</th>
                {canManage && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => {
                const existing = entries.find(e => e.location_id === loc.id)
                const isEditing = editingId === loc.id
                return (
                  <tr key={loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                    <td className="px-3 py-2 font-semibold text-tm-blue dark:text-tm-teal whitespace-nowrap">{loc.name}</td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input value={form.manager_name} onChange={e => setForm(f => ({ ...f, manager_name: e.target.value }))}
                          className="w-28 border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal" />
                      ) : (existing?.manager_name || '—')}
                    </td>
                    {CATEGORIES.map(c => (
                      <td key={c.key} className="px-1 py-2 text-center">
                        {isEditing ? (
                          <input type="number" min="0" max="10" value={form[c.key]}
                            onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                            className={inputCls} />
                        ) : (existing?.[c.key] ?? '—')}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-bold text-tm-blue dark:text-tm-teal">
                      {existing ? totalScore(existing) : '—'}
                    </td>
                    {canManage && (
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={() => handleSave(loc.id)} disabled={saving}
                              className="px-2 py-1 rounded bg-tm-teal text-tm-navy font-bold text-[10px] hover:brightness-110 transition-colors disabled:opacity-50">
                              {saving ? '…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 text-[10px]">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(loc.id)}
                            className="text-[10px] font-semibold text-tm-teal hover:text-tm-blue dark:hover:text-white transition-colors uppercase tracking-wide">
                            {existing ? 'Edit' : 'Score'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
