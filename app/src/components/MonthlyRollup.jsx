import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const toInt = (v) => parseInt(v) || 0
const pct   = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : ''

export default function MonthlyRollup({ locationId, selectedDate }) {
  const [logs, setLogs]         = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]   = useState(true)

  const d           = new Date(selectedDate + 'T00:00:00')
  const year        = d.getFullYear()
  const month       = d.getMonth() + 1
  const daysInMonth = new Date(year, month, 0).getDate()
  const pad         = (n) => String(n).padStart(2, '0')
  const monthLabel  = d.toLocaleString('default', { month: 'long', year: 'numeric' })

  useEffect(() => { fetchData() }, [locationId, selectedDate])

  const fetchData = async () => {
    setLoading(true)
    const start = `${year}-${pad(month)}-01`
    const end   = `${year}-${pad(month)}-${pad(daysInMonth)}`

    const [{ data: logData }, { data: empData }] = await Promise.all([
      supabase.from('daily_logs').select('*')
        .eq('location_id', locationId).gte('log_date', start).lte('log_date', end),
      supabase.from('employees').select('name')
        .eq('location_id', locationId).eq('is_active', true).order('name'),
    ])

    const logNames = [...new Set((logData || []).map(l => l.employee_name).filter(Boolean))]
    const empNames = (empData || []).map(e => e.name)
    const allNames = [...new Set([...empNames, ...logNames])].sort()

    setLogs(logData || [])
    setEmployees(allNames)
    setLoading(false)
  }

  const dayStr     = (day) => `${year}-${pad(month)}-${pad(day)}`
  const empLogs    = (emp)       => logs.filter(l => l.employee_name === emp)
  const dayLogs    = (day)       => logs.filter(l => l.log_date === dayStr(day))
  const dayEmpLogs = (day, emp)  => logs.filter(l => l.log_date === dayStr(day) && l.employee_name === emp)
  const sum        = (rows, field) => rows.reduce((s, r) => s + toInt(r[field]), 0)

  const NUMERIC = [
    'total_washes','member_washes','google_reviews','net_members',
    'basic','good','better','best','memberships_sold','opportunities',
  ]
  const activeEmployees = employees.filter(emp =>
    empLogs(emp).some(r => NUMERIC.some(f => toInt(r[f]) > 0))
  )

  const activeDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .filter(day => logs.some(l => l.log_date === dayStr(day)))

  if (loading) return (
    <div className="py-12 text-center text-gray-400 text-sm font-brand">Loading {monthLabel}…</div>
  )
  if (!logs.length) return (
    <div className="py-12 text-center text-gray-400 text-sm font-brand">No data recorded for {monthLabel}.</div>
  )

  // ── Shared components ────────────────────────────────────────────────────────

  const TableHeader = ({ extraCols = [] }) => (
    <thead>
      <tr className="bg-tm-blue text-white">
        <th className="px-3 py-2 border border-tm-navy text-left font-brand font-semibold text-[11px] w-10">DATE</th>
        {activeEmployees.map(emp => (
          <th key={emp} className="px-3 py-2 border border-tm-navy font-brand font-semibold text-[11px] min-w-[70px]">{emp}</th>
        ))}
        <th className="px-3 py-2 border border-tm-navy font-brand font-semibold text-[11px] min-w-[60px]">Total</th>
        {extraCols.map(({ label, cls = '' }) => (
          <th key={label} className={`px-3 py-2 border border-tm-navy font-brand font-semibold text-[11px] min-w-[70px] ${cls}`}>{label}</th>
        ))}
      </tr>
    </thead>
  )

  const TotalRow = ({ cells, extraCells = [] }) => (
    <tr className="bg-tm-sky/20 font-semibold border-t-2 border-tm-teal/50">
      <td className="border border-gray-300 px-2 py-1.5 text-center font-brand text-[11px]">Total</td>
      {cells.map((val, i) => (
        <td key={i} className="border border-gray-300 px-2 py-1.5 text-center font-brand text-[11px]">{val}</td>
      ))}
      {extraCells.map(({ val, cls = '' }, i) => (
        <td key={i} className={`border border-gray-300 px-2 py-1.5 text-center font-brand text-[11px] ${cls}`}>{val}</td>
      ))}
    </tr>
  )

  const rowBg = (i) => i % 2 === 0 ? 'bg-[#f0f9f8]' : 'bg-white'

  const SectionTitle = ({ label, accent }) => (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[10px] font-brand font-bold px-2 py-0.5 rounded tracking-widest text-white ${accent}`}>
        {label}
      </span>
    </div>
  )

  // ── Count table (washes, sales, etc.) ──────────────────────────────────────

  const CountTable = ({ title, accentClass, field }) => {
    const grandTotal = sum(logs, field)
    return (
      <div>
        <SectionTitle label={title} accent={accentClass} />
        <div className="overflow-x-auto">
          <table className="border-collapse text-[11px] w-full">
            <TableHeader />
            <tbody>
              {activeDays.map((day, i) => {
                const dayTotal = sum(dayLogs(day), field)
                return (
                  <tr key={day} className={rowBg(i)}>
                    <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-500 font-brand">{day}</td>
                    {activeEmployees.map(emp => {
                      const val = sum(dayEmpLogs(day, emp), field)
                      return (
                        <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center font-brand">
                          {val > 0 ? val : ''}
                        </td>
                      )
                    })}
                    <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold font-brand">
                      {dayTotal > 0 ? dayTotal : ''}
                    </td>
                  </tr>
                )
              })}
              <TotalRow
                cells={[
                  ...activeEmployees.map(emp => sum(empLogs(emp), field) || ''),
                  grandTotal || '',
                ]}
              />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Conversion % table ──────────────────────────────────────────────────────

  const ConversionTable = () => (
    <div>
      <SectionTitle label="CONVERSION %" accent="bg-orange-600" />
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px] w-full">
          <TableHeader extraCols={[{ label: 'Total', cls: 'bg-orange-600' }]} />
          <tbody>
            {activeDays.map((day, i) => {
              const dayMS  = sum(dayLogs(day), 'memberships_sold')
              const dayOpp = sum(dayLogs(day), 'opportunities')
              return (
                <tr key={day} className={rowBg(i)}>
                  <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-500 font-brand">{day}</td>
                  {activeEmployees.map(emp => {
                    const rows = dayEmpLogs(day, emp)
                    return (
                      <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center text-orange-700 font-semibold font-brand">
                        {pct(sum(rows, 'memberships_sold'), sum(rows, 'opportunities'))}
                      </td>
                    )
                  })}
                  <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold font-brand">
                    {pct(dayMS, dayOpp)}
                  </td>
                </tr>
              )
            })}
            <TotalRow
              cells={activeEmployees.map(emp =>
                pct(sum(empLogs(emp), 'memberships_sold'), sum(empLogs(emp), 'opportunities'))
              )}
              extraCells={[{
                val: pct(sum(logs, 'memberships_sold'), sum(logs, 'opportunities')),
                cls: 'bg-orange-100 text-orange-800',
              }]}
            />
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── P-Mix % table ───────────────────────────────────────────────────────────

  const PMixTable = () => (
    <div>
      <SectionTitle label="P-MIX %" accent="bg-orange-600" />
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px] w-full">
          <TableHeader extraCols={[{ label: 'Total', cls: 'bg-orange-600' }]} />
          <tbody>
            {activeDays.map((day, i) => {
              const dl      = dayLogs(day)
              const dayMS   = sum(dl, 'memberships_sold')
              const dayPrem = sum(dl, 'better') + sum(dl, 'best')
              return (
                <tr key={day} className={rowBg(i)}>
                  <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-500 font-brand">{day}</td>
                  {activeEmployees.map(emp => {
                    const rows = dayEmpLogs(day, emp)
                    const ms   = sum(rows, 'memberships_sold')
                    const prem = sum(rows, 'better') + sum(rows, 'best')
                    return (
                      <td key={emp} className="border border-gray-200 px-2 py-1.5 text-center text-orange-700 font-semibold font-brand">
                        {pct(prem, ms)}
                      </td>
                    )
                  })}
                  <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold font-brand">
                    {pct(dayPrem, dayMS)}
                  </td>
                </tr>
              )
            })}
            <TotalRow
              cells={activeEmployees.map(emp => {
                const rows = empLogs(emp)
                return pct(sum(rows, 'better') + sum(rows, 'best'), sum(rows, 'memberships_sold'))
              })}
              extraCells={[{
                val: pct(sum(logs, 'better') + sum(logs, 'best'), sum(logs, 'memberships_sold')),
                cls: 'bg-orange-100 text-orange-800',
              }]}
            />
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── Layout ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-tm-blue text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">MTH</span>
        <h2 className="text-sm font-brand font-bold text-tm-blue tracking-wide uppercase">{monthLabel}</h2>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <CountTable title="TOTAL WASHES"      accentClass="bg-tm-blue"  field="total_washes" />
        <CountTable title="MEMBER WASHES"     accentClass="bg-tm-blue"  field="member_washes" />
        <CountTable title="MEMBERSHIP SALES"  accentClass="bg-[#1A3555]" field="memberships_sold" />
        <CountTable title="PREMIUM SALES"     accentClass="bg-[#1A3555]" field="best" />
        <ConversionTable />
        <PMixTable />
      </div>
    </div>
  )
}
