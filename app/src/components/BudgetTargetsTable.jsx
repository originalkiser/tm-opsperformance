import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { firstOfMonth } from '../utils/budgetMath'
import { logEdit } from '../utils/auditLog'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const FIELD_LABELS = {
  revenue_goal: 'Revenue Goal',
  membership_goal: 'Membership Goal',
  desired_rating: 'Desired Rating',
  labor_hours_non_salary: 'Labor — Regular Hours',
  labor_hours_with_salary: 'Labor — With Salary',
}

const emptyForm = () => ({ revenue_goal: '', membership_goal: '', desired_rating: '4.85', labor_hours_non_salary: '', labor_hours_with_salary: '' })

function fmtMoney(v) {
  if (v == null) return '—'
  return Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function TargetModal({ location, month, existing, profile, onClose, onSaved }) {
  const [form, setForm] = useState(() => existing ? {
    revenue_goal: existing.revenue_goal ?? '',
    membership_goal: existing.membership_goal ?? '',
    desired_rating: existing.desired_rating ?? '4.85',
    labor_hours_non_salary: existing.labor_hours_non_salary ?? '',
    labor_hours_with_salary: existing.labor_hours_with_salary ?? '',
  } : emptyForm())
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const numOrZero = (v) => v === '' ? 0 : Number(v)
    const newValues = {
      revenue_goal: numOrZero(form.revenue_goal),
      membership_goal: numOrZero(form.membership_goal),
      desired_rating: numOrZero(form.desired_rating),
      labor_hours_non_salary: numOrZero(form.labor_hours_non_salary),
      labor_hours_with_salary: numOrZero(form.labor_hours_with_salary),
    }
    await supabase.from('budget_targets').upsert({
      location_id: location.id,
      target_month: month,
      ...newValues,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,target_month' })

    await logEdit({
      tableName: 'budget_targets',
      locationId: location.id,
      period: month,
      profile,
      oldValues: existing || {},
      newValues,
      fieldLabels: FIELD_LABELS,
    })

    setSaving(false)
    onSaved()
  }

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <div className="font-brand font-bold text-sm">{location.name}</div>
            <div className="text-tm-teal text-xs mt-0.5">{monthLabel(month)} Budget Target</div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Revenue Goal ($)</label>
              <input type="number" min="0" step="0.01" value={form.revenue_goal} onChange={e => setForm(f => ({ ...f, revenue_goal: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Membership Goal</label>
              <input type="number" min="0" value={form.membership_goal} onChange={e => setForm(f => ({ ...f, membership_goal: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Desired Rating</label>
              <input type="number" min="0" max="5" step="0.01" value={form.desired_rating} onChange={e => setForm(f => ({ ...f, desired_rating: e.target.value }))} className={inputCls} />
            </div>
            <div />
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Labor — Regular Hours</label>
              <input type="number" min="0" value={form.labor_hours_non_salary} onChange={e => setForm(f => ({ ...f, labor_hours_non_salary: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Labor — With Salary</label>
              <input type="number" min="0" value={form.labor_hours_with_salary} onChange={e => setForm(f => ({ ...f, labor_hours_with_salary: e.target.value }))} className={inputCls} />
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-tm-dark-border flex gap-2 shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : existing ? 'Update Target' : 'Save Target'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-tm-dark-border text-gray-500 dark:text-tm-dark-muted text-sm hover:bg-gray-50 dark:hover:bg-tm-dark-surface transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
    </svg>
  )
}

// ── Main table ────────────────────────────────────────────────────────────────

export default function BudgetTargetsTable({ locations, profile, onSaved }) {
  const [month, setMonth]     = useState(() => firstOfMonth(todayStr()))
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingLoc, setEditingLoc] = useState(null)

  useEffect(() => { fetchTargets() }, [locations, month])

  const fetchTargets = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setTargets([]); setLoading(false); return }
    const { data } = await supabase.from('budget_targets').select('*')
      .in('location_id', locIds).eq('target_month', month)
    setTargets(data || [])
    setLoading(false)
  }

  const shiftMonth = (n) => {
    const d = new Date(month + 'T00:00:00')
    setMonth(firstOfMonth(`${d.getFullYear()}-${String(d.getMonth() + 1 + n).padStart(2, '0')}-01`))
  }

  if (!locations.length) {
    return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Budget Tracking enabled yet. Turn it on in Admin → Locations.</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">‹</button>
        <span className="font-brand font-semibold text-tm-blue dark:text-tm-teal text-sm w-36 text-center">{monthLabel(month)}</span>
        <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">›</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><TmLoader size={56} /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
          <table className="w-full text-xs font-brand border-collapse">
            <thead>
              <tr className="bg-tm-blue dark:bg-tm-navy text-white">
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-center">Revenue Goal</th>
                <th className="px-3 py-2 text-center">Membership Goal</th>
                <th className="px-3 py-2 text-center">Desired Rating</th>
                <th className="px-3 py-2 text-center">Labor (Regular)</th>
                <th className="px-3 py-2 text-center">Labor (Salary)</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => {
                const t = targets.find(x => x.location_id === loc.id)
                return (
                  <tr key={loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                    <td className="px-3 py-2 font-semibold text-tm-blue dark:text-tm-teal whitespace-nowrap">{loc.name}</td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{fmtMoney(t?.revenue_goal)}</td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{t?.membership_goal ?? '—'}</td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{t?.desired_rating ?? '—'}</td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{t?.labor_hours_non_salary ?? '—'}</td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">{t?.labor_hours_with_salary ?? '—'}</td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => setEditingLoc(loc)} title="Edit this site's target"
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
      )}

      {editingLoc && (
        <TargetModal
          location={editingLoc}
          month={month}
          existing={targets.find(t => t.location_id === editingLoc.id)}
          profile={profile}
          onClose={() => setEditingLoc(null)}
          onSaved={() => { setEditingLoc(null); fetchTargets(); onSaved?.() }}
        />
      )}
    </div>
  )
}
