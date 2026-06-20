import { useState, useEffect, useRef } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import NavBar from '../components/NavBar'
import NetworkDayView from '../components/NetworkDayView'

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const pct = (num, den) =>
  den > 0 ? (num / den * 100).toFixed(1) + '%' : ''

const agg = (rows) => {
  const tw  = rows.reduce((s, r) => s + toInt(r.total_washes),    0)
  const mw  = rows.reduce((s, r) => s + toInt(r.member_washes),   0)
  const ms  = rows.reduce((s, r) => s + toInt(r.memberships_sold),0)
  const opp = rows.reduce((s, r) => s + toInt(r.opportunities),   0)
  const btr = rows.reduce((s, r) => s + toInt(r.better),          0)
  const bst = rows.reduce((s, r) => s + toInt(r.best),            0)
  const gr  = rows.reduce((s, r) => s + toInt(r.google_reviews),  0)
  return {
    tw, mw, ms, opp, gr,
    p_mix:      pct(btr + bst, ms),
    conversion: pct(ms, opp),
  }
}

const getWeekStart = () => {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().split('T')[0]
}

const getMonthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const today = () => new Date().toISOString().split('T')[0]

// ── Shop multi-select ─────────────────────────────────────────────────────────

function ShopMultiSelect({ locations, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allSelected = selected.length === 0
  const label = allSelected
    ? 'All Shops'
    : selected.length === 1
      ? locations.find(l => l.id === selected[0])?.name ?? '1 shop'
      : `${selected.length} of ${locations.length} shops`

  const toggle = (id) => {
    if (selected.includes(id)) {
      const next = selected.filter(s => s !== id)
      onChange(next) // empty = all
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text hover:border-tm-teal focus:outline-none focus:ring-2 focus:ring-tm-teal transition-colors font-brand"
      >
        <span>{label}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[220px] py-1">
          {/* All shops toggle */}
          <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange([])}
              className="accent-tm-teal w-3.5 h-3.5"
            />
            <span className="text-xs font-brand font-semibold text-gray-700 dark:text-tm-dark-text">All Shops</span>
          </label>
          <div className="border-t border-gray-100 dark:border-tm-dark-border my-1" />
          {locations.map(loc => (
            <label
              key={loc.id}
              className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors"
            >
              <input
                type="checkbox"
                checked={allSelected || selected.includes(loc.id)}
                onChange={() => toggle(loc.id)}
                className="accent-tm-teal w-3.5 h-3.5"
              />
              <span className="text-xs font-brand text-gray-700 dark:text-tm-dark-text truncate">{loc.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Summary table ─────────────────────────────────────────────────────────────

function MetricTable({ data, locations }) {
  if (!data.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  const totals = agg(data)
  const byLoc  = {}
  data.forEach(r => { ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r) })

  const rows = Object.entries(byLoc)
    .map(([locId, rows]) => ({
      name: locations.find(l => l.id === locId)?.name || locId,
      ...agg(rows),
    }))
    .sort((a, b) => b.tw - a.tw)

  const maxWashes = Math.max(...rows.map(r => r.tw), 1)

  const MiniBar = ({ value, max }) => (
    <div className="flex items-center gap-1">
      <div className="flex-1 bg-gray-100 dark:bg-tm-dark-border rounded-full h-1.5 min-w-[40px]">
        <div
          className="bg-tm-teal h-1.5 rounded-full"
          style={{ width: max > 0 ? `${Math.min(100, value / max * 100)}%` : '0%' }}
        />
      </div>
      <span className="text-xs w-8 text-right dark:text-tm-dark-text">{value}</span>
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-tm-blue dark:bg-tm-navy text-white">
            {['Location','Total Washes','Member Washes','Memberships Sold','Opportunities','Google Reviews','P-Mix','Conversion'].map(h => (
              <th key={h} className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border text-left font-brand font-semibold tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-medium font-brand dark:text-tm-dark-text">{r.name}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2"><MiniBar value={r.tw} max={maxWashes} /></td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.mw || ''}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.ms || ''}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.opp || ''}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{r.gr || ''}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold text-orange-700 dark:text-orange-300">{r.p_mix}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold text-orange-700 dark:text-orange-300">{r.conversion}</td>
            </tr>
          ))}
          <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">Totals</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{totals.tw || ''}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{totals.mw || ''}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{totals.ms || ''}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{totals.opp || ''}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{totals.gr || ''}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300">{totals.p_mix}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300">{totals.conversion}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Daily trend charts ────────────────────────────────────────────────────────

const TEAL   = '#8ECFCB'
const ORANGE = '#ea580c'

const ChartTooltip = ({ active, payload, label, isPct }) => {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div className="bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded shadow-md px-3 py-2 text-xs font-brand">
      <p className="text-gray-500 dark:text-tm-dark-muted mb-1">Day {label}</p>
      <p className="font-semibold text-tm-blue dark:text-tm-teal">
        {val != null ? (isPct ? `${val}%` : val) : '—'}
      </p>
    </div>
  )
}

function MiniChart({ title, data, dataKey, color, isPct = false, type = 'bar', dark }) {
  const axisColor = dark ? '#7A9BBF' : '#6B7280'
  const gridColor = dark ? '#1E3A5F' : '#f0f0f0'
  const hasData = data.some(d => d[dataKey] != null && d[dataKey] > 0)

  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border shadow-sm p-4">
      <p className="text-xs font-brand font-semibold text-gray-600 dark:text-tm-dark-muted uppercase tracking-wide mb-3">{title}</p>
      {!hasData ? (
        <div className="h-32 flex items-center justify-center text-gray-300 dark:text-tm-dark-muted text-xs">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          {type === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} tickFormatter={v => isPct ? `${v}%` : v} />
              <Tooltip content={<ChartTooltip isPct={isPct} />} />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} connectNulls={false} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} />
              <Tooltip content={<ChartTooltip isPct={isPct} />} />
              <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}

function DailyTrends({ logs, dark, locations, trendLocId, onTrendLocChange }) {
  const dayMap = {}
  logs.forEach(r => {
    if (!dayMap[r.log_date]) dayMap[r.log_date] = []
    dayMap[r.log_date].push(r)
  })

  const chartData = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const day = parseInt(date.split('-')[2])
      const tw  = rows.reduce((s, r) => s + toInt(r.total_washes),    0)
      const mw  = rows.reduce((s, r) => s + toInt(r.member_washes),   0)
      const ms  = rows.reduce((s, r) => s + toInt(r.memberships_sold),0)
      const opp = rows.reduce((s, r) => s + toInt(r.opportunities),   0)
      const gr  = rows.reduce((s, r) => s + toInt(r.google_reviews),  0)
      const btr = rows.reduce((s, r) => s + toInt(r.better),          0)
      const bst = rows.reduce((s, r) => s + toInt(r.best),            0)
      return {
        day,
        tw, mw, ms, gr,
        conversion: opp > 0  ? parseFloat((ms       / opp * 100).toFixed(1)) : null,
        pmix:       ms  > 0  ? parseFloat(((btr+bst) / ms  * 100).toFixed(1)) : null,
      }
    })

  const navyColor = dark ? '#D6E4F0' : '#1A3555'
  const trendLocation = locations.find(l => l.id === trendLocId)

  const selectCls = "border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal"

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="bg-orange-600 text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">DAILY</span>
          <span className="text-sm text-gray-500 dark:text-tm-dark-muted">
            Month-to-date daily trends
            {trendLocation ? ` — ${trendLocation.name}` : ''}
          </span>
        </div>
        {locations.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-tm-dark-muted font-brand">Location:</label>
            <select value={trendLocId} onChange={e => onTrendLocChange(e.target.value)} className={selectCls}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {!chartData.length ? (
        <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <MiniChart title="Daily Memberships Sold"  data={chartData} dataKey="ms"         color={TEAL}      dark={dark} />
          <MiniChart title="Daily Conversion %"      data={chartData} dataKey="conversion" color={ORANGE}    dark={dark} type="line" isPct />
          <MiniChart title="Daily Google Reviews"    data={chartData} dataKey="gr"         color={navyColor} dark={dark} />
          <MiniChart title="Daily Total Washes"      data={chartData} dataKey="tw"         color={navyColor} dark={dark} />
          <MiniChart title="Daily P-Mix %"           data={chartData} dataKey="pmix"       color={ORANGE}    dark={dark} type="line" isPct />
          <MiniChart title="Daily Member Washes"     data={chartData} dataKey="mw"         color={TEAL}      dark={dark} />
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Insights() {
  const { locations } = useAuth()
  const [dark]                          = useDarkModeCtx()
  const [wtdLogs, setWtdLogs]           = useState([])
  const [mtdLogs, setMtdLogs]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedShops, setSelectedShops] = useState([]) // empty = all
  const [trendLocId, setTrendLocId]     = useState('')

  useEffect(() => {
    if (locations.length) {
      fetchAll()
      if (!trendLocId) setTrendLocId(locations[0]?.id ?? '')
    }
  }, [locations])

  // Keep trendLocId valid when shop filter changes
  useEffect(() => {
    if (!trendLocId) return
    const visible = selectedShops.length ? locations.filter(l => selectedShops.includes(l.id)) : locations
    if (!visible.find(l => l.id === trendLocId)) {
      setTrendLocId(visible[0]?.id ?? '')
    }
  }, [selectedShops])

  const fetchAll = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    const td = today()
    const [wtd, mtd] = await Promise.all([
      supabase.from('daily_logs').select('*').in('location_id', locIds).gte('log_date', getWeekStart()).lte('log_date', td),
      supabase.from('daily_logs').select('*').in('location_id', locIds).gte('log_date', getMonthStart()).lte('log_date', td),
    ])
    setWtdLogs(wtd.data || [])
    setMtdLogs(mtd.data || [])
    setLoading(false)
  }

  const visibleLocations = selectedShops.length
    ? locations.filter(l => selectedShops.includes(l.id))
    : locations

  const filterLogs = (logs) =>
    selectedShops.length ? logs.filter(r => selectedShops.includes(r.location_id)) : logs

  const trendLogs = mtdLogs.filter(r => r.location_id === trendLocId)

  const cardCls = "bg-white dark:bg-tm-dark-surface rounded-xl shadow-md p-5 dark:border dark:border-tm-dark-border"

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />
      <div className="max-w-screen-2xl mx-auto px-4 py-6">

        {/* Header + shop filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal tracking-wide">Dashboard</h1>
          {locations.length > 1 && (
            <ShopMultiSelect
              locations={locations}
              selected={selectedShops}
              onChange={setSelectedShops}
            />
          )}
        </div>

        {loading ? (
          <div className={`${cardCls} p-12 text-center text-gray-400 dark:text-tm-dark-muted`}>Loading…</div>
        ) : (
          <div className="space-y-8">

            {/* Network — today's snapshot across shops */}
            <div className={cardCls}>
              <div className="flex items-center gap-3 mb-5">
                <span className="bg-tm-blue text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">NETWORK</span>
                <span className="text-sm text-gray-500 dark:text-tm-dark-muted">Live day view across shops</span>
              </div>
              <NetworkDayView locations={visibleLocations} />
            </div>

            {/* WTD */}
            <div className={cardCls}>
              <div className="flex items-center gap-3 mb-4">
                <span className="bg-tm-blue text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">WTD</span>
                <span className="text-sm text-gray-500 dark:text-tm-dark-muted">Week to Date — {getWeekStart()} through {today()}</span>
              </div>
              <MetricTable data={filterLogs(wtdLogs)} locations={visibleLocations} />
            </div>

            {/* MTD */}
            <div className={cardCls}>
              <div className="flex items-center gap-3 mb-4">
                <span className="bg-emerald-700 text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">MTD</span>
                <span className="text-sm text-gray-500 dark:text-tm-dark-muted">Month to Date — {getMonthStart()} through {today()}</span>
              </div>
              <MetricTable data={filterLogs(mtdLogs)} locations={visibleLocations} />
            </div>

            {/* Daily trends */}
            <div className={cardCls}>
              <DailyTrends
                logs={trendLogs}
                dark={dark}
                locations={visibleLocations}
                trendLocId={trendLocId}
                onTrendLocChange={setTrendLocId}
              />
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
