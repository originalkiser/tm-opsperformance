import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import {
  toDateStr, firstOfMonth, monthProgress,
  yesterdayMetrics, mtdMetrics, revenuePace, membershipStatus,
  mtdMembershipActualFromLogs, computeScore, rankByScore, pct1,
} from '../utils/budgetMath'

const todayStr = () => toDateStr(new Date())

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

function PaceBadge({ onTrack, label }) {
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

function BonusBadge({ tier }) {
  const cls = tier === 'Off Track'
    ? 'bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted'
    : 'bg-tm-teal/20 text-tm-blue dark:bg-tm-teal/15 dark:text-tm-teal'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cls}`}>{tier}</span>
}

// ── Leaderboard tab ───────────────────────────────────────────────────────────

function Leaderboard({ locations }) {
  const [targets, setTargets]     = useState([])
  const [dailyEntries, setDailyEntries] = useState([])
  const [monthLogs, setMonthLogs] = useState([])
  const [loading, setLoading]     = useState(true)

  const currentMonth = firstOfMonth(todayStr())

  useEffect(() => { fetchAll() }, [locations])

  const fetchAll = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setLoading(false); return }

    const [{ data: t }, { data: de }, { data: ml }] = await Promise.all([
      supabase.from('budget_targets').select('*').in('location_id', locIds).eq('target_month', currentMonth),
      supabase.from('budget_daily_entries').select('*').in('location_id', locIds).order('entry_date', { ascending: false }),
      supabase.from('daily_logs').select('location_id, log_date, time_slot, net_members, total_washes, member_washes, google_reviews, basic, good, better, best')
        .in('location_id', locIds).gte('log_date', currentMonth).lte('log_date', todayStr()),
    ])
    setTargets(t || [])
    // Keep only the latest entry per location
    const latestByLoc = {}
    ;(de || []).forEach(row => { if (!latestByLoc[row.location_id]) latestByLoc[row.location_id] = row })
    setDailyEntries(Object.values(latestByLoc))
    setMonthLogs(ml || [])
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
      const locLogs = monthLogs.filter(r => r.location_id === loc.id)
      const membershipActual = mtdMembershipActualFromLogs(locLogs)
      const mem    = membershipStatus(membershipActual, target?.membership_goal, todayStr())
      const score  = computeScore({
        yesterdayConv: yst.conversion, mtdConv: mtd.conversion, mtdPmix: mtd.pmix,
        membershipProgressRatio: mem.progressRatio, currentRating: entry?.current_rating,
      })
      return { loc, target, entry, yst, mtd, rev, mem, score }
    })
    return rankByScore(built)
  }, [locations, targets, dailyEntries, monthLogs])

  if (loading) return <div className="flex justify-center py-12"><TmLoader /></div>
  if (!locations.length) return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Budget Tracking enabled yet.</div>

  return (
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Daily Entry tab ───────────────────────────────────────────────────────────

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
    .concat([['mtd_revenue_actual', ''], ['current_rating', ''], ['current_reviews', '']]))
}

function DailyEntryTab({ locations, profile }) {
  const [selectedLocId, setSelectedLocId] = useState(() => profile?.location_id || locations[0]?.id || '')
  const [entry, setEntry]   = useState(null)
  const [form, setForm]     = useState(emptyDailyForm())
  const [target, setTarget] = useState(null)
  const [monthLogs, setMonthLogs] = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    if (!selectedLocId && locations[0]) setSelectedLocId(locations[0].id)
  }, [locations])

  useEffect(() => { if (selectedLocId) fetchData() }, [selectedLocId])

  const fetchData = async () => {
    setLoading(true)
    const currentMonth = firstOfMonth(todayStr())
    const [{ data: entries }, { data: t }, { data: logs }] = await Promise.all([
      supabase.from('budget_daily_entries').select('*').eq('location_id', selectedLocId).eq('entry_date', todayStr()).maybeSingle(),
      supabase.from('budget_targets').select('*').eq('location_id', selectedLocId).eq('target_month', currentMonth).maybeSingle(),
      supabase.from('daily_logs').select('log_date, time_slot, net_members, total_washes, member_washes')
        .eq('location_id', selectedLocId).gte('log_date', currentMonth).lte('log_date', todayStr()),
    ])
    const todays = entries || null
    setEntry(todays)
    setTarget(t || null)
    setMonthLogs(logs || [])
    setForm(todays ? Object.fromEntries(Object.keys(emptyDailyForm()).map(k => [k, todays[k] ?? ''])) : emptyDailyForm())
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
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
  }

  const yst = yesterdayMetrics(form)
  const mtd = mtdMetrics(form)
  const membershipActual = mtdMembershipActualFromLogs(monthLogs)
  const progress = monthProgress(todayStr())
  const rev = revenuePace(form.mtd_revenue_actual, target?.revenue_goal, progress)
  const mem = membershipStatus(membershipActual, target?.membership_goal, todayStr())

  const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand placeholder:text-gray-300'

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
          <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-sm border border-gray-100 dark:border-tm-dark-border p-5">
            <p className="text-xs text-gray-400 dark:text-tm-dark-muted mb-4">
              Enter fresh numbers each day — nothing carries over from yesterday's entry.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-brand font-bold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-2">Yesterday</h4>
                <div className="space-y-2">
                  {YESTERDAY_FIELDS.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 dark:text-tm-dark-muted w-36 shrink-0">{f.label}</label>
                      <input type="number" min="0" placeholder="0" value={form[f.key]} onChange={e => set(f.key, e.target.value)} className={inputCls} />
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
                      <label className="text-xs text-gray-500 dark:text-tm-dark-muted w-36 shrink-0">{f.label}</label>
                      <input type="number" min="0" placeholder="0" value={form[f.key]} onChange={e => set(f.key, e.target.value)} className={inputCls} />
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
                <input type="number" min="0" step="0.01" placeholder="0" value={form.mtd_revenue_actual} onChange={e => set('mtd_revenue_actual', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Current Rating</label>
                <input type="number" min="0" max="5" step="0.01" placeholder="4.85" value={form.current_rating} onChange={e => set('current_rating', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Current Reviews</label>
                <input type="number" min="0" placeholder="0" value={form.current_reviews} onChange={e => set('current_reviews', e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="mt-4">
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : entry ? 'Update Today’s Numbers' : 'Save Today’s Numbers'}
              </button>
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
              <div className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal">{membershipActual}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">goal {target?.membership_goal ?? '—'} · auto-calculated from daily logs</div>
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

export default function BudgetTrackingSection({ locations, allLocations, profile }) {
  const [tab, setTab] = useState('leaderboard')
  const canManageTargets = profile?.role === 'admin' || profile?.role === 'area_manager'

  const TABS = [
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'daily',       label: 'Daily Entry' },
    ...(canManageTargets ? [{ id: 'targets', label: 'Targets' }] : []),
  ]

  if (!locations.length) {
    return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Budget Tracking enabled yet. Turn it on in Admin → Locations.</div>
  }

  return (
    <div className="space-y-4">
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

      {tab === 'leaderboard' && <Leaderboard locations={locations} />}
      {tab === 'daily'       && <DailyEntryTab locations={locations} profile={profile} />}
      {tab === 'targets' && canManageTargets && <TargetsTab locations={locations} allLocations={allLocations} />}
    </div>
  )
}
