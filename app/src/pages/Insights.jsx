import { useState, useEffect, useRef, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useDarkModeCtx } from '../contexts/DarkModeContext'
import NavBar from '../components/NavBar'
import NetworkDayView from '../components/NetworkDayView'
import TmLoader from '../components/TmLoader'
import DateSelector, { computeDateRange, fmtDateRange, loadSavedDateRange, saveDateRange } from '../components/DateSelector'
import { employeeDeltasByDay } from '../utils/logMath'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls, pmixHex, convHex } from '../utils/metricColors'
import { exportCsv, exportXlsx, exportPdf } from '../utils/exportTable'
import { fmtNum } from '../utils/format'

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const pct = (num, den) =>
  den > 0 ? (num / den * 100).toFixed(1) + '%' : ''

const pctN = (num, den) =>
  den > 0 ? parseFloat((num / den * 100).toFixed(1)) : null

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
    pmixN:      pctN(btr + bst, ms),
    convN:      pctN(ms, opp),
  }
}

// Collapse all hourly rows to one row per (location, date): the latest time_slot with data.
const toDayTotals = (rows) => {
  const map = {}
  rows.forEach(r => {
    const key = `${r.location_id}::${r.log_date}`
    if (!map[key]) map[key] = []
    map[key].push(r)
  })
  return Object.values(map).map(dayRows => {
    const withData = dayRows.filter(r =>
      toInt(r.total_washes) > 0 || toInt(r.member_washes) > 0 ||
      toInt(r.memberships_sold) > 0 || toInt(r.opportunities) > 0 ||
      toInt(r.google_reviews) > 0
    )
    const src = withData.length ? withData : dayRows
    return src.sort((a, b) => b.time_slot.localeCompare(a.time_slot))[0]
  })
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
    </svg>
  )
}

function SortIcon({ active, dir }) {
  if (!active) return <span className="ml-1 opacity-25 text-[10px]">↕</span>
  return <span className="ml-1 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
}

function useSortState(defaultCol, defaultDir = 'desc') {
  const [sort, setSort] = useState({ col: defaultCol, dir: defaultDir })
  const toggle = (col) => setSort(s => ({
    col,
    dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc',
  }))
  return [sort, toggle]
}

const parsePct = (v) => parseFloat(v) || 0

const thCls = 'px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide cursor-pointer select-none hover:bg-tm-navy/80 dark:hover:bg-tm-dark-border/60 transition-colors whitespace-nowrap'

// ── Export menu (CSV / Excel / PDF) ───────────────────────────────────────────

const EXPORTERS = { csv: exportCsv, xlsx: exportXlsx, pdf: exportPdf }

function ExportMenu({ spec }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const run = (fmt) => {
    setOpen(false)
    EXPORTERS[fmt](spec)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-brand font-semibold rounded-lg border border-gray-200 dark:border-tm-dark-border bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue hover:border-tm-teal dark:hover:text-white shadow-sm transition-colors"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M8.5 1.5a.5.5 0 00-1 0v7.793L5.354 7.146a.5.5 0 10-.708.708l3 3a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 9.293V1.5z"/>
          <path d="M2 11.5a.5.5 0 011 0v2a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-2a.5.5 0 011 0v2A1.5 1.5 0 0112.5 15.5h-9A1.5 1.5 0 012 13.5v-2z"/>
        </svg>
        Export
        <span className="text-gray-400 dark:text-tm-dark-muted text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[140px] py-1">
          {[
            { fmt: 'xlsx', label: 'Excel (.xlsx)' },
            { fmt: 'pdf',  label: 'PDF'           },
            { fmt: 'csv',  label: 'CSV'           },
          ].map(({ fmt, label }) => (
            <button
              key={fmt}
              onClick={() => run(fmt)}
              className="w-full px-4 py-2 text-left text-xs font-brand font-medium text-gray-700 dark:text-tm-dark-text hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Market multi-select ───────────────────────────────────────────────────────

function MarketMultiSelect({ markets, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allSelected  = selected === null || selected.length === markets.length
  const noneSelected = selected !== null && selected.length === 0

  const label = allSelected
    ? 'All Markets'
    : noneSelected
      ? 'No Markets'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} of ${markets.length} markets`

  const toggleAll = () => { allSelected ? onChange([]) : onChange(null) }

  const toggle = (market) => {
    const current = selected === null ? [...markets] : selected
    if (current.includes(market)) {
      onChange(current.filter(m => m !== market))
    } else {
      const next = [...current, market]
      onChange(next.length === markets.length ? null : next)
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
        <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-lg shadow-lg min-w-[200px] py-1">
          <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-tm-teal w-3.5 h-3.5" />
            <span className="text-xs font-brand font-semibold text-gray-700 dark:text-tm-dark-text">All Markets</span>
          </label>
          <div className="border-t border-gray-100 dark:border-tm-dark-border my-1" />
          {markets.map(market => (
            <label key={market} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
              <input
                type="checkbox"
                checked={allSelected || (selected !== null && selected.includes(market))}
                onChange={() => toggle(market)}
                className="accent-tm-teal w-3.5 h-3.5"
              />
              <span className="text-xs font-brand text-gray-700 dark:text-tm-dark-text">{market}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

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

  const allSelected  = selected === null || selected.length === locations.length
  const noneSelected = selected !== null && selected.length === 0

  const label = allSelected
    ? 'All Shops'
    : noneSelected
      ? 'No Shops'
      : selected.length === 1
        ? locations.find(l => l.id === selected[0])?.name ?? '1 shop'
        : `${selected.length} of ${locations.length} shops`

  const toggleAll = () => { allSelected ? onChange([]) : onChange(null) }

  const toggle = (id) => {
    const current = selected === null ? locations.map(l => l.id) : selected
    if (current.includes(id)) {
      onChange(current.filter(s => s !== id))
    } else {
      const next = [...current, id]
      onChange(next.length === locations.length ? null : next)
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
          <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-tm-teal w-3.5 h-3.5" />
            <span className="text-xs font-brand font-semibold text-gray-700 dark:text-tm-dark-text">All Shops</span>
          </label>
          <div className="border-t border-gray-100 dark:border-tm-dark-border my-1" />
          {locations.map(loc => (
            <label key={loc.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors">
              <input
                type="checkbox"
                checked={allSelected || (selected !== null && selected.includes(loc.id))}
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

// ── Site Performance table ────────────────────────────────────────────────────

function MetricTable({ data, locations, dateRange }) {
  const [sort, toggleSort] = useSortState('tw', 'desc')

  if (!data.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  const dayData = toDayTotals(data)
  const totals  = agg(dayData)
  const byLoc   = {}
  dayData.forEach(r => { ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r) })

  const rows = Object.entries(byLoc).map(([locId, rows]) => ({
    name: locations.find(l => l.id === locId)?.name || locId,
    ...agg(rows),
  }))

  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.col === 'name')       return dir * a.name.localeCompare(b.name)
    if (sort.col === 'p_mix')      return dir * (parsePct(a.p_mix) - parsePct(b.p_mix))
    if (sort.col === 'conversion') return dir * (parsePct(a.conversion) - parsePct(b.conversion))
    return dir * ((a[sort.col] ?? 0) - (b[sort.col] ?? 0))
  })

  const maxWashes = Math.max(...sorted.map(r => r.tw), 1)

  const MiniBar = ({ value, max }) => (
    <div className="flex items-center gap-1">
      <div className="flex-1 bg-gray-100 dark:bg-tm-dark-border rounded-full h-1.5 min-w-[40px]">
        <div className="bg-tm-teal h-1.5 rounded-full" style={{ width: max > 0 ? `${Math.min(100, value / max * 100)}%` : '0%' }} />
      </div>
      <span className="text-xs w-12 text-right dark:text-tm-dark-text">{fmtNum(value) || value}</span>
    </div>
  )

  const COLS = [
    { key: 'name',       label: 'Location',        align: 'left'   },
    { key: 'tw',         label: 'Total Washes',     align: 'left'   },
    { key: 'mw',         label: 'Member Washes',    align: 'center' },
    { key: 'ms',         label: 'Memberships Sold', align: 'center' },
    { key: 'opp',        label: 'Opportunities',    align: 'center' },
    { key: 'gr',         label: 'Google Reviews',   align: 'center' },
    { key: 'p_mix',      label: 'P-Mix',            align: 'center' },
    { key: 'conversion', label: 'Conversion',       align: 'center' },
  ]

  const exportSpec = {
    filename: `site-performance_${dateRange.start}_to_${dateRange.end}`,
    title:    'Site Performance',
    subtitle: fmtDateRange(dateRange.start, dateRange.end),
    columns: [
      { label: 'Location',         type: 'text' },
      { label: 'Total Washes',     type: 'num'  },
      { label: 'Member Washes',    type: 'num'  },
      { label: 'Memberships Sold', type: 'num'  },
      { label: 'Opportunities',    type: 'num'  },
      { label: 'Google Reviews',   type: 'num'  },
      { label: 'P-Mix',            type: 'pmix' },
      { label: 'Conversion',       type: 'conv' },
    ],
    rows: sorted.map(r => [r.name, r.tw, r.mw, r.ms, r.opp, r.gr, r.p_mix, r.conversion]),
    totalsRow: ['Totals', totals.tw, totals.mw, totals.ms, totals.opp, totals.gr, totals.p_mix, totals.conversion],
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <ExportMenu spec={exportSpec} />
      </div>
      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-tm-blue dark:bg-tm-navy text-white">
            {COLS.map(c => (
              <th key={c.key} className={`${thCls} text-${c.align}`} onClick={() => toggleSort(c.key)}>
                {c.label}<SortIcon active={sort.col === c.key} dir={sort.dir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.name} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-medium font-brand dark:text-tm-dark-text">{r.name}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2"><MiniBar value={r.tw} max={maxWashes} /></td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.mw)}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.ms)}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.opp)}</td>
              <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(r.gr)}</td>
              <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
              <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
            </tr>
          ))}
          <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">Totals</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.tw)}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.mw)}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.ms)}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.opp)}</td>
            <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totals.gr)}</td>
            <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${pmixTotalsCls(totals.p_mix)}`}>{totals.p_mix}</td>
            <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${convTotalsCls(totals.conversion)}`}>{totals.conversion}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ── Team Member Sales table ───────────────────────────────────────────────────

function TMSalesRows({ rows, showSite, sort }) {
  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.col === 'name') return dir * a.name.localeCompare(b.name)
    if (sort.col === 'site') return dir * (a.site ?? '').localeCompare(b.site ?? '')
    if (sort.col === 'p_mix')      return dir * ((a.pmixN ?? -1) - (b.pmixN ?? -1))
    if (sort.col === 'conversion') return dir * ((a.convN ?? -1) - (b.convN ?? -1))
    return dir * ((a[sort.col] ?? 0) - (b[sort.col] ?? 0))
  })

  return (
    <>
      {sorted.map((r, i) => (
        <tr key={r.key} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 font-medium font-brand dark:text-tm-dark-text">{r.name}</td>
          {showSite && (
            <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-gray-500 dark:text-tm-dark-muted font-brand text-xs">{r.site}</td>
          )}
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-mono dark:text-tm-dark-text">{fmtNum(r.ms)}</td>
          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-mono dark:text-tm-dark-text">{fmtNum(r.gr)}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(r.p_mix)}`}>{r.p_mix}</td>
          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(r.conversion)}`}>{r.conversion}</td>
        </tr>
      ))}
    </>
  )
}

function TMSalesTotalsRow({ rows, showSite }) {
  let totMS = 0, totGR = 0, totBetter = 0, totBest = 0, totOpp = 0
  rows.forEach(r => {
    totMS     += r.ms      || 0
    totGR     += r.gr      || 0
    totBetter += r.better  || 0
    totBest   += r.best    || 0
    totOpp    += r.opp     || 0
  })
  const p_mix      = pct(totBetter + totBest, totMS)
  const conversion = pct(totMS, totOpp)
  return (
    <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 font-brand dark:text-tm-dark-text">Totals</td>
      {showSite && <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2" />}
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totMS)}</td>
      <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">{fmtNum(totGR)}</td>
      <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${pmixTotalsCls(p_mix)}`}>{p_mix}</td>
      <td className={`border border-gray-300 dark:border-tm-dark-border px-3 py-2 text-center ${convTotalsCls(conversion)}`}>{conversion}</td>
    </tr>
  )
}

function TeamMemberTable({ data, locations, dateRange }) {
  const [splitByShop, setSplitByShop] = useState(false)
  const [sort, toggleSort]            = useSortState('ms', 'desc')

  if (!data.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  const dayMap = {}
  data.forEach(r => {
    const key = `${r.location_id}::${r.log_date}`
    if (!dayMap[key]) dayMap[key] = { locationId: r.location_id, rows: [] }
    dayMap[key].rows.push(r)
  })

  const empAccum = {}
  Object.values(dayMap).forEach(({ locationId, rows }) => {
    const deltas = employeeDeltasByDay(rows)
    Object.entries(deltas).forEach(([name, d]) => {
      const key = `${locationId}::${name.toLowerCase()}`
      if (!empAccum[key]) {
        empAccum[key] = {
          key, name, locationId,
          site: locations.find(l => l.id === locationId)?.name ?? '',
          total_washes: 0, member_washes: 0, google_reviews: 0,
          basic: 0, good: 0, better: 0, best: 0,
        }
      }
      const e = empAccum[key]
      e.total_washes   += d.total_washes
      e.member_washes  += d.member_washes
      e.google_reviews += d.google_reviews
      e.basic          += d.basic
      e.good           += d.good
      e.better         += d.better
      e.best           += d.best
    })
  })

  const allRows = Object.values(empAccum).map(e => {
    const ms  = e.basic + e.good + e.better + e.best
    const opp = Math.max(0, e.total_washes - e.member_washes + ms)
    return {
      key:        e.key,
      name:       e.name,
      locationId: e.locationId,
      site:       e.site,
      ms, opp,
      gr:         e.google_reviews,
      better:     e.better,
      best:       e.best,
      pmixN:      pctN(e.better + e.best, ms),
      convN:      pctN(ms, opp),
      p_mix:      pct(e.better + e.best, ms),
      conversion: pct(ms, opp),
    }
  })

  if (!allRows.length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No employee data entered for this period.</div>
  )

  const TM_COLS_COMBINED = [
    { key: 'name',       label: 'Employee'       },
    { key: 'site',       label: 'Site'           },
    { key: 'ms',         label: 'Memberships'    },
    { key: 'gr',         label: 'Google Reviews' },
    { key: 'p_mix',      label: 'P-Mix'          },
    { key: 'conversion', label: 'Conversion'     },
  ]
  const TM_COLS_SPLIT = TM_COLS_COMBINED.filter(c => c.key !== 'site')

  const TableHead = ({ cols }) => (
    <thead>
      <tr className="bg-tm-blue dark:bg-tm-navy text-white">
        {cols.map(c => (
          <th key={c.key} className={`${thCls} text-left`} onClick={() => toggleSort(c.key)}>
            {c.label}<SortIcon active={sort.col === c.key} dir={sort.dir} />
          </th>
        ))}
      </tr>
    </thead>
  )

  let totMS = 0, totGR = 0, totBetter = 0, totBest = 0, totOpp = 0
  allRows.forEach(r => {
    totMS += r.ms || 0; totGR += r.gr || 0
    totBetter += r.better || 0; totBest += r.best || 0; totOpp += r.opp || 0
  })
  const exportSpec = {
    filename: `team-member-sales_${dateRange.start}_to_${dateRange.end}`,
    title:    'Team Member Sales',
    subtitle: fmtDateRange(dateRange.start, dateRange.end),
    columns: [
      { label: 'Employee',       type: 'text' },
      { label: 'Site',           type: 'text' },
      { label: 'Memberships',    type: 'num'  },
      { label: 'Google Reviews', type: 'num'  },
      { label: 'P-Mix',          type: 'pmix' },
      { label: 'Conversion',     type: 'conv' },
    ],
    rows: [...allRows]
      .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
      .map(r => [r.name, r.site, r.ms, r.gr, r.p_mix, r.conversion]),
    totalsRow: ['Totals', '', totMS, totGR, pct(totBetter + totBest, totMS), pct(totMS, totOpp)],
  }

  return (
    <div>
      <div className="flex justify-end gap-2 mb-3">
        <ExportMenu spec={exportSpec} />
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-tm-dark-border shadow-sm">
          {[
            { label: 'Combined', val: false },
            { label: 'By Site',  val: true  },
          ].map(({ label, val }) => (
            <button
              key={label}
              onClick={() => setSplitByShop(val)}
              className={`px-3 py-1.5 text-xs font-brand font-semibold transition-colors border-r last:border-r-0 border-gray-200 dark:border-tm-dark-border
                ${splitByShop === val
                  ? 'bg-tm-blue dark:bg-tm-navy text-white'
                  : 'bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue dark:hover:text-white'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {splitByShop ? (
        <div className="space-y-5">
          {locations.map(loc => {
            const locRows = allRows.filter(r => r.locationId === loc.id)
            if (!locRows.length) return null
            return (
              <div key={loc.id}>
                <p className="text-xs font-brand font-semibold text-tm-blue dark:text-tm-teal mb-1.5 uppercase tracking-wide">{loc.name}</p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <TableHead cols={TM_COLS_SPLIT} />
                    <tbody>
                      <TMSalesRows rows={locRows} showSite={false} sort={sort} />
                      <TMSalesTotalsRow rows={locRows} showSite={false} />
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <TableHead cols={TM_COLS_COMBINED} />
            <tbody>
              <TMSalesRows rows={allRows} showSite sort={sort} />
              <TMSalesTotalsRow rows={allRows} showSite />
            </tbody>
          </table>
        </div>
      )}
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
      <p className="text-gray-500 dark:text-tm-dark-muted mb-1">{label}</p>
      <p className="font-semibold text-tm-blue dark:text-tm-teal">
        {val != null ? (isPct ? `${val}%` : val.toLocaleString('en-US')) : '—'}
      </p>
    </div>
  )
}

function MiniChart({ title, data, dataKey, color, isPct = false, type = 'bar', dark, colorFn }) {
  const axisColor  = dark ? '#7A9BBF' : '#6B7280'
  const gridColor  = dark ? '#1E3A5F' : '#f0f0f0'
  const lineStroke = colorFn ? (dark ? '#4b6175' : '#9ca3af') : color
  const hasData    = data.some(d => d[dataKey] != null && d[dataKey] > 0)

  const customDot = colorFn
    ? (props) => {
        const { cx, cy, value } = props
        if (value == null) return null
        const c = colorFn(value)
        return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={c} stroke={c} strokeWidth={1} />
      }
    : { r: 3, fill: color }

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
              <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: 'Chakra Petch', fill: axisColor }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} tickFormatter={v => isPct ? `${v}%` : Number(v).toLocaleString('en-US')} />
              <Tooltip content={<ChartTooltip isPct={isPct} />} />
              <Line type="monotone" dataKey={dataKey} stroke={lineStroke} strokeWidth={2} dot={customDot} connectNulls={false} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: 'Chakra Petch', fill: axisColor }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} tickFormatter={v => Number(v).toLocaleString('en-US')} />
              <Tooltip content={<ChartTooltip isPct={isPct} />} />
              <Bar dataKey={dataKey} fill={colorFn ? undefined : color} radius={[2, 2, 0, 0]}>
                {colorFn && data.map((entry, i) => (
                  <Cell key={i} fill={colorFn(entry[dataKey])} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}

function DailyTrends({ logs, dark, locations, trendLocId, onTrendLocChange }) {
  // For a single location: use hourly rows as-is (last row = day total).
  // For all locations: reduce to one row per (location, date) then sum across locations.
  const chartData = (() => {
    if (trendLocId) {
      // Single location — existing logic
      const dayMap = {}
      logs.forEach(r => {
        if (!dayMap[r.log_date]) dayMap[r.log_date] = []
        dayMap[r.log_date].push(r)
      })
      return Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => {
          const d = new Date(date + 'T00:00:00')
          const withData = rows.filter(r => toInt(r.total_washes) > 0 || toInt(r.memberships_sold) > 0)
          const src = withData.length ? withData : rows
          const r = src.sort((a, b) => b.time_slot.localeCompare(a.time_slot))[0]
          const tw = toInt(r.total_washes), mw = toInt(r.member_washes)
          const ms = toInt(r.memberships_sold), opp = toInt(r.opportunities)
          const gr = toInt(r.google_reviews), btr = toInt(r.better), bst = toInt(r.best)
          return {
            label: `${d.getMonth() + 1}/${d.getDate()}`, tw, mw, ms, gr,
            conversion: opp > 0 ? parseFloat((ms / opp * 100).toFixed(1)) : null,
            pmix:       ms  > 0 ? parseFloat(((btr + bst) / ms * 100).toFixed(1)) : null,
          }
        })
    } else {
      // All locations — get latest row per (location, date) then sum across locations per date
      const locDateMap = {}
      logs.forEach(r => {
        const key = `${r.location_id}::${r.log_date}`
        if (!locDateMap[key]) locDateMap[key] = []
        locDateMap[key].push(r)
      })
      const bestRows = Object.values(locDateMap).map(rows => {
        const withData = rows.filter(r => toInt(r.total_washes) > 0 || toInt(r.memberships_sold) > 0)
        const src = withData.length ? withData : rows
        return src.sort((a, b) => b.time_slot.localeCompare(a.time_slot))[0]
      })
      const dateMap = {}
      bestRows.forEach(r => {
        if (!dateMap[r.log_date]) dateMap[r.log_date] = []
        dateMap[r.log_date].push(r)
      })
      return Object.entries(dateMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => {
          const d = new Date(date + 'T00:00:00')
          const tw  = rows.reduce((s, r) => s + toInt(r.total_washes),    0)
          const mw  = rows.reduce((s, r) => s + toInt(r.member_washes),   0)
          const ms  = rows.reduce((s, r) => s + toInt(r.memberships_sold),0)
          const opp = rows.reduce((s, r) => s + toInt(r.opportunities),   0)
          const gr  = rows.reduce((s, r) => s + toInt(r.google_reviews),  0)
          const btr = rows.reduce((s, r) => s + toInt(r.better),          0)
          const bst = rows.reduce((s, r) => s + toInt(r.best),            0)
          return {
            label: `${d.getMonth() + 1}/${d.getDate()}`, tw, mw, ms, gr,
            conversion: opp > 0 ? parseFloat((ms / opp * 100).toFixed(1)) : null,
            pmix:       ms  > 0 ? parseFloat(((btr + bst) / ms * 100).toFixed(1)) : null,
          }
        })
    }
  })()

  const navyColor     = dark ? '#D6E4F0' : '#1A3555'
  const trendLocation = locations.find(l => l.id === trendLocId)
  const selectCls     = "border border-gray-300 dark:border-tm-dark-border rounded-md px-3 py-1.5 text-sm bg-white dark:bg-tm-dark-card text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal"
  const thresholds    = trendLocation?.metric_thresholds
  const convColorFn   = (v) => convHex(v, thresholds)
  const pmixColorFn   = (v) => pmixHex(v, thresholds)

  return (
    <div>
      {locations.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <span className="text-sm text-gray-500 dark:text-tm-dark-muted">
            {trendLocation ? trendLocation.name : 'All Shops'}
          </span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-tm-dark-muted font-brand">Location:</label>
            <select value={trendLocId} onChange={e => onTrendLocChange(e.target.value)} className={selectCls}>
              <option value="">All Shops</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
      )}
      {!chartData.length ? (
        <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <MiniChart title="Daily Memberships Sold" data={chartData} dataKey="ms"         color={TEAL}      dark={dark} />
          <MiniChart title="Daily Conversion %"     data={chartData} dataKey="conversion" color={ORANGE}    dark={dark} type="line" isPct colorFn={convColorFn} />
          <MiniChart title="Daily Google Reviews"   data={chartData} dataKey="gr"         color={navyColor} dark={dark} />
          <MiniChart title="Daily Total Washes"     data={chartData} dataKey="tw"         color={navyColor} dark={dark} />
          <MiniChart title="Daily P-Mix %"          data={chartData} dataKey="pmix"       color={ORANGE}    dark={dark} type="line" isPct colorFn={pmixColorFn} />
          <MiniChart title="Daily Member Washes"    data={chartData} dataKey="mw"         color={TEAL}      dark={dark} />
        </div>
      )}
    </div>
  )
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ badge, badgeCls, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl shadow-md dark:border dark:border-tm-dark-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-tm-dark-card transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest ${badgeCls}`}>{badge}</span>
          <span className="text-sm text-gray-500 dark:text-tm-dark-muted">{subtitle}</span>
        </div>
        <span className="text-gray-400 dark:text-tm-dark-muted">
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100 dark:border-tm-dark-border">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Insights() {
  const { locations: allLocations } = useAuth()
  // Shops flagged "exclude from reporting" in the Admin panel stay out of all
  // dashboard views; they remain available for shop entry. Memoized so the
  // array reference stays stable — the fetch effect depends on it.
  const locations = useMemo(
    () => allLocations.filter(l => !l.exclude_from_reporting),
    [allLocations],
  )
  const [dark]        = useDarkModeCtx()
  const [logs, setLogs]                     = useState([])
  const [loading, setLoading]               = useState(true)
  const [selectedShops, setSelectedShops]     = useState(null)
  const [trendLocId, setTrendLocId]           = useState('') // '' = all visible locations
  const [selectedMarkets, setSelectedMarkets] = useState(() => {
    try {
      const raw = localStorage.getItem('tm_market_filter')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  })

  const [dateRange, setDateRange] = useState(() => loadSavedDateRange('tm_insights_date_range'))

  const markets = [...new Set(locations.map(l => l.market).filter(Boolean))].sort()

  const marketLocations = selectedMarkets === null
    ? locations
    : locations.filter(l => selectedMarkets.includes(l.market))

  useEffect(() => {
    if (locations.length) fetchData()
  }, [locations, dateRange])

  useEffect(() => {
    setSelectedShops(null)
  }, [selectedMarkets])

  useEffect(() => {
    if (!trendLocId) return // '' = all locations, always valid
    const visible = selectedShops === null
      ? marketLocations
      : marketLocations.filter(l => selectedShops.includes(l.id))
    if (!visible.find(l => l.id === trendLocId)) {
      setTrendLocId('') // fall back to "all" when selected location leaves the visible set
    }
  }, [selectedShops, selectedMarkets])

  const fetchData = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    // Supabase caps each query at 1000 rows and truncates silently. Longer date
    // ranges (month to date across all shops) exceed that, which made whole
    // locations disappear from the tables. Page through until a short page.
    const PAGE = 1000
    const all = []
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from('daily_logs')
        .select('*')
        .in('location_id', locIds)
        .gte('log_date', dateRange.start)
        .lte('log_date', dateRange.end)
        .order('id')
        .range(from, from + PAGE - 1)
      if (data?.length) all.push(...data)
      if (!data || data.length < PAGE) break
    }
    setLogs(all)
    setLoading(false)
  }

  const handleDateRangeChange = (newRange) => {
    setDateRange(newRange)
    saveDateRange('tm_insights_date_range', newRange)
  }

  const visibleLocations = selectedShops === null
    ? marketLocations
    : marketLocations.filter(l => selectedShops.includes(l.id))

  const filterLogs = (allLogs) => {
    const locIds = visibleLocations.map(l => l.id)
    return allLogs.filter(r => locIds.includes(r.location_id))
  }

  const trendLogs  = trendLocId ? logs.filter(r => r.location_id === trendLocId) : filterLogs(logs)
  const rangeLabel = fmtDateRange(dateRange.start, dateRange.end)
  const cardCls    = "bg-white dark:bg-tm-dark-surface rounded-xl shadow-md p-5 dark:border dark:border-tm-dark-border"

  return (
    <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg transition-colors">
      <NavBar />

      {/* Sticky header — always visible while scrolling */}
      <div className="sticky top-0 z-30 bg-tm-cream dark:bg-tm-dark-bg border-b border-gray-200 dark:border-tm-dark-border shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-brand font-bold text-tm-blue dark:text-tm-teal tracking-wide">Dashboard</h1>
          <div className="flex flex-wrap items-center gap-2">
            {markets.length > 0 && (
              <MarketMultiSelect
                markets={markets}
                selected={selectedMarkets}
                onChange={v => {
                  setSelectedMarkets(v)
                  localStorage.setItem('tm_market_filter', JSON.stringify(v))
                }}
              />
            )}
            {marketLocations.length > 1 && (
              <ShopMultiSelect locations={marketLocations} selected={selectedShops} onChange={setSelectedShops} />
            )}
            <DateSelector dateRange={dateRange} onChange={handleDateRangeChange} />
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className={`${cardCls} p-12 flex items-center justify-center`}><TmLoader /></div>
        ) : (
          <div className="space-y-4">

            <Section badge="NETWORK" badgeCls="bg-tm-blue" subtitle="Day view across shops">
              <div className="mt-3">
                <NetworkDayView locations={visibleLocations} date={todayStr()} />
              </div>
            </Section>

            <Section badge="SITES" badgeCls="bg-tm-blue" subtitle={`Site Performance — ${rangeLabel}`}>
              <div className="mt-3">
                <MetricTable data={filterLogs(logs)} locations={visibleLocations} dateRange={dateRange} />
              </div>
            </Section>

            <Section badge="TEAM" badgeCls="bg-[#1A3555]" subtitle={`Team Member Sales — ${rangeLabel}`}>
              <div className="mt-3">
                <TeamMemberTable data={filterLogs(logs)} locations={visibleLocations} dateRange={dateRange} />
              </div>
            </Section>

            <Section badge="DAILY" badgeCls="bg-orange-600" subtitle={`Daily trends — ${rangeLabel}`}>
              <div className="mt-3">
                <DailyTrends
                  logs={trendLogs}
                  dark={dark}
                  locations={visibleLocations}
                  trendLocId={trendLocId}
                  onTrendLocChange={setTrendLocId}
                />
              </div>
            </Section>

          </div>
        )}
      </div>
    </div>
  )
}
