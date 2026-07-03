import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { shopTotals } from '../utils/logMath'
import { pmixTextCls, convTextCls, pmixCls, convCls } from '../utils/metricColors'

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const TIME_SLOT_LABELS = {
  '08:00:00': '8:00 AM',
  '09:00:00': '9:00 AM',
  '10:00:00': '10:00 AM',
  '11:00:00': '11:00 AM',
  '12:00:00': '12:00 PM',
  '13:00:00': '1:00 PM',
  '14:00:00': '2:00 PM',
  '15:00:00': '3:00 PM',
  '16:00:00': '4:00 PM',
  '17:00:00': '5:00 PM',
  '18:00:00': '6:00 PM',
  '19:00:00': '7:00 PM',
  '20:00:00': '8:00 PM',
}

const OFFSETS = [
  { label: 'Today',      offset: 0 },
  { label: 'Yesterday',  offset: 1 },
  { label: '2 Days Ago', offset: 2 },
  { label: '3 Days Ago', offset: 3 },
]

function dateForOffset(offset) {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function shopStats(rows) {
  const latest = shopTotals(rows)
  if (!latest) return null
  const totTW     = toInt(latest.total_washes)
  const totMW     = toInt(latest.member_washes)
  const totGR     = toInt(latest.google_reviews)
  const totBasic  = toInt(latest.basic)
  const totGood   = toInt(latest.good)
  const totBetter = toInt(latest.better)
  const totBest   = toInt(latest.best)
  const totMS     = totBasic + totGood + totBetter + totBest
  const totOpp    = Math.max(0, totTW - totMW + totMS)
  const pMix      = totMS  > 0 ? ((totBetter + totBest) / totMS  * 100).toFixed(1) + '%' : '—'
  const conv      = totOpp > 0 ? (totMS / totOpp * 100).toFixed(1) + '%' : '—'
  return { totTW, totMW, totMS, totGR, pMix, conv }
}

// ── Expanded read-only hourly table ──────────────────────────────────────────

function HourlyTable({ rows, thresholds }) {
  const qualifying = [...rows]
    .sort((a, b) => (a.time_slot > b.time_slot ? 1 : -1))
    .filter(r => r.employee_name || [
      'google_reviews','total_washes','member_washes','basic','good','better','best','net_members',
    ].some(f => toInt(r[f]) > 0))

  if (!qualifying.length) {
    return (
      <div className="px-4 py-4 text-center text-xs text-gray-400 dark:text-tm-dark-muted font-brand">
        No data entered for this date.
      </div>
    )
  }

  const COLS = [
    { key: 'time_slot',     label: 'Time'           },
    { key: 'employee_name', label: 'Employee'        },
    { key: 'google_reviews',label: 'Google'          },
    { key: 'total_washes',  label: 'Total\nWashes'   },
    { key: 'member_washes', label: 'Member\nWashes'  },
    { key: 'basic',         label: 'Basic'           },
    { key: 'good',          label: 'Good'            },
    { key: 'better',        label: 'Better'          },
    { key: 'best',          label: 'Best'            },
    { key: 'net_members',   label: 'Net\nMembers'    },
    { key: '_ms',           label: 'Memberships',    computed: true },
    { key: '_opp',          label: 'Opps',           computed: true },
    { key: '_pmix',         label: 'P-Mix',          computed: true },
    { key: '_conv',         label: 'Conv',           computed: true },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs w-full min-w-[900px]">
        <thead>
          <tr className="bg-tm-blue dark:bg-tm-navy text-white">
            {COLS.map(c => (
              <th
                key={c.key}
                className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold whitespace-pre-line leading-tight text-center"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {qualifying.map((row, i) => {
            const basic  = toInt(row.basic)
            const good   = toInt(row.good)
            const better = toInt(row.better)
            const best   = toInt(row.best)
            const tw     = toInt(row.total_washes)
            const mw     = toInt(row.member_washes)
            const ms     = basic + good + better + best
            const opp    = Math.max(0, tw - mw + ms)
            const pmix   = ms  > 0 ? ((better + best) / ms  * 100).toFixed(1) + '%' : ''
            const conv   = opp > 0 ? (ms / opp * 100).toFixed(1) + '%' : ''

            const bg = i % 2 === 0
              ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt'
              : 'bg-white dark:bg-tm-dark-surface'

            const cell = (val, computed = false) => (
              <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-mono text-xs dark:text-tm-dark-text
                ${computed ? 'bg-tm-sky/30 dark:bg-tm-teal/10' : ''}`}>
                {val}
              </td>
            )

            return (
              <tr key={row.id} className={bg}>
                <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand text-xs text-gray-600 dark:text-tm-dark-muted font-medium">
                  {TIME_SLOT_LABELS[row.time_slot] ?? row.time_slot}
                </td>
                <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand text-xs dark:text-tm-dark-text">
                  {row.employee_name || ''}
                </td>
                {cell(toInt(row.google_reviews) || '')}
                {cell(toInt(row.total_washes)   || '')}
                {cell(toInt(row.member_washes)  || '')}
                {cell(toInt(row.basic)          || '')}
                {cell(toInt(row.good)           || '')}
                {cell(toInt(row.better)         || '')}
                {cell(toInt(row.best)           || '')}
                {cell(toInt(row.net_members)    || '')}
                {cell(ms  > 0 ? ms   : '', true)}
                {cell(opp > 0 ? opp  : '', true)}
                <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-mono text-xs font-semibold ${pmix ? pmixCls(pmix, thresholds) : 'bg-tm-sky/30 dark:bg-tm-teal/10 dark:text-tm-dark-text'}`}>{pmix}</td>
                <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-mono text-xs font-semibold ${conv ? convCls(conv, thresholds) : 'bg-tm-sky/30 dark:bg-tm-teal/10 dark:text-tm-dark-text'}`}>{conv}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Shop card ─────────────────────────────────────────────────────────────────

function ShopCard({ location, rows, expanded, onToggle }) {
  const hasData    = rows.length > 0
  const stats      = hasData ? shopStats(rows) : null
  const thresholds = location.metric_thresholds

  const lastUpdated = stats
    ? formatTime(rows.reduce((max, r) =>
        r.updated_at > max ? r.updated_at : max, rows[0].updated_at))
    : null

  const STATS = [
    { label: 'Total Washes',  value: stats?.totTW  || '—' },
    { label: 'Member Washes', value: stats?.totMW  || '—' },
    { label: 'Memberships',   value: stats?.totMS  || '—' },
    { label: 'Google',        value: stats?.totGR  || '—' },
    { label: 'P-Mix', value: stats?.pMix ?? '—', textCls: pmixTextCls(stats?.pMix, thresholds) },
    { label: 'Conv',  value: stats?.conv ?? '—', textCls: convTextCls(stats?.conv, thresholds) },
  ]

  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md overflow-hidden dark:border dark:border-tm-dark-border">
      {/* Header */}
      <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-4 py-2 flex items-center justify-between">
        <span className="font-brand font-bold text-sm">{location.name}</span>
        {lastUpdated ? (
          <span className="text-[11px] font-brand text-tm-teal/80">
            Last updated: {lastUpdated}
          </span>
        ) : (
          <span className="text-[11px] font-brand text-tm-dark-muted">No data</span>
        )}
      </div>

      {/* Totals row */}
      {hasData ? (
        <div className="px-4 py-3 grid grid-cols-3 sm:grid-cols-6 gap-2 border-b border-gray-100 dark:border-tm-dark-border">
          {STATS.map(({ label, value, textCls }) => (
            <div key={label} className="text-center">
              <div className="text-[10px] font-brand uppercase tracking-wide text-gray-400 dark:text-tm-dark-muted mb-0.5">
                {label}
              </div>
              <div className={`text-sm font-bold font-brand ${textCls || 'text-tm-blue dark:text-tm-dark-text'}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-tm-dark-border">
          <p className="text-xs text-center text-gray-400 dark:text-tm-dark-muted font-brand">
            No entries for this date.
          </p>
        </div>
      )}

      {/* Expand toggle */}
      <div className="flex justify-end px-4 py-1.5">
        <button
          onClick={onToggle}
          className="text-xs font-brand text-tm-teal hover:text-tm-blue dark:hover:text-white transition-colors"
        >
          {expanded ? '▴ Collapse' : '▾ Expand'}
        </button>
      </div>

      {/* Expanded hourly table */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-tm-dark-border">
          <HourlyTable rows={rows} thresholds={thresholds} />
        </div>
      )}
    </div>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard({ name }) {
  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md overflow-hidden dark:border dark:border-tm-dark-border">
      <div className="bg-tm-navy dark:bg-tm-dark-nav px-4 py-2">
        <span className="font-brand font-bold text-sm text-white">{name}</span>
      </div>
      <div className="px-4 py-4">
        <div className="h-6 bg-gray-100 dark:bg-tm-dark-card animate-pulse rounded" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NetworkDayView({ locations: locProp, date: dateProp }) {
  const { locations: authLocations } = useAuth()
  const locations = locProp ?? authLocations

  // Start at the prop date (range end); offset buttons override to a relative day
  const [selectedDate, setSelectedDate] = useState(() => dateProp || dateForOffset(0))
  const [logs, setLogs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(new Set())

  // When the prop date changes (range changed), follow it
  useEffect(() => {
    if (dateProp) setSelectedDate(dateProp)
  }, [dateProp])

  const dateStr   = selectedDate
  const dateLabel = formatDateLabel(dateStr)

  // Which offset button is currently active, if any (-1 = none)
  const activeOffset = OFFSETS.findIndex(o => dateForOffset(o.offset) === dateStr)

  useEffect(() => {
    if (!locations.length) return
    fetchLogs()
  }, [dateStr, locations])

  const fetchLogs = async () => {
    setLoading(true)
    const locationIds = locations.map(l => l.id)
    const { data } = await supabase
      .from('daily_logs')
      .select('*')
      .in('location_id', locationIds)
      .eq('log_date', dateStr)
    setLogs(data || [])
    setLoading(false)
  }

  const toggleExpand = (locId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(locId) ? next.delete(locId) : next.add(locId)
      return next
    })
  }

  const rowsByLoc = {}
  logs.forEach(r => {
    if (!rowsByLoc[r.location_id]) rowsByLoc[r.location_id] = []
    rowsByLoc[r.location_id].push(r)
  })

  return (
    <div>
      {/* Day selector */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-tm-dark-border shadow-sm">
          {OFFSETS.map(({ label, offset: off }, idx) => {
            const active  = activeOffset === idx
            const isFirst = idx === 0
            const isLast  = idx === OFFSETS.length - 1
            return (
              <button
                key={off}
                onClick={() => setSelectedDate(dateForOffset(off))}
                className={`px-3 py-1.5 text-xs font-brand font-semibold transition-colors border-r last:border-r-0 border-gray-200 dark:border-tm-dark-border
                  ${isFirst  ? 'rounded-l-lg' : ''}
                  ${isLast   ? 'rounded-r-lg' : ''}
                  ${active
                    ? 'bg-tm-blue dark:bg-tm-navy text-white'
                    : 'bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:border-tm-teal hover:text-tm-blue dark:hover:text-white'
                  }
                `}
              >
                {label}
              </button>
            )
          })}
        </div>
        <span className="text-tm-teal font-brand text-xs">{dateLabel}</span>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading
          ? locations.map(loc => <SkeletonCard key={loc.id} name={loc.name} />)
          : locations.map(loc => (
              <ShopCard
                key={loc.id}
                location={loc}
                rows={rowsByLoc[loc.id] || []}
                expanded={expanded.has(loc.id)}
                onToggle={() => toggleExpand(loc.id)}
              />
            ))
        }
      </div>
    </div>
  )
}
