import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const toInt = (v) => parseInt(v) || 0

export default function MonthlyRollup({ locationId, selectedDate }) {
  const [logs, setLogs] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const d = new Date(selectedDate + 'T00:00:00')
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const daysInMonth = new Date(year, month, 0).getDate()
  const pad = (n) => String(n).padStart(2, '0')
  const monthLabel = d.toLocaleString('default', { month: 'long', year: 'numeric' })

  useEffect(() => {
    fetchData()
  }, [locationId, selectedDate])

  const fetchData = async () => {
    setLoading(true)
    const start = `${year}-${pad(month)}-01`
    const end = `${year}-${pad(month)}-${pad(daysInMonth)}`

    const [{ data: logData }, { data: empData }] = await Promise.all([
      supabase.from('daily_logs').select('*').eq('location_id', locationId).gte('log_date', start).lte('log_date', end),
      supabase.from('employees').select('name').eq('location_id', locationId).eq('is_active', true).order('name'),
    ])

    const logNames = [...new Set((logData || []).map(l => l.employee_name).filter(Boolean))]
    const empNames = (empData || []).map(e => e.name)
    const allNames = [...new Set([...empNames, ...logNames])].sort()

    setLogs(logData || [])
    setEmployees(allNames)
    setLoading(false)
  }

  const dayStr = (day) => `${year}-${pad(month)}-${pad(day)}`

  const sum = (rows, field) => rows.reduce((s, r) => s + toInt(r[field]), 0)

  const getDayEmpStat = (day, emp, field) =>
    sum(logs.filter(l => l.log_date === dayStr(day) && l.employee_name === emp), field)

  const getDayTotal = (day, field) =>
    sum(logs.filter(l => l.log_date === dayStr(day)), field)

  const getEmpTotal = (emp, field) =>
    sum(logs.filter(l => l.employee_name === emp), field)

  const grandTotal = (field) => sum(logs, field)

  const activeDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .filter(day => logs.some(l => l.log_date === dayStr(day)))

  if (loading) {
    return <div className="py-12 text-center text-gray-400 text-sm">Loading {monthLabel}...</div>
  }
  if (!logs.length) {
    return <div className="py-12 text-center text-gray-400 text-sm">No data recorded for {monthLabel}.</div>
  }

  const sections = [
    { title: 'Total Washes Per Employee',             field: 'total_washes' },
    { title: 'Member Washes Per Employee',            field: 'member_washes' },
    { title: 'Membership Sales Per Employee',         field: 'memberships_sold' },
    { title: 'Premium Membership Sales Per Employee', field: 'best' },
  ]

  return (
    <div className="space-y-10">
      <h2 className="text-base font-bold text-gray-700">{monthLabel} — Monthly Rollup</h2>

      {sections.map(({ title, field }) => {
        const gt = grandTotal(field)
        const showConversion = field === 'memberships_sold'
        const grandOpp = showConversion ? grandTotal('opportunities') : 0
        const grandConv = grandOpp ? ((gt / grandOpp) * 100).toFixed(1) + '%' : ''

        return (
          <div key={field}>
            <h3 className="text-xs font-semibold text-green-800 uppercase tracking-wide mb-2">
              {title}
            </h3>
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr className="bg-green-700 text-white">
                    <th className="px-3 py-2 border border-green-600 text-left w-10">DATE</th>
                    {employees.map(emp => (
                      <th key={emp} className="px-3 py-2 border border-green-600 min-w-[70px]">{emp}</th>
                    ))}
                    <th className="px-3 py-2 border border-green-600 font-bold min-w-[60px]">Total</th>
                    {showConversion && (
                      <th className="px-3 py-2 border border-green-600 bg-red-700 min-w-[80px]">Conversion</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {activeDays.map((day, i) => {
                    const dayTot = getDayTotal(day, field)
                    const dayOpp = showConversion ? getDayTotal(day, 'opportunities') : 0
                    const daySold = showConversion ? getDayTotal(day, 'memberships_sold') : 0
                    const dayConv = dayOpp ? ((daySold / dayOpp) * 100).toFixed(1) + '%' : ''
                    return (
                      <tr key={day} className={i % 2 === 0 ? 'bg-green-50' : 'bg-white'}>
                        <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-600">
                          {day}
                        </td>
                        {employees.map(emp => {
                          const val = getDayEmpStat(day, emp, field)
                          return (
                            <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center">
                              {val > 0 ? val : ''}
                            </td>
                          )
                        })}
                        <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold">
                          {dayTot > 0 ? dayTot : ''}
                        </td>
                        {showConversion && (
                          <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-medium">
                            {dayConv}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  {/* Grand total row */}
                  <tr className="bg-green-100 font-semibold border-t-2 border-green-400">
                    <td className="border border-gray-300 px-2 py-1.5 text-center">Total</td>
                    {employees.map(emp => (
                      <td key={emp} className="border border-gray-300 px-2 py-1.5 text-center">
                        {getEmpTotal(emp, field) || ''}
                      </td>
                    ))}
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{gt || ''}</td>
                    {showConversion && (
                      <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">
                        {grandConv}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
