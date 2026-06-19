import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const aggregate = (rows) => {
  const tw   = rows.reduce((s, r) => s + toInt(r.total_washes), 0)
  const mw   = rows.reduce((s, r) => s + toInt(r.member_washes), 0)
  const gr   = rows.reduce((s, r) => s + toInt(r.google_reviews), 0)
  const nm   = rows.reduce((s, r) => s + toInt(r.net_members), 0)
  const ms   = rows.reduce((s, r) => s + toInt(r.memberships_sold), 0)
  const opp  = rows.reduce((s, r) => s + toInt(r.opportunities), 0)
  const btr  = rows.reduce((s, r) => s + toInt(r.better), 0)
  const bst  = rows.reduce((s, r) => s + toInt(r.best), 0)

  const p_mix     = ms > 0   ? ((btr + bst) / ms  * 100).toFixed(1) + '%' : ''
  const conversion= opp > 0  ? (ms / opp * 100).toFixed(1) + '%'           : ''

  return { tw, mw, gr, nm, ms, opp, btr, bst, p_mix, conversion }
}

export default function EmployeeSummary({ locationId, selectedDate }) {
  const [logs, setLogs] = useState([])

  useEffect(() => { fetchData() }, [locationId, selectedDate])

  const fetchData = async () => {
    const { data } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('location_id', locationId)
      .eq('log_date', selectedDate)
      .not('employee_name', 'is', null)
    setLogs(data || [])
  }

  // Group by employee name
  const grouped = {}
  logs.forEach(row => {
    if (!row.employee_name) return
    ;(grouped[row.employee_name] = grouped[row.employee_name] || []).push(row)
  })

  const employees = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rows]) => ({ name, ...aggregate(rows) }))

  if (!employees.length) return null

  const totals = aggregate(logs)

  return (
    <div>
      <h3 className="text-sm font-brand font-semibold text-tm-blue mb-2 uppercase tracking-widest">
        Employee Summary
      </h3>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr className="bg-tm-blue text-white">
              {[
                ['Employee', 'text-left'],
                ['Google Reviews', ''],
                ['Total Washes', ''],
                ['Member Washes', ''],
                ['Memberships Sold', 'bg-[#8ECFCB] text-tm-navy'],
                ['Opportunities', 'bg-[#8ECFCB] text-tm-navy'],
                ['Net Members', ''],
                ['Better', ''],
                ['Best', ''],
                ['P-Mix', 'bg-orange-600'],
                ['Conversion', 'bg-orange-600'],
              ].map(([h, cls]) => (
                <th key={h} className={`px-3 py-2 border border-tm-navy font-brand font-semibold ${cls}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, i) => (
              <tr key={emp.name} className={i % 2 === 0 ? 'bg-[#f0f9f8]' : 'bg-white'}>
                <td className="border border-gray-200 px-3 py-1.5 font-medium">{emp.name}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.gr  || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.tw  || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.mw  || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.ms  || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.opp || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.nm  || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.btr || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center">{emp.bst || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold">{emp.p_mix}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold">{emp.conversion}</td>
              </tr>
            ))}
            <tr className="bg-tm-sky/25 font-semibold border-t-2 border-tm-teal/50">
              <td className="border border-gray-300 px-3 py-1.5 font-brand">Totals</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.gr  || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.tw  || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.mw  || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.ms  || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.opp || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.nm  || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.btr || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center">{totals.bst || ''}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">{totals.p_mix}</td>
              <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">{totals.conversion}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
