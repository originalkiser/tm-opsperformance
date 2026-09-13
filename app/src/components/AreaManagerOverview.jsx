import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { isCurrentlyOpen } from '../utils/operatingHours'
import { yesterdayMetrics, mtdMetrics, pct1, toDateStr } from '../utils/budgetMath'
import { morningEntryStatus, STATUS_LABEL } from '../utils/morningStatus'
import { ownershipLogStatus } from '../utils/ownershipLog'

const todayStr = () => toDateStr(new Date())

const STALE_HOURLY_MS = 2 * 60 * 60 * 1000 // 2 hours

function fmtWhen(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time
}

function Flag({ children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.28 11.164c.75 1.334-.213 2.987-1.742 2.987H3.72c-1.53 0-2.492-1.653-1.743-2.987L8.257 3.1zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
      {children}
    </span>
  )
}

function OkBadge({ children }) {
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{children}</span>
}

function WarnBadge({ children }) {
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">{children}</span>
}

function MutedBadge({ children }) {
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted">{children}</span>
}

function StatusBadgeFor(status) {
  if (status === 'complete') return <OkBadge>{STATUS_LABEL.complete}</OkBadge>
  if (status === 'pending')  return <WarnBadge>{STATUS_LABEL.pending}</WarnBadge>
  if (status === 'overdue')  return <Flag>{STATUS_LABEL.overdue}</Flag>
  return <MutedBadge>{STATUS_LABEL.none}</MutedBadge>
}

export default function AreaManagerOverview({ locations }) {
  const [latestLogs, setLatestLogs]       = useState([]) // one daily_logs row per site (most recent update)
  const [budgetEntries, setBudgetEntries] = useState([]) // one budget_daily_entries row per site (most recent)
  const [ownershipToday, setOwnershipToday] = useState([]) // today's ownership_log_entries per site
  const [globalHours, setGlobalHours]     = useState(null)
  const [loading, setLoading]             = useState(true)
  const [now, setNow]                     = useState(new Date())

  const budgetLocations    = locations.filter(l => l.show_budget_tracking)
  const ownershipLocations = locations.filter(l => l.show_ownership_tools)

  useEffect(() => { fetchAll() }, [locations])

  // Keep "time since last update" and the morning-status escalation current
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const fetchAll = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setLoading(false); return }

    const queries = [
      supabase.from('daily_logs').select('location_id, log_date, time_slot, updated_at')
        .in('location_id', locIds).order('updated_at', { ascending: false }),
      supabase.from('app_settings').select('value').eq('key', 'operating_hours').maybeSingle(),
    ]
    if (budgetLocations.length) {
      queries.push(
        supabase.from('budget_daily_entries').select('*')
          .in('location_id', budgetLocations.map(l => l.id)).order('entry_date', { ascending: false }),
      )
    }
    if (ownershipLocations.length) {
      queries.push(
        supabase.from('ownership_log_entries').select('*')
          .in('location_id', ownershipLocations.map(l => l.id)).eq('log_date', todayStr()),
      )
    }

    const results = await Promise.all(queries)
    const [{ data: logs }, { data: hours }] = results
    let idx = 2
    const budgetData = budgetLocations.length ? results[idx++].data : []
    const ownershipData = ownershipLocations.length ? results[idx++].data : []

    // Keep only the latest row per location for logs / budget entries
    const firstPerLoc = (rows) => {
      const seen = {}
      ;(rows || []).forEach(r => { if (!seen[r.location_id]) seen[r.location_id] = r })
      return Object.values(seen)
    }
    setLatestLogs(firstPerLoc(logs))
    setBudgetEntries(firstPerLoc(budgetData))
    setOwnershipToday(ownershipData || [])
    setGlobalHours(hours?.value || null)
    setLoading(false)
  }

  const rows = useMemo(() => {
    return locations.map(loc => {
      const lastLog   = latestLogs.find(r => r.location_id === loc.id)
      const openNow   = isCurrentlyOpen(loc, globalHours, now)
      const ageMs     = lastLog?.updated_at ? now - new Date(lastLog.updated_at) : Infinity
      const hourlyStale = openNow && ageMs > STALE_HOURLY_MS

      let budget = null
      if (loc.show_budget_tracking) {
        const entry = budgetEntries.find(r => r.location_id === loc.id)
        const hasToday = entry?.entry_date === todayStr()
        const status = morningEntryStatus(hasToday, loc.timezone, now)
        budget = { entry, status, yst: yesterdayMetrics(entry), mtd: mtdMetrics(entry) }
      }

      let ownership = null
      if (loc.show_ownership_tools) {
        const entry = ownershipToday.find(r => r.location_id === loc.id)
        ownership = { entry, status: ownershipLogStatus(entry, loc.timezone, now) }
      }

      const flagged = hourlyStale || budget?.status === 'overdue' || ownership?.status === 'overdue'
      return { loc, lastLog, openNow, ageMs, hourlyStale, budget, ownership, flagged }
    }).sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0))
  }, [locations, latestLogs, budgetEntries, ownershipToday, globalHours, now])

  const flaggedCount = rows.filter(r => r.flagged).length

  if (loading) return <div className="flex justify-center py-12"><TmLoader /></div>
  if (!locations.length) return <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-8 text-center">No sites to show.</div>

  return (
    <div className="space-y-3">
      {flaggedCount > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-xs text-red-700 dark:text-red-400 font-brand font-semibold">
          {flaggedCount} site{flaggedCount !== 1 ? 's' : ''} need attention
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map(r => (
          <div
            key={r.loc.id}
            className={`rounded-xl border p-4 ${
              r.flagged
                ? 'border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10'
                : 'border-gray-100 dark:border-tm-dark-border bg-white dark:bg-tm-dark-surface'
            }`}
          >
            <div className="font-brand font-bold text-sm text-tm-blue dark:text-tm-teal mb-2">{r.loc.name}</div>

            {/* Hourly update freshness */}
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-gray-400 dark:text-tm-dark-muted">Last update</span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-600 dark:text-tm-dark-text">{fmtWhen(r.lastLog?.updated_at)}</span>
                {r.hourlyStale && <Flag>Stale ({Math.round(r.ageMs / 3600000)}h)</Flag>}
              </div>
            </div>

            {/* Budget Tracking */}
            {r.budget && (
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gray-400 dark:text-tm-dark-muted">Budget entry</span>
                <div className="flex items-center gap-1.5">
                  {r.budget.entry && (
                    <span className="text-gray-600 dark:text-tm-dark-text">MTD Conv {pct1(r.budget.mtd.conversion)}</span>
                  )}
                  {StatusBadgeFor(r.budget.status)}
                </div>
              </div>
            )}

            {/* Ownership Log */}
            {r.ownership && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400 dark:text-tm-dark-muted">Ownership post</span>
                {StatusBadgeFor(r.ownership.status)}
              </div>
            )}

            {!r.budget && !r.ownership && (
              <div className="text-[10px] text-gray-300 dark:text-tm-dark-muted italic mt-1">Budget Tracking / Ownership Tools not enabled for this site</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
