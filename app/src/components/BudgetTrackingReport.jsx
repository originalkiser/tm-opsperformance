import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { PaceBadge, BonusBadge } from './BudgetTrackingSection'
import {
  toDateStr, firstOfMonth, monthProgress,
  yesterdayMetrics, mtdMetrics, revenuePace, membershipStatus,
  computeScore, rankByScore, pct1,
} from '../utils/budgetMath'

const todayStr = () => toDateStr(new Date())

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
    </svg>
  )
}

// ── Edit modal — Daily Entry + Targets, scoped to one site ────────────────────

const YESTERDAY_FIELDS = [
  { key: 'yesterday_washes',      label: 'Yesterday Washes' },
  { key: 'yesterday_redemptions', label: 'Yesterday Redemptions' },
  { key: 'yesterday_basic',       label: 'Yesterday Basic' },
  { key: 'yesterday_good',        label: 'Yesterday Good' },
  { key: 'yesterday_better',      label: 'Yesterday Better' },
  { key: 'yesterday_best',        label: 'Yesterday Best' },
]
const MTD_FIELDS = [
  { key: 'mtd_washes',      label: 'MTD Washes' },
  { key: 'mtd_redemptions', label: 'MTD Redemptions' },
  { key: 'mtd_basic',       label: 'MTD Basic' },
  { key: 'mtd_good',        label: 'MTD Good' },
  { key: 'mtd_better',      label: 'MTD Better' },
  { key: 'mtd_best',        label: 'MTD Best' },
]
function emptyDailyForm() {
  return Object.fromEntries([...YESTERDAY_FIELDS, ...MTD_FIELDS].map(f => [f.key, ''])
    .concat([['mtd_revenue_actual', ''], ['mtd_membership_actual', ''], ['current_rating', ''], ['current_reviews', '']]))
}
function emptyTargetForm() {
  return { revenue_goal: '', membership_goal: '', desired_rating: '4.85', labor_hours_non_salary: '', labor_hours_with_salary: '' }
}

function DailyEntryPane({ location }) {
  const [form, setForm]     = useState(emptyDailyForm())
  const [entry, setEntry]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  useEffect(() => { fetchData() }, [location.id])

  const fetchData = async () => {
    setLoading(true)
    const { data } = await supabase.from('budget_daily_entries').select('*')
      .eq('location_id', location.id).eq('entry_date', todayStr()).maybeSingle()
    setEntry(data || null)
    setForm(data ? Object.fromEntries(Object.keys(emptyDailyForm()).map(k => [k, data[k] ?? ''])) : emptyDailyForm())
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    const numOrNull = (v) => v === '' ? null : Number(v)
    await supabase.from('budget_daily_entries').upsert({
      location_id: location.id,
      entry_date:  todayStr(),
      ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, numOrNull(v)])),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,entry_date' })
    setSaving(false)
    fetchData()
  }

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand placeholder:text-gray-300'

  if (loading) return <div className="flex justify-center py-8"><TmLoader size={56} /></div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400 dark:text-tm-dark-muted">Editing {todayStr()}'s entry — resets fresh each new day.</p>
      <div className="grid grid-cols-2 gap-3">
        {[...YESTERDAY_FIELDS, ...MTD_FIELDS].map(f => (
          <div key={f.key}>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">{f.label}</label>
            <input type="number" min="0" placeholder="0" value={form[f.key]} onChange={e => set(f.key, e.target.value)} className={inputCls} />
          </div>
        ))}
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">MTD Revenue Actual ($)</label>
          <input type="number" min="0" step="0.01" placeholder="0" value={form.mtd_revenue_actual} onChange={e => set('mtd_revenue_actual', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">MTD Membership Actual</label>
          <input type="number" min="0" placeholder="0" value={form.mtd_membership_actual} onChange={e => set('mtd_membership_actual', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Current Rating</label>
          <input type="number" min="0" max="5" step="0.01" placeholder="4.85" value={form.current_rating} onChange={e => set('current_rating', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Current Reviews</label>
          <input type="number" min="0" placeholder="0" value={form.current_reviews} onChange={e => set('current_reviews', e.target.value)} className={inputCls} />
        </div>
      </div>
      <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-xs hover:brightness-110 transition-colors disabled:opacity-50">
        {saving ? 'Saving…' : entry ? 'Update Entry' : 'Save Entry'}
      </button>
    </div>
  )
}

function TargetsPane({ location }) {
  const [month, setMonth]       = useState(() => firstOfMonth(todayStr()))
  const [form, setForm]         = useState(emptyTargetForm())
  const [existing, setExisting] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  useEffect(() => { fetchTarget() }, [location.id, month])

  const fetchTarget = async () => {
    setLoading(true)
    const { data } = await supabase.from('budget_targets').select('*')
      .eq('location_id', location.id).eq('target_month', month).maybeSingle()
    setExisting(data || null)
    setForm(data ? {
      revenue_goal: data.revenue_goal ?? '',
      membership_goal: data.membership_goal ?? '',
      desired_rating: data.desired_rating ?? '4.85',
      labor_hours_non_salary: data.labor_hours_non_salary ?? '',
      labor_hours_with_salary: data.labor_hours_with_salary ?? '',
    } : emptyTargetForm())
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    const numOrZero = (v) => v === '' ? 0 : Number(v)
    await supabase.from('budget_targets').upsert({
      location_id: location.id,
      target_month: month,
      revenue_goal: numOrZero(form.revenue_goal),
      membership_goal: numOrZero(form.membership_goal),
      desired_rating: numOrZero(form.desired_rating),
      labor_hours_non_salary: numOrZero(form.labor_hours_non_salary),
      labor_hours_with_salary: numOrZero(form.labor_hours_with_salary),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,target_month' })
    setSaving(false)
    fetchTarget()
  }

  const shiftMonth = (n) => {
    const d = new Date(month + 'T00:00:00')
    setMonth(firstOfMonth(`${d.getFullYear()}-${String(d.getMonth() + 1 + n).padStart(2, '0')}-01`))
  }

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand'

  if (loading) return <div className="flex justify-center py-8"><TmLoader size={56} /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2">
        <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">‹</button>
        <span className="font-brand font-semibold text-tm-blue dark:text-tm-teal text-sm w-32 text-center">{monthLabel(month)}</span>
        <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">›</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Revenue Goal ($)</label>
          <input type="number" min="0" step="0.01" value={form.revenue_goal} onChange={e => setForm(f => ({ ...f, revenue_goal: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Membership Goal</label>
          <input type="number" min="0" value={form.membership_goal} onChange={e => setForm(f => ({ ...f, membership_goal: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Desired Rating</label>
          <input type="number" min="0" max="5" step="0.01" value={form.desired_rating} onChange={e => setForm(f => ({ ...f, desired_rating: e.target.value }))} className={inputCls} />
        </div>
        <div />
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Labor — Regular Hours</label>
          <input type="number" min="0" value={form.labor_hours_non_salary} onChange={e => setForm(f => ({ ...f, labor_hours_non_salary: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Labor — With Salary</label>
          <input type="number" min="0" value={form.labor_hours_with_salary} onChange={e => setForm(f => ({ ...f, labor_hours_with_salary: e.target.value }))} className={inputCls} />
        </div>
      </div>
      <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-xs hover:brightness-110 transition-colors disabled:opacity-50">
        {saving ? 'Saving…' : existing ? 'Update Targets' : 'Save Targets'}
      </button>
    </div>
  )
}

function EditModal({ location, canManageTargets, onClose }) {
  const [pane, setPane] = useState('daily')
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div className="font-brand font-bold text-sm">{location.name}</div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">×</button>
        </div>
        {canManageTargets && (
          <div className="flex border-b border-gray-100 dark:border-tm-dark-border shrink-0">
            {[{ id: 'daily', label: 'Daily Entry' }, { id: 'targets', label: 'Targets' }].map(t => (
              <button key={t.id} onClick={() => setPane(t.id)}
                className={`flex-1 py-2.5 text-xs font-brand font-semibold transition-colors border-b-2 ${
                  pane === t.id ? 'border-tm-blue dark:border-tm-teal text-tm-blue dark:text-tm-teal' : 'border-transparent text-gray-400 dark:text-tm-dark-muted'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-5">
          {pane === 'daily' ? <DailyEntryPane location={location} /> : <TargetsPane location={location} />}
        </div>
      </div>
    </div>
  )
}

// ── Main report ───────────────────────────────────────────────────────────────

export default function BudgetTrackingReport({ locations, canManageTargets }) {
  const [targets, setTargets]     = useState([])
  const [dailyEntries, setDailyEntries] = useState([])
  const [loading, setLoading]     = useState(true)
  const [editingLoc, setEditingLoc] = useState(null)

  const currentMonth = firstOfMonth(todayStr())

  useEffect(() => { fetchAll() }, [locations])

  const fetchAll = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setLoading(false); return }

    const [{ data: t }, { data: de }] = await Promise.all([
      supabase.from('budget_targets').select('*').in('location_id', locIds).eq('target_month', currentMonth),
      supabase.from('budget_daily_entries').select('*').in('location_id', locIds).order('entry_date', { ascending: false }),
    ])
    setTargets(t || [])
    const latestByLoc = {}
    ;(de || []).forEach(row => { if (!latestByLoc[row.location_id]) latestByLoc[row.location_id] = row })
    setDailyEntries(Object.values(latestByLoc))
    setLoading(false)
  }

  const rows = useMemo(() => {
    const progress = monthProgress(todayStr())
    const built = locations.map(loc => {
      const target = targets.find(t => t.location_id === loc.id)
      const entry  = dailyEntries.find(e => e.location_id === loc.id)
      const yst    = yesterdayMetrics(entry)
      const mtd    = mtdMetrics(entry)
      const rev    = revenuePace(entry?.mtd_revenue_actual, target?.revenue_goal, progress)
      const mem    = membershipStatus(entry?.mtd_membership_actual, target?.membership_goal, todayStr())
      const score  = computeScore({
        yesterdayConv: yst.conversion, mtdConv: mtd.conversion, mtdPmix: mtd.pmix,
        membershipProgressRatio: mem.progressRatio, currentRating: entry?.current_rating,
      })
      return { loc, target, entry, yst, mtd, rev, mem, score }
    })
    return rankByScore(built)
  }, [locations, targets, dailyEntries])

  if (loading) return <div className="flex justify-center py-12"><TmLoader /></div>
  if (!locations.length) return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Budget Tracking enabled yet. Turn it on in Admin → Locations.</div>

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
        <table className="w-full text-xs font-brand border-collapse">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              <th className="px-3 py-2 text-center">Rank</th>
              <th className="px-3 py-2 text-left">Site</th>
              <th className="px-3 py-2 text-center">Yesterday Conv</th>
              <th className="px-3 py-2 text-center">Yesterday P-Mix</th>
              <th className="px-3 py-2 text-center">MTD Conv</th>
              <th className="px-3 py-2 text-center">MTD P-Mix</th>
              <th className="px-3 py-2 text-center">Revenue %</th>
              <th className="px-3 py-2 text-center">Revenue Pace</th>
              <th className="px-3 py-2 text-center">Membership</th>
              <th className="px-3 py-2 text-center">Rating</th>
              <th className="px-3 py-2 text-center">Score</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                <td className="px-3 py-2 text-center font-bold text-tm-blue dark:text-tm-teal">{r.score != null && r.entry ? r.rank : '—'}</td>
                <td className="px-3 py-2 font-semibold text-gray-700 dark:text-tm-dark-text whitespace-nowrap">{r.loc.name}</td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{pct1(r.yst.conversion)}</td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{pct1(r.yst.pmix)}</td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{pct1(r.mtd.conversion)}</td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{pct1(r.mtd.pmix)}</td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{pct1(r.rev.pct)}</td>
                <td className="px-3 py-2 text-center"><PaceBadge onTrack={r.rev.onTrack} label={r.rev.onTrack ? 'On Track' : 'Off Track'} /></td>
                <td className="px-3 py-2 text-center"><BonusBadge tier={r.mem.tier} /></td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{r.entry?.current_rating ?? '—'}</td>
                <td className="px-3 py-2 text-center font-bold text-tm-blue dark:text-tm-teal">{r.entry ? r.score : '—'}</td>
                <td className="px-2 py-2 text-center">
                  <button onClick={() => setEditingLoc(r.loc)} title="Edit this site's data"
                    className="text-gray-400 hover:text-tm-teal dark:hover:text-tm-teal transition-colors">
                    <EditIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingLoc && (
        <EditModal location={editingLoc} canManageTargets={canManageTargets} onClose={() => { setEditingLoc(null); fetchAll() }} />
      )}
    </div>
  )
}
