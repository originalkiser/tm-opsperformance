import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import {
  toDateStr, firstOfMonth, monthProgress,
  yesterdayMetrics, mtdMetrics, revenuePace, membershipStatus, pct1,
} from '../utils/budgetMath'
import {
  YESTERDAY_FIELDS, MTD_FIELDS, emptyDailyForm, isFieldMissing, countMissing, isDayComplete,
} from '../utils/budgetDailyFields'

const todayStr = () => toDateStr(new Date())

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export function PaceBadge({ onTrack, label }) {
  if (onTrack == null) return <span className="text-gray-300 dark:text-tm-dark-muted text-xs">—</span>
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
      onTrack ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
    }`}>
      {label}
    </span>
  )
}

export function BonusBadge({ tier }) {
  const cls = tier === 'Off Track'
    ? 'bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted'
    : 'bg-tm-teal/20 text-tm-blue dark:bg-tm-teal/15 dark:text-tm-teal'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cls}`}>{tier}</span>
}

// ── Daily Entry tab ───────────────────────────────────────────────────────────

function DailyEntryTab({ locations, profile, onSaved }) {
  const [selectedLocId, setSelectedLocId] = useState(() => profile?.location_id || locations[0]?.id || '')
  const [entry, setEntry]   = useState(null)
  const [form, setForm]     = useState(emptyDailyForm())
  const [target, setTarget] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [attemptedSave, setAttemptedSave] = useState(false)

  useEffect(() => {
    if (!selectedLocId && locations[0]) setSelectedLocId(locations[0].id)
  }, [locations])

  useEffect(() => { if (selectedLocId) fetchData() }, [selectedLocId])

  const fetchData = async () => {
    setLoading(true)
    const currentMonth = firstOfMonth(todayStr())
    const [{ data: entries }, { data: t }] = await Promise.all([
      supabase.from('budget_daily_entries').select('*').eq('location_id', selectedLocId).eq('entry_date', todayStr()).maybeSingle(),
      supabase.from('budget_targets').select('*').eq('location_id', selectedLocId).eq('target_month', currentMonth).maybeSingle(),
    ])
    const todays = entries || null
    setEntry(todays)
    setTarget(t || null)
    setForm(todays ? Object.fromEntries(Object.keys(emptyDailyForm()).map(k => [k, todays[k] ?? ''])) : emptyDailyForm())
    setAttemptedSave(false)
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const missing = countMissing(form)

  const handleSave = async () => {
    if (missing > 0) { setAttemptedSave(true); return }
    setSaving(true)
    const numOrNull = (v) => v === '' ? null : Number(v)
    const payload = {
      location_id: selectedLocId,
      entry_date:  todayStr(),
      ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, numOrNull(v)])),
      updated_at: new Date().toISOString(),
    }
    await supabase.from('budget_daily_entries').upsert(payload, { onConflict: 'location_id,entry_date' })
    setSaving(false)
    fetchData()
    onSaved?.()
  }

  const yst = yesterdayMetrics(form)
  const mtd = mtdMetrics(form)
  const progress = monthProgress(todayStr())
  const rev = revenuePace(form.mtd_revenue_actual, target?.revenue_goal, progress)
  const mem = membershipStatus(form.mtd_membership_actual, target?.membership_goal, todayStr())

  const baseInputCls = 'w-full border-2 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 font-brand'
  const fieldCls = (key) => {
    if (!isFieldMissing(form, key)) return `${baseInputCls} border-gray-300 dark:border-tm-dark-border focus:ring-tm-teal`
    return attemptedSave
      ? `${baseInputCls} border-red-500 focus:ring-red-400`
      : `${baseInputCls} border-orange-400 focus:ring-orange-300`
  }
  const complete = isDayComplete(entry)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <select
          value={selectedLocId}
          onChange={e => setSelectedLocId(e.target.value)}
          className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand"
        >
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {!target && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">No target set for this month yet</span>
        )}
      </div>

      {loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
        <>
          <div className={`bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border p-5 transition-colors ${
            complete ? 'border-green-400 dark:border-green-600 ring-2 ring-green-200 dark:ring-green-900/40' : 'border-gray-100 dark:border-tm-dark-border'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400 dark:text-tm-dark-muted">
                Enter fresh numbers each day — nothing carries over from yesterday's entry.
              </p>
              {complete && (
                <span className="flex items-center gap-1 text-xs font-brand font-bold text-green-600 dark:text-green-400">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd"/></svg>
                  Today's numbers are done
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-brand font-bold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-2">Yesterday</h4>
                <div className="space-y-2">
                  {YESTERDAY_FIELDS.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 dark:text-tm-dark-muted w-36 shrink-0">
                        {f.label}{f.hint && <span className="block text-[10px] text-gray-400 dark:text-tm-dark-muted italic">{f.hint}</span>}
                      </label>
                      <input type="number" min="0" value={form[f.key]} onChange={e => set(f.key, e.target.value)} className={fieldCls(f.key)} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 dark:bg-tm-dark-card rounded-lg px-2 py-1.5"><span className="text-gray-400">Conv:</span> <strong className="text-tm-blue dark:text-tm-teal">{pct1(yst.conversion)}</strong></div>
                  <div className="bg-gray-50 dark:bg-tm-dark-card rounded-lg px-2 py-1.5"><span className="text-gray-400">P-Mix:</span> <strong className="text-tm-blue dark:text-tm-teal">{pct1(yst.pmix)}</strong></div>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-brand font-bold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-2">Month to Date</h4>
                <div className="space-y-2">
                  {MTD_FIELDS.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 dark:text-tm-dark-muted w-36 shrink-0">
                        {f.label}{f.hint && <span className="block text-[10px] text-gray-400 dark:text-tm-dark-muted italic">{f.hint}</span>}
                      </label>
                      <input type="number" min="0" value={form[f.key]} onChange={e => set(f.key, e.target.value)} className={fieldCls(f.key)} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 dark:bg-tm-dark-card rounded-lg px-2 py-1.5"><span className="text-gray-400">Conv:</span> <strong className="text-tm-blue dark:text-tm-teal">{pct1(mtd.conversion)}</strong></div>
                  <div className="bg-gray-50 dark:bg-tm-dark-card rounded-lg px-2 py-1.5"><span className="text-gray-400">P-Mix:</span> <strong className="text-tm-blue dark:text-tm-teal">{pct1(mtd.pmix)}</strong></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100 dark:border-tm-dark-border">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">MTD Revenue Actual ($)</label>
                <input type="number" min="0" step="0.01" value={form.mtd_revenue_actual} onChange={e => set('mtd_revenue_actual', e.target.value)} className={fieldCls('mtd_revenue_actual')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">MTD Membership Actual</label>
                <input type="number" min="0" value={form.mtd_membership_actual} onChange={e => set('mtd_membership_actual', e.target.value)} className={fieldCls('mtd_membership_actual')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Current Rating</label>
                <input type="number" min="0" max="5" step="0.01" value={form.current_rating} onChange={e => set('current_rating', e.target.value)} className={fieldCls('current_rating')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Current Reviews</label>
                <input type="number" min="0" value={form.current_reviews} onChange={e => set('current_reviews', e.target.value)} className={fieldCls('current_reviews')} />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : entry ? 'Update Today’s Numbers' : 'Save Today’s Numbers'}
              </button>
              {attemptedSave && missing > 0 && (
                <span className="text-xs font-brand font-bold text-red-600 dark:text-red-400">
                  {missing} field{missing !== 1 ? 's' : ''} need{missing === 1 ? 's' : ''} to be updated
                </span>
              )}
            </div>
          </div>

          {/* Pace summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border p-4">
              <div className="text-[10px] font-brand font-semibold text-gray-400 uppercase tracking-wide mb-1">MTD Revenue %</div>
              <div className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal">{pct1(rev.pct)}</div>
              <div className="mt-1"><PaceBadge onTrack={rev.onTrack} label={rev.onTrack ? 'On Track' : 'Off Track'} /></div>
            </div>
            <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border p-4">
              <div className="text-[10px] font-brand font-semibold text-gray-400 uppercase tracking-wide mb-1">MTD Membership Actual</div>
              <div className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal">{form.mtd_membership_actual || 0}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">goal {target?.membership_goal ?? '—'}</div>
            </div>
            <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border p-4">
              <div className="text-[10px] font-brand font-semibold text-gray-400 uppercase tracking-wide mb-1">Membership Bonus</div>
              <div className="mt-1"><BonusBadge tier={mem.tier} /></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Targets tab ───────────────────────────────────────────────────────────────

function emptyTargetForm() {
  return { revenue_goal: '', membership_goal: '', desired_rating: '4.85', labor_hours_non_salary: '', labor_hours_with_salary: '' }
}

function TargetsTab({ locations, allLocations }) {
  const [selectedLocId, setSelectedLocId] = useState(() => locations[0]?.id || '')
  const [month, setMonth]   = useState(() => firstOfMonth(todayStr()))
  const [form, setForm]     = useState(emptyTargetForm())
  const [existing, setExisting] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [showOtherSites, setShowOtherSites] = useState(false)
  const [confirmOtherId, setConfirmOtherId] = useState(null)

  const otherSites = allLocations.filter(l => !locations.some(v => v.id === l.id))
  const selectedLoc = allLocations.find(l => l.id === selectedLocId) || locations.find(l => l.id === selectedLocId)
  const isUnassigned = otherSites.some(l => l.id === selectedLocId)

  useEffect(() => {
    if (!selectedLocId && locations[0]) setSelectedLocId(locations[0].id)
  }, [locations])

  useEffect(() => { if (selectedLocId) fetchTarget() }, [selectedLocId, month])

  const fetchTarget = async () => {
    setLoading(true)
    const { data } = await supabase.from('budget_targets').select('*')
      .eq('location_id', selectedLocId).eq('target_month', month).maybeSingle()
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
      location_id: selectedLocId,
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

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={selectedLocId}
          onChange={e => setSelectedLocId(e.target.value)}
          className="border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand"
        >
          <optgroup label="Your Sites">
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </optgroup>
        </select>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">‹</button>
          <span className="font-brand font-semibold text-tm-blue dark:text-tm-teal text-sm w-36 text-center">{monthLabel(month)}</span>
          <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 dark:border-tm-dark-border text-gray-500 hover:text-tm-blue dark:hover:text-tm-teal transition-colors">›</button>
        </div>
      </div>

      {otherSites.length > 0 && (
        <div>
          <button onClick={() => setShowOtherSites(o => !o)} className="text-xs text-gray-400 dark:text-tm-dark-muted hover:text-tm-blue dark:hover:text-tm-teal transition-colors underline">
            {showOtherSites ? 'Hide other sites' : `Set targets for a site you don't manage (${otherSites.length})`}
          </button>
          {showOtherSites && (
            <div className="mt-2 flex flex-wrap gap-2">
              {otherSites.map(l => (
                <button key={l.id} onClick={() => setConfirmOtherId(l.id)}
                  className="px-3 py-1 rounded-full border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs font-semibold hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                  {l.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmOtherId && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmOtherId(null)} />
          <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl p-6 max-w-sm mx-4 z-10">
            <p className="font-brand font-bold text-tm-blue dark:text-tm-teal mb-2">You don't manage this site</p>
            <p className="text-sm text-gray-500 dark:text-tm-dark-muted mb-4">
              {allLocations.find(l => l.id === confirmOtherId)?.name} isn't one of your assigned sites. Setting targets here affects that site's manager. Continue?
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setSelectedLocId(confirmOtherId); setConfirmOtherId(null) }} className="flex-1 py-2 rounded-lg bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors">Yes, continue</button>
              <button onClick={() => setConfirmOtherId(null)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-tm-dark-border text-gray-500 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isUnassigned && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Editing targets for <strong>{selectedLoc?.name}</strong> — a site you don't manage.
        </div>
      )}

      {loading ? <div className="flex justify-center py-12"><TmLoader /></div> : (
        <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
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
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Labor Budget — Regular Hours</label>
              <input type="number" min="0" value={form.labor_hours_non_salary} onChange={e => setForm(f => ({ ...f, labor_hours_non_salary: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Labor Budget — With Salary</label>
              <input type="number" min="0" value={form.labor_hours_with_salary} onChange={e => setForm(f => ({ ...f, labor_hours_with_salary: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div className="mt-4">
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : existing ? 'Update Targets' : 'Save Targets'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BudgetTrackingSection({ locations, allLocations, profile, initialTab, onSaved }) {
  const canManageTargets = profile?.role === 'admin' || profile?.role === 'area_manager'
  const [tab, setTab] = useState(initialTab || 'daily')

  const TABS = [
    { id: 'daily',       label: 'Daily Entry' },
    ...(canManageTargets ? [{ id: 'targets', label: 'Targets' }] : []),
  ]

  if (!locations.length) {
    return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Budget Tracking enabled yet. Turn it on in Admin → Locations.</div>
  }

  return (
    <div className="space-y-4">
      {TABS.length > 1 && (
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-tm-dark-border shadow-sm w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 text-xs font-brand font-semibold transition-colors border-r last:border-r-0 border-gray-200 dark:border-tm-dark-border ${
                tab === t.id ? 'bg-tm-blue dark:bg-tm-navy text-white' : 'bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'daily'   && <DailyEntryTab locations={locations} profile={profile} onSaved={onSaved} />}
      {tab === 'targets' && canManageTargets && <TargetsTab locations={locations} allLocations={allLocations} />}
    </div>
  )
}
