import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend,
} from 'recharts'

const TYPE_COLORS = {
  Planned:   '#3B82F6',
  Unplanned: '#EF4444',
  Weather:   '#8B5CF6',
  Utility:   '#F59E0B',
  IT:        '#06B6D4',
  Other:     '#6B7280',
}

const SCOPE_COLORS = {
  Site:    '#EF4444',
  Lane:    '#F59E0B',
  Vacuum:  '#3B82F6',
}

function fmtDuration(ms) {
  if (ms == null || isNaN(ms)) return '—'
  const totalMins = Math.round(ms / 60000)
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function exportCsv(rows, locations) {
  const locMap = Object.fromEntries(locations.map(l => [l.id, l.name]))
  const headers = [
    'Date', 'Location', 'Scope', 'Type', 'Reason', 'Details',
    'Started', 'Ended', 'Duration (min)', 'Status',
    'Resolution Notes', 'Corrective Action Needed', 'Corrective Action',
  ]
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    headers.join(','),
    ...rows.map(r => {
      const start   = r.started_at ? new Date(r.started_at) : null
      const end     = r.ended_at   ? new Date(r.ended_at)   : null
      const durMins = start && end ? Math.round((end - start) / 60000) : ''
      return [
        fmtDate(r.started_at),
        locMap[r.location_id] ?? r.location_id,
        r.scope              ?? '',
        r.downtime_type      ?? '',
        r.reason             ?? '',
        r.details            ?? '',
        start ? `${fmtDate(r.started_at)} ${fmtTime(r.started_at)}` : '',
        end   ? `${fmtDate(r.ended_at)}   ${fmtTime(r.ended_at)}`   : '',
        durMins,
        r.status             ?? '',
        r.resolution_notes   ?? '',
        r.corrective_action_needed === true  ? 'Yes'
          : r.corrective_action_needed === false ? 'No' : '',
        r.corrective_action  ?? '',
      ].map(esc).join(',')
    }),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'downtime_report.csv' })
  a.click()
  URL.revokeObjectURL(url)
}

function StatTile({ label, value, sub }) {
  return (
    <div className="bg-gray-50 dark:bg-tm-dark-card rounded-xl px-4 py-3 border border-gray-100 dark:border-tm-dark-border">
      <div className="text-xs font-brand font-semibold text-gray-400 dark:text-tm-dark-muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-brand font-bold text-tm-blue dark:text-tm-teal mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-400 dark:text-tm-dark-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function CustomTooltip({ active, payload, label, dark }) {
  if (!active || !payload?.length) return null
  return (
    <div className={`rounded-lg px-3 py-2 shadow-lg border text-xs font-brand ${dark ? 'bg-tm-dark-card border-tm-dark-border text-tm-dark-text' : 'bg-white border-gray-200 text-gray-700'}`}>
      <div className="font-semibold mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.fill || p.color }} />
          <span>{p.name}: <strong>{p.value}</strong></span>
        </div>
      ))}
    </div>
  )
}

export default function DowntimeSection({ logs = [], locations = [], dark }) {
  const [groupBy,   setGroupBy]   = useState('day')   // 'day' | 'location' | 'type' | 'scope'
  const [metric,    setMetric]    = useState('count')  // 'count' | 'duration'
  const [sortCol,   setSortCol]   = useState('started_at')
  const [sortDir,   setSortDir]   = useState('desc')
  const [typeFilter, setTypeFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')

  const locMap = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l.name])), [locations])

  const resolved = useMemo(() =>
    logs.filter(r => r.status === 'resolved' && r.started_at && r.ended_at),
    [logs]
  )

  const filtered = useMemo(() => {
    let r = logs
    if (typeFilter  !== 'all') r = r.filter(x => x.downtime_type === typeFilter)
    if (scopeFilter !== 'all') r = r.filter(x => x.scope === scopeFilter)
    return r
  }, [logs, typeFilter, scopeFilter])

  // ── Summary stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total    = filtered.length
    const active   = filtered.filter(r => r.status === 'active').length
    const res      = filtered.filter(r => r.status === 'resolved' && r.started_at && r.ended_at)
    const durations = res.map(r => new Date(r.ended_at) - new Date(r.started_at))
    const totalMs  = durations.reduce((a, b) => a + b, 0)
    const avgMs    = durations.length ? totalMs / durations.length : 0
    return { total, active, totalMs, avgMs }
  }, [filtered])

  // ── Chart data ───────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (groupBy === 'day') {
      const map = {}
      filtered.forEach(r => {
        if (!r.started_at) return
        const day = r.started_at.slice(0, 10)
        if (!map[day]) map[day] = { day, count: 0, durationMs: 0 }
        map[day].count++
        if (r.ended_at) map[day].durationMs += new Date(r.ended_at) - new Date(r.started_at)
      })
      return Object.values(map)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(d => ({
          label: new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: metric === 'count' ? d.count : Math.round(d.durationMs / 60000),
        }))
    }

    if (groupBy === 'location') {
      const map = {}
      filtered.forEach(r => {
        const name = locMap[r.location_id] || r.location_id
        if (!map[name]) map[name] = { count: 0, durationMs: 0 }
        map[name].count++
        if (r.ended_at && r.started_at) map[name].durationMs += new Date(r.ended_at) - new Date(r.started_at)
      })
      return Object.entries(map)
        .map(([label, d]) => ({ label, value: metric === 'count' ? d.count : Math.round(d.durationMs / 60000) }))
        .sort((a, b) => b.value - a.value)
    }

    if (groupBy === 'type') {
      const map = {}
      filtered.forEach(r => {
        const k = r.downtime_type || 'Unknown'
        if (!map[k]) map[k] = { count: 0, durationMs: 0 }
        map[k].count++
        if (r.ended_at && r.started_at) map[k].durationMs += new Date(r.ended_at) - new Date(r.started_at)
      })
      return Object.entries(map)
        .map(([label, d]) => ({ label, value: metric === 'count' ? d.count : Math.round(d.durationMs / 60000) }))
        .sort((a, b) => b.value - a.value)
    }

    if (groupBy === 'scope') {
      const map = {}
      filtered.forEach(r => {
        const k = r.scope || 'Unknown'
        if (!map[k]) map[k] = { count: 0, durationMs: 0 }
        map[k].count++
        if (r.ended_at && r.started_at) map[k].durationMs += new Date(r.ended_at) - new Date(r.started_at)
      })
      return Object.entries(map)
        .map(([label, d]) => ({ label, value: metric === 'count' ? d.count : Math.round(d.durationMs / 60000) }))
        .sort((a, b) => b.value - a.value)
    }

    return []
  }, [filtered, groupBy, metric, locMap])

  // ── Sorted table rows ────────────────────────────────────────────────────────
  const tableRows = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let va = a[sortCol] ?? ''
      let vb = b[sortCol] ?? ''
      if (typeof va === 'boolean') va = va ? 1 : 0
      if (typeof vb === 'boolean') vb = vb ? 1 : 0
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [filtered, sortCol, sortDir])

  const sortBy = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }) =>
    sortCol !== col ? null : (
      <span className="ml-1 opacity-60">{sortDir === 'asc' ? '▲' : '▼'}</span>
    )

  const gridColor = dark ? '#2a3448' : '#e5e7eb'
  const axisColor = dark ? '#8899bb' : '#6b7280'

  const allTypes  = [...new Set(logs.map(r => r.downtime_type).filter(Boolean))].sort()
  const allScopes = [...new Set(logs.map(r => r.scope).filter(Boolean))].sort()
  const barColor  = groupBy === 'type'
    ? null
    : groupBy === 'scope' ? null
    : '#0d6fb8'

  if (!logs.length) {
    return (
      <div className="py-10 text-center text-sm text-gray-400 dark:text-tm-dark-muted font-brand">
        No downtime events found for the selected period and locations.
      </div>
    )
  }

  return (
    <div className="space-y-5 mt-3">

      {/* ── Stats row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total Events"    value={stats.total}  sub={stats.active ? `${stats.active} active` : 'none active'} />
        <StatTile label="Total Downtime"  value={fmtDuration(stats.totalMs)} sub="resolved events" />
        <StatTile label="Avg Duration"    value={fmtDuration(stats.avgMs)}   sub="per resolved event" />
        <StatTile label="Filtered Showing" value={filtered.length} sub={`of ${logs.length} events`} />
      </div>

      {/* ── Filters + controls ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center text-xs font-brand">
        <span className="text-gray-500 dark:text-tm-dark-muted font-semibold uppercase tracking-wide">Group by:</span>
        {['day', 'location', 'type', 'scope'].map(g => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`px-3 py-1 rounded-full border transition-colors capitalize ${groupBy === g ? 'bg-tm-blue text-white border-tm-blue' : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted hover:border-tm-blue'}`}
          >
            {g}
          </button>
        ))}
        <span className="ml-2 text-gray-500 dark:text-tm-dark-muted font-semibold uppercase tracking-wide">Metric:</span>
        {[{ k: 'count', l: 'Events' }, { k: 'duration', l: 'Minutes' }].map(m => (
          <button
            key={m.k}
            onClick={() => setMetric(m.k)}
            className={`px-3 py-1 rounded-full border transition-colors ${metric === m.k ? 'bg-tm-teal text-tm-navy border-tm-teal font-bold' : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted hover:border-tm-teal'}`}
          >
            {m.l}
          </button>
        ))}
        <div className="flex-1" />
        {/* Filters */}
        {allTypes.length > 0 && (
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="border border-gray-300 dark:border-tm-dark-border rounded-md px-2 py-1 bg-white dark:bg-tm-dark-card text-gray-700 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal">
            <option value="all">All Types</option>
            {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {allScopes.length > 0 && (
          <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}
            className="border border-gray-300 dark:border-tm-dark-border rounded-md px-2 py-1 bg-white dark:bg-tm-dark-card text-gray-700 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal">
            <option value="all">All Scopes</option>
            {allScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* ── Trend chart ───────────────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="bg-gray-50 dark:bg-tm-dark-card rounded-xl border border-gray-100 dark:border-tm-dark-border px-4 py-4">
          <div className="text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-3">
            {metric === 'count' ? 'Event Count' : 'Total Duration (minutes)'} by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor, fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: axisColor, fontFamily: 'inherit' }} axisLine={false} tickLine={false} allowDecimals={false} width={35} />
              <Tooltip content={<CustomTooltip dark={dark} />} cursor={{ fill: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="value" name={metric === 'count' ? 'Events' : 'Minutes'} radius={[4, 4, 0, 0]}>
                {chartData.map((entry, idx) => {
                  let fill = '#0d6fb8'
                  if (groupBy === 'type')  fill = TYPE_COLORS[entry.label]  || '#6B7280'
                  if (groupBy === 'scope') fill = SCOPE_COLORS[entry.label] || '#6B7280'
                  return <Cell key={idx} fill={fill} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {(groupBy === 'type' || groupBy === 'scope') && (
            <div className="flex flex-wrap gap-3 mt-2">
              {chartData.map(d => (
                <div key={d.label} className="flex items-center gap-1.5 text-xs font-brand text-gray-500 dark:text-tm-dark-muted">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: groupBy === 'type' ? (TYPE_COLORS[d.label] || '#6B7280') : (SCOPE_COLORS[d.label] || '#6B7280') }} />
                  {d.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Table + export ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide">
            {tableRows.length} event{tableRows.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => exportCsv(filtered, locations)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-brand font-semibold rounded-lg border border-gray-300 dark:border-tm-dark-border bg-white dark:bg-tm-dark-card text-gray-600 dark:text-tm-dark-muted hover:text-tm-blue hover:border-tm-teal transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/>
              <path d="M7.646 11.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 10.293V1.5a.5.5 0 00-1 0v8.793L5.354 8.146a.5.5 0 10-.708.708l3 3z"/>
            </svg>
            Export CSV
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
          <table className="w-full text-xs font-brand border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-tm-blue dark:bg-tm-navy text-white">
                {[
                  { label: 'Date',     col: 'started_at' },
                  { label: 'Location', col: 'location_id' },
                  { label: 'Scope',    col: 'scope' },
                  { label: 'Type',     col: 'downtime_type' },
                  { label: 'Reason',   col: 'reason' },
                  { label: 'Duration', col: null },
                  { label: 'Status',   col: 'status' },
                  { label: 'CA?',      col: 'corrective_action_needed' },
                ].map(({ label, col }) => (
                  <th
                    key={label}
                    onClick={col ? () => sortBy(col) : undefined}
                    className={`px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap select-none ${col ? 'cursor-pointer hover:text-tm-teal' : ''}`}
                  >
                    {label}<SortIcon col={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => {
                const start = r.started_at ? new Date(r.started_at) : null
                const end   = r.ended_at   ? new Date(r.ended_at)   : null
                const dur   = start && end  ? end - start            : null
                const isActive = r.status === 'active'
                return (
                  <tr key={r.id} className={`border-t border-gray-100 dark:border-tm-dark-border ${i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}`}>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-tm-dark-text">
                      <div>{start ? fmtDate(r.started_at) : '—'}</div>
                      <div className="text-[10px] text-gray-400 dark:text-tm-dark-muted">{start ? fmtTime(r.started_at) : ''}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-tm-dark-text">{locMap[r.location_id] || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.scope ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: (SCOPE_COLORS[r.scope] || '#6B7280') + '22', color: SCOPE_COLORS[r.scope] || '#6B7280' }}>
                          {r.scope}
                        </span>
                      ) : <span className="text-gray-400 dark:text-tm-dark-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.downtime_type ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: (TYPE_COLORS[r.downtime_type] || '#6B7280') + '22', color: TYPE_COLORS[r.downtime_type] || '#6B7280' }}>
                          {r.downtime_type}
                        </span>
                      ) : <span className="text-gray-400 dark:text-tm-dark-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate text-gray-600 dark:text-tm-dark-text" title={r.reason}>{r.reason || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-tm-dark-text">
                      {isActive
                        ? <span className="text-red-500 font-semibold animate-pulse">Active</span>
                        : fmtDuration(dur)
                      }
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                        r.status === 'active'    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        : r.status === 'resolved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.corrective_action_needed === true  ? <span className="text-amber-500 font-bold">✓</span>
                        : r.corrective_action_needed === false ? <span className="text-gray-400">—</span>
                        : <span className="text-gray-300 dark:text-tm-dark-border text-[10px]">n/a</span>}
                    </td>
                  </tr>
                )
              })}
              {!tableRows.length && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-tm-dark-muted">No events match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
