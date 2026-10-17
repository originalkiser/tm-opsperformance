import AdminCashOnHandPanel from './AdminCashOnHandPanel'
import CashReconciliationSection from './CashReconciliationSection'
import BudgetRevenueFields from './BudgetRevenueFields'
import { reportedRevenuePace } from '../utils/budgetRevenueReporting'
import { useAuth } from '../contexts/AuthContext'
import { calculateMtdRevenue, fetchRevenueEntries, latestHistoricalRevenue, fetchStartingBalances } from '../utils/budgetRevenue'
import useBudgetDailyEntry from '../hooks/useBudgetDailyEntry'
import BudgetRevenueSummary from './BudgetRevenueSummary'
import BudgetRevenueNotes from './BudgetRevenueNotes'
import BudgetScoreDetails from './BudgetScoreDetails'
import BudgetCashCell from './BudgetCashCell'
import { reportCash, reportMetricFormatting } from '../utils/budgetReportFormatting'
import { REPORT_STATUS_CLS } from '../utils/metricColors'
import { scoreBudgetLocations } from '../utils/budgetScoring'
import { watchBudgetReport } from '../utils/budgetReportRefresh'
import { displayMoney, displayCount, revenueDisplayPlan } from '../utils/budgetDisplay'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { PaceBadge } from './BudgetTrackingSection'
import {
  toDateStr, firstOfMonth,
  yesterdayMetrics, mtdMetrics, membershipStatus, membershipPace,
  pct1,
} from '../utils/budgetMath'
import {
  YESTERDAY_FIELDS, MTD_FIELDS,
  isFieldMissing, isDayComplete,

} from '../utils/budgetDailyFields'
const todayStr = () => toDateStr(new Date())

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
    </svg>
  )
}

// ── Edit modal — Daily Entry, scoped to one site ──────────────────────────────

function DailyEntryPane({ location }) {
  const { profile } = useAuth()
  const [entryDate, setEntryDate] = useState(todayStr)
  const { form, entry, target, loading, saving, attemptedSave, error, saved, set, missing, revenueError, mtdRevenue, historicalRevenue, handleSave } = useBudgetDailyEntry(location.id, entryDate)
  const rev = error ? { pct: null, onTrack: null, reported: {} } : reportedRevenuePace(mtdRevenue, historicalRevenue, target?.revenue_goal)

  const baseInputCls = 'w-full border-2 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 font-brand'
  const fieldCls = (key) => {
    if (!isFieldMissing(form, key)) return `${baseInputCls} border-gray-300 dark:border-tm-dark-border focus:ring-tm-teal`
    return attemptedSave
      ? `${baseInputCls} border-red-500 focus:ring-red-400`
      : `${baseInputCls} border-orange-400 focus:ring-orange-300`
  }
  const complete = isDayComplete(entry)



  return (
    <div className={`space-y-4 ${complete ? 'rounded-xl ring-2 ring-green-200 dark:ring-green-900/40 p-3 -m-3' : ''}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-tm-dark-muted">Editing {entryDate}'s entry — resets fresh each new day.</p>
        {complete && (
          <span className="flex items-center gap-1 text-[10px] font-brand font-bold text-green-600 dark:text-green-400 whitespace-nowrap">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd"/></svg>
            Done
          </span>
        )}
      </div>
<label className="block text-xs mb-3">Morning entry date (revenue is for the prior business day)
        <input aria-label="Morning entry date" type="date" max={todayStr()} value={entryDate} disabled={saving} onChange={e => { if (e.target.value && e.target.value <= todayStr()) setEntryDate(e.target.value) }} className="ml-2 border rounded p-1 text-gray-800" />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {revenueError && <p role="alert" className="text-sm text-red-600">{revenueError}</p>}
      {saved && <p role="status" className="text-sm text-green-600">Entry saved.</p>}
      <fieldset disabled={saving || loading || !!error}>
      <div className="grid grid-cols-2 gap-3">
        {[...YESTERDAY_FIELDS, ...MTD_FIELDS].map(f => (
          <div key={f.key}>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">
              {f.label}{f.hint && <span className="block normal-case italic text-gray-400">{f.hint}</span>}
            </label>
            <input type="number" min="0" aria-label={f.label} value={form[f.key]} onChange={e => set(f.key, e.target.value)} className={fieldCls(f.key)} />
          </div>
        ))}
        <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3"><BudgetRevenueFields form={form} set={set} fieldCls={fieldCls} /></div>
        <CashReconciliationSection attemptedSave={attemptedSave} showExpected={profile?.role === 'admin'} locationId={location.id} timeZone={location.timezone} entryDate={entryDate} form={form} entry={entry} set={set} disabled={saving || loading || !!error} />
         <div>

          <BudgetRevenueSummary revenue={mtdRevenue} historical={historicalRevenue} />
          <div className="mt-2 text-xs text-gray-800 dark:text-gray-100">Revenue %: {pct1(rev.pct)} · Revenue Pace: {rev.onTrack == null ? '—' : rev.onTrack ? 'On Track' : 'Off Track'}{rev.reported.provisional && <span className="block text-amber-800 dark:text-amber-300">Provisional · through {rev.reported.throughDate}</span>}</div>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">Current Total Members</label>
          <input type="number" min="0" value={form.mtd_membership_actual} onChange={e => set('mtd_membership_actual', e.target.value)} className={fieldCls('mtd_membership_actual')} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">MTD REVIEWS</label>
          <input type="number" min="0" value={form.current_reviews} onChange={e => set('current_reviews', e.target.value)} className={fieldCls('current_reviews')} />
        </div>
              <div>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-0.5">GOOGLE RATING</label>
          <input type="number" min="0" max="5" step="0.01" value={form.current_rating} onChange={e => set('current_rating', e.target.value)} className={fieldCls('current_rating')} />
        </div>
      </div>
</fieldset>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving || loading || !!error || !!revenueError} className="px-4 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-xs hover:brightness-110 transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : entry ? 'Update Entry' : 'Save Entry'}
        </button>
        {attemptedSave && missing > 0 && (
          <span className="text-[10px] font-brand font-bold text-red-600 dark:text-red-400">
            {missing} field{missing !== 1 ? 's' : ''} need{missing === 1 ? 's' : ''} to be updated
          </span>
        )}
      </div>
    </div>
  )
}

function EditModal({ location, onClose }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div className="font-brand font-bold text-sm">{location.name}</div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          <p className="text-[10px] text-gray-400 dark:text-tm-dark-muted mb-3">
            Editing daily entries — monthly targets are managed on the <strong>AM Entry</strong> page.
          </p>
          <DailyEntryPane location={location} />
        </div>
      </div>
    </div>
  )
}

// ── Main report ───────────────────────────────────────────────────────────────

export default function BudgetTrackingReport({ locations }) {
  const { profile } = useAuth()
  const [targets, setTargets]     = useState([])
  const [dailyEntries, setDailyEntries] = useState([])
  const [startingBalances, setStartingBalances] = useState([])
  const [loading, setLoading]     = useState(true)
  const [reportError, setReportError] = useState('')
  const [editingLoc, setEditingLoc] = useState(null)

  useEffect(() => {
    fetchAll()
    return watchBudgetReport(() => fetchAll(false))
  }, [locations])

  const fetchAll = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setLoading(false); return }

    setReportError('')
    try {
      const [result, entries, balances] = await Promise.all([
        supabase.from('budget_targets').select('*').in('location_id', locIds).eq('target_month', firstOfMonth(todayStr())),
        fetchRevenueEntries(supabase, locIds, todayStr()),
        fetchStartingBalances(supabase, locIds, todayStr()),
      ])
      if (result.error) throw result.error
      setTargets(result.data || [])
      setDailyEntries(entries)
      setStartingBalances(balances)
    } catch {
      setDailyEntries([])
      setReportError('Unable to load the report. Revenue totals and pace are unavailable; please reload.')
    } finally { setLoading(false) }
  }

  const rows = useMemo(() => {
    const scoring = scoreBudgetLocations({ locations, targets, entries: dailyEntries, balances: startingBalances }, todayStr())
    return scoring.rows.map(scoringResult => {
      const loc = scoringResult.loc
      const target = targets.find(t => t.location_id === loc.id)
      const entry  = dailyEntries.filter(e => e.location_id === loc.id).sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0]
      const yst    = yesterdayMetrics(entry)
      const mtd    = mtdMetrics(entry)
      const revenue = calculateMtdRevenue(dailyEntries, loc.id, todayStr(), startingBalances.find(balance => balance.location_id === loc.id))
      const historicalRevenue = latestHistoricalRevenue(dailyEntries, loc.id, todayStr(), revenue.startingBalance)
      const rev    = reportedRevenuePace(revenue, historicalRevenue, target?.revenue_goal)
      const mem    = membershipStatus(entry?.mtd_membership_actual, target?.membership_goal, todayStr())
      const memPace = membershipPace(entry?.mtd_membership_actual, target?.starting_members, target?.membership_daily_growth, todayStr())
      const plan = revenueDisplayPlan(revenue, historicalRevenue, target?.revenue_goal)
      const formatting = reportMetricFormatting(entry, target, loc, todayStr(), plan, rev.reported)
      const cash = reportCash(entry, todayStr())
      return { loc, target, entry, yst, mtd, rev, mem, memPace, score: scoringResult.score, rank: scoringResult.rank, scoringResult, revenue, historicalRevenue, plan, formatting, cash }
    })
  }, [locations, targets, dailyEntries, startingBalances])

  const cashTools = profile?.role === 'admin' && <AdminCashOnHandPanel locations={locations} />
  if (loading) return <div>{cashTools}<div className="flex justify-center py-12"><TmLoader /></div></div>
  if (reportError) return <div>{cashTools}<p role="alert" className="text-red-600">{reportError}</p></div>
  if (!locations.length) return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-10 text-center">No sites have Budget Tracking enabled yet. Turn it on in Admin → Locations.</div>

  return (
    <div>
      {cashTools}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
        <table className="w-full text-xs font-brand border-collapse">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              <th className="px-3 py-2 text-center">Rank</th>
              <th className="px-3 py-2 text-left">Site</th>
              <th className="px-3 py-2 text-center">Yesterday Conv</th>
              <th className="px-3 py-2 text-center">Yesterday P-Mix</th>
              <th className="px-3 py-2 text-center">Yesterday CASH</th>
              <th className="px-3 py-2 text-center">MTD Conv</th>
              <th className="px-3 py-2 text-center">MTD P-Mix</th>
              <th className="px-3 py-2 text-center">MTD Revenue</th>
              <th className="px-3 py-2 text-center">Revenue %</th>
              <th className="px-3 py-2 text-center">MTD Goal %</th>
              <th className="px-3 py-2 text-center">Active Members</th>
              <th className="px-3 py-2 text-center">Membership Pace</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-center">Rating</th>
              <th className="px-3 py-2 text-center">Score</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.loc.id} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                <td className="px-3 py-2 text-center font-bold text-tm-blue dark:text-tm-teal">{r.score != null && r.entry ? r.rank : 'Unranked'}</td>
                <td className="px-3 py-2 font-semibold text-gray-700 dark:text-tm-dark-text whitespace-nowrap">{r.loc.name}</td>
                <td className={`px-3 py-2 text-center font-semibold ${REPORT_STATUS_CLS[r.formatting.yesterdayConversion]}`}>{pct1(r.formatting.yesterdayAvailable ? r.yst.conversion : null)}</td>
                <td className={`px-3 py-2 text-center font-semibold ${REPORT_STATUS_CLS[r.formatting.yesterdayPmix]}`}>{pct1(r.formatting.yesterdayAvailable ? r.yst.pmix : null)}</td>
                <td className="px-3 py-2 text-center"><BudgetCashCell cash={r.cash} /></td>
                <td className={`px-3 py-2 text-center font-semibold ${REPORT_STATUS_CLS[r.formatting.mtdConversion]}`}>{pct1(r.formatting.mtdAvailable ? r.mtd.conversion : null)}</td>
                <td className={`px-3 py-2 text-center font-semibold ${REPORT_STATUS_CLS[r.formatting.mtdPmix]}`}>{pct1(r.formatting.mtdAvailable ? r.mtd.pmix : null)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap w-28 text-gray-800 dark:text-gray-100" aria-label={`${r.rev.reported.provisional ? 'Provisional ' : ''}MTD Revenue through ${r.rev.reported.throughDate || 'unavailable'}`}>{displayMoney(r.rev.reported.amount)}</td>
                <td className={`px-3 py-2 text-center font-semibold ${REPORT_STATUS_CLS[r.formatting.revenue]}`}>{pct1(r.rev.pct)}{r.formatting.provisional && <span className="block text-[10px] font-normal">Provisional</span>}{r.formatting.stale && <span className="block text-[10px] font-normal">Stale entry</span>}</td>
                <td className="px-3 py-2 text-center text-gray-800 dark:text-gray-100">{pct1(r.plan.progress)}</td>
                <td className="px-3 py-2 text-center text-gray-800 dark:text-gray-100">{displayCount(r.entry?.mtd_membership_actual)}</td>
                <td className="px-3 py-2 text-center">{r.formatting.membershipOnTrack == null ? <span className={REPORT_STATUS_CLS.neutral}>—</span> : <PaceBadge onTrack={r.formatting.membershipOnTrack} label={r.formatting.membershipOnTrack ? 'On Track' : 'Off Track'} />}</td>
                <td className="px-3 py-2"><BudgetRevenueNotes revenue={r.revenue} historical={r.historicalRevenue} monthlyGoal={r.target?.revenue_goal} /></td>
                <td className="px-3 py-2 text-center text-gray-700 dark:text-tm-dark-text">{r.entry?.current_rating ?? '—'}</td>
                <td className="px-3 py-2 text-center"><BudgetScoreDetails result={r.scoringResult} /></td>
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
        <EditModal location={editingLoc} onClose={() => { setEditingLoc(null); fetchAll() }} />
      )}
    </div>
  )
}
