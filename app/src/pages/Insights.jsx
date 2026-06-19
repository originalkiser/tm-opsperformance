import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import NavBar from '../components/NavBar'

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
  const day = d.getDay() // 0=Sun
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)) // Monday
  return d.toISOString().split('T')[0]
}

const getMonthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const today = () => new Date().toISOString().split('T')[0]

function MetricTable({ title, data, locations }) {
  if (!data.length) return (
    <div className="text-sm text-gray-400 py-4">No data for this period.</div>
  )

  const totals = agg(data)
  const byLoc  = {}
  data.forEach(r => {
    ;(byLoc[r.location_id] = byLoc[r.location_id] || []).push(r)
  })

  const rows = Object.entries(byLoc)
    .map(([locId, rows]) => ({
      name: locations.find(l => l.id === locId)?.name || locId,
      ...agg(rows),
    }))
    .sort((a, b) => b.tw - a.tw)

  const Bar = ({ value, max }) => (
    <div className="flex items-center gap-1">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[40px]">
        <div
          className="bg-blue-500 h-1.5 rounded-full"
          style={{ width: max > 0 ? `${Math.min(100, value / max * 100)}%` : '0%' }}
        />
      </div>
      <span className="text-xs w-8 text-right">{value}</span>
    </div>
  )

  const maxWashes = Math.max(...rows.map(r => r.tw), 1)

  return (
    <div>
      <h3 className="text-sm font-bold text-gray-700 mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-blue-700 text-white">
              {['Location', 'Total Washes', 'Member Washes', 'Memberships Sold', 'Opportunities', 'Google Reviews', 'P-Mix', 'Conversion'].map(h => (
                <th key={h} className="px-3 py-2 border border-blue-600 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className={i % 2 === 0 ? 'bg-blue-50' : 'bg-white'}>
                <td className="border border-gray-200 px-3 py-2 font-medium">{r.name}</td>
                <td className="border border-gray-200 px-3 py-2">
                  <Bar value={r.tw} max={maxWashes} />
                </td>
                <td className="border border-gray-200 px-3 py-2 text-center">{r.mw || ''}</td>
                <td className="border border-gray-200 px-3 py-2 text-center">{r.ms || ''}</td>
                <td className="border border-gray-200 px-3 py-2 text-center">{r.opp || ''}</td>
                <td className="border border-gray-200 px-3 py-2 text-center">{r.gr || ''}</td>
                <td className="border border-gray-200 px-3 py-2 text-center font-semibold text-orange-700">{r.p_mix}</td>
                <td className="border border-gray-200 px-3 py-2 text-center font-semibold text-orange-700">{r.conversion}</td>
              </tr>
            ))}
            <tr className="bg-blue-100 font-semibold border-t-2 border-blue-300">
              <td className="border border-gray-300 px-3 py-2">Totals</td>
              <td className="border border-gray-300 px-3 py-2 text-center">{totals.tw || ''}</td>
              <td className="border border-gray-300 px-3 py-2 text-center">{totals.mw || ''}</td>
              <td className="border border-gray-300 px-3 py-2 text-center">{totals.ms || ''}</td>
              <td className="border border-gray-300 px-3 py-2 text-center">{totals.opp || ''}</td>
              <td className="border border-gray-300 px-3 py-2 text-center">{totals.gr || ''}</td>
              <td className="border border-gray-300 px-3 py-2 text-center bg-orange-100 text-orange-800">{totals.p_mix}</td>
              <td className="border border-gray-300 px-3 py-2 text-center bg-orange-100 text-orange-800">{totals.conversion}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Insights() {
  const { locations, profile } = useAuth()
  const [wtdLogs, setWtdLogs] = useState([])
  const [mtdLogs, setMtdLogs] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filterLocId, setFilterLocId] = useState('')

  useEffect(() => {
    if (locations.length) fetchAll()
  }, [locations])

  const fetchAll = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    const td = today()

    const [wtd, mtd] = await Promise.all([
      supabase
        .from('daily_logs')
        .select('*')
        .in('location_id', locIds)
        .gte('log_date', getWeekStart())
        .lte('log_date', td),
      supabase
        .from('daily_logs')
        .select('*')
        .in('location_id', locIds)
        .gte('log_date', getMonthStart())
        .lte('log_date', td),
    ])

    setWtdLogs(wtd.data || [])
    setMtdLogs(mtd.data || [])
    setLoading(false)
  }

  const filterLogs = (logs) =>
    filterLocId ? logs.filter(r => r.location_id === filterLocId) : logs

  const visibleLocations = filterLocId
    ? locations.filter(l => l.id === filterLocId)
    : locations

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-xl font-bold text-gray-800">Performance Insights</h1>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Filter Location:</label>
            <select
              value={filterLocId}
              onChange={e => setFilterLocId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Locations</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow p-12 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-8">
            {/* WTD */}
            <div className="bg-white rounded-xl shadow-md p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="bg-blue-700 text-white text-xs font-bold px-2 py-1 rounded">WTD</span>
                <span className="text-sm text-gray-500">
                  Week to Date — {getWeekStart()} through {today()}
                </span>
              </div>
              <MetricTable
                title=""
                data={filterLogs(wtdLogs)}
                locations={visibleLocations.length ? visibleLocations : locations}
              />
            </div>

            {/* MTD */}
            <div className="bg-white rounded-xl shadow-md p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="bg-green-700 text-white text-xs font-bold px-2 py-1 rounded">MTD</span>
                <span className="text-sm text-gray-500">
                  Month to Date — {getMonthStart()} through {today()}
                </span>
              </div>
              <MetricTable
                title=""
                data={filterLogs(mtdLogs)}
                locations={visibleLocations.length ? visibleLocations : locations}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
