import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const toInt = (v) => parseInt(v) || 0

const pct = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : ''

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

  useEffect(() => { fetchData() }, [locationId, selectedDate])

  const fetchData = async () => {
    setLoading(true)
    const start = `${year}-${pad(month)}-01`
    const end   = `${year}-${pad(month)}-${pad(daysInMonth)}`

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

  const empLogs  = (emp)       => logs.filter(l => l.employee_name === emp)
  const dayLogs  = (day)       => logs.filter(l => l.log_date === dayStr(day))
  const dayEmpLogs = (day, emp) => logs.filter(l => l.log_date === dayStr(day) && l.employee_name === emp)

  const sum = (rows, field) => rows.reduce((s, r) => s + toInt(r[field]), 0)

  // Employees who have at least one non-zero value across the month
  const NUMERIC = ['total_washes','member_washes','google_reviews','net_members',
                   'basic','good','better','best','memberships_sold','opportunities']
  const activeEmployees = employees.filter(emp =>
    empLogs(emp).some(r => NUMERIC.some(f => toInt(r[f]) > 0))
  )

  const activeDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .filter(day => logs.some(l => l.log_date === dayStr(day)))

  if (loading) return (
    <div className="py-12 text-center text-gray-400 text-sm">Loading {monthLabel}...</div>
  )
  if (!logs.length) return (
    <div className="py-12 text-center text-gray-400 text-sm">No data recorded for {monthLabel}.</div>
  )

  // ── Shared table chrome ──────────────────────────────────────────────────────
  const TableShell = ({ title, children }) => (
    <div>
      <h3 className="text-xs font-semibold text-green-800 uppercase tracking-wide mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">{children}</table>
      </div>
    </div>
  )

  const HeaderRow = ({ extra = [] }) => (
    <thead>
      <tr className="bg-green-700 text-white">
        <th className="px-3 py-2 border border-green-600 text-left w-10">DATE</th>
        {activeEmployees.map(emp => (
          <th key={emp} className="px-3 py-2 border border-green-600 min-w-[70px]">{emp}</th>
        ))}
        <th className="px-3 py-2 border border-green-600 font-bold min-w-[60px]">Total</th>
        {extra.map(({ label, cls }) => (
          <th key={label} className={`px-3 py-2 border border-green-600 min-w-[80px] ${cls}`}>{label}</th>
        ))}
      </tr>
    </thead>
  )

  // ── Simple count section (Total Washes, Member Washes, Memberships Sold, Best) ──
  const CountSection = ({ title, field }) => {
    const grandTot = sum(logs, field)
    return (
      <TableShell title={title}>
        <HeaderRow />
        <tbody>
          {activeDays.map((day, i) => {
            const dayTot = sum(dayLogs(day), field)
            return (
              <tr key={day} className={i % 2 === 0 ? 'bg-green-50' : 'bg-white'}>
                <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-600">{day}</td>
                {activeEmployees.map(emp => {
                  const val = sum(dayEmpLogs(day, emp), field)
                  return (
                    <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center">
                      {val > 0 ? val : ''}
                    </td>
                  )
                })}
                <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold">
                  {dayTot > 0 ? dayTot : ''}
                </td>
              </tr>
            )
          })}
          <tr className="bg-green-100 font-semibold border-t-2 border-green-400">
            <td className="border border-gray-300 px-2 py-1.5 text-center">Total</td>
            {activeEmployees.map(emp => (
              <td key={emp} className="border border-gray-300 px-2 py-1.5 text-center">
                {sum(empLogs(emp), field) || ''}
              </td>
            ))}
            <td className="border border-gray-300 px-2 py-1.5 text-center">{grandTot || ''}</td>
          </tr>
        </tbody>
      </TableShell>
    )
  }

  // ── Conversion by Employee: ms / opp per day ─────────────────────────────────
  const ConversionSection = () => (
    <TableShell title="Conversion % by Employee">
      <HeaderRow extra={[{ label: 'Total', cls: 'bg-orange-600' }]} />
      <tbody>
        {activeDays.map((day, i) => {
          const dayOpp  = sum(dayLogs(day), 'opportunities')
          const dayMS   = sum(dayLogs(day), 'memberships_sold')
          return (
            <tr key={day} className={i % 2 === 0 ? 'bg-green-50' : 'bg-white'}>
              <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-600">{day}</td>
              {activeEmployees.map(emp => {
                const rows = dayEmpLogs(day, emp)
                const ms  = sum(rows, 'memberships_sold')
                const opp = sum(rows, 'opportunities')
                return (
                  <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center text-orange-800 font-medium">
                    {pct(ms, opp)}
                  </td>
                )
              })}
              <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold">
                {pct(dayMS, dayOpp)}
              </td>
            </tr>
          )
        })}
        <tr className="bg-green-100 font-semibold border-t-2 border-green-400">
          <td className="border border-gray-300 px-2 py-1.5 text-center">Total</td>
          {activeEmployees.map(emp => {
            const rows = empLogs(emp)
            return (
              <td key={emp} className="border border-gray-300 px-2 py-1.5 text-center text-orange-800">
                {pct(sum(rows, 'memberships_sold'), sum(rows, 'opportunities'))}
              </td>
            )
          })}
          <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">
            {pct(sum(logs, 'memberships_sold'), sum(logs, 'opportunities'))}
          </td>
        </tr>
      </tbody>
    </TableShell>
  )

  // ── P-Mix by Employee: (better+best) / ms per day ───────────────────────────
  const PMixSection = () => (
    <TableShell title="P-Mix % by Employee">
      <HeaderRow extra={[{ label: 'Total', cls: 'bg-orange-600' }]} />
      <tbody>
        {activeDays.map((day, i) => {
          const dayMS      = sum(dayLogs(day), 'memberships_sold')
          const dayPremium = sum(dayLogs(day), 'better') + sum(dayLogs(day), 'best')
          return (
            <tr key={day} className={i % 2 === 0 ? 'bg-green-50' : 'bg-white'}>
              <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-600">{day}</td>
              {activeEmployees.map(emp => {
                const rows    = dayEmpLogs(day, emp)
                const ms      = sum(rows, 'memberships_sold')
                const premium = sum(rows, 'better') + sum(rows, 'best')
                return (
                  <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center text-orange-800 font-medium">
                    {pct(premium, ms)}
                  </td>
                )
              })}
              <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold">
                {pct(dayPremium, dayMS)}
              </td>
            </tr>
          )
        })}
        <tr className="bg-green-100 font-semibold border-t-2 border-green-400">
          <td className="border border-gray-300 px-2 py-1.5 text-center">Total</td>
          {activeEmployees.map(emp => {
            const rows    = empLogs(emp)
            const ms      = sum(rows, 'memberships_sold')
            const premium = sum(rows, 'better') + sum(rows, 'best')
            return (
              <td key={emp} className="border border-gray-300 px-2 py-1.5 text-center text-orange-800">
                {pct(premium, ms)}
              </td>
            )
          })}
          <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">
            {pct(sum(logs, 'better') + sum(logs, 'best'), sum(logs, 'memberships_sold'))}
          </td>
        </tr>
      </tbody>
    </TableShell>
  )

  return (
    <div className="space-y-10">
      <h2 className="text-base font-bold text-gray-700">{monthLabel} — Monthly Rollup</h2>

      <CountSection title="Total Washes Per Employee"             field="total_washes" />
      <CountSection title="Member Washes Per Employee"            field="member_washes" />
      <CountSection title="Membership Sales Per Employee"         field="memberships_sold" />
      <CountSection title="Premium Membership Sales Per Employee" field="best" />
      <ConversionSection />
      <PMixSection />
    </div>
  )
}
