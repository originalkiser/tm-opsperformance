import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { shopTotals, employeeDeltasByDay } from '../utils/logMath'

const toInt = (v) => parseInt(v) || 0
const pct   = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : ''

const fmtSlot = (ts) => {
  if (!ts) return null
  const h = parseInt(ts.split(':')[0])
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${h12}:00 ${ampm}`
}

export default function MonthlyRollup({ locationId, selectedDate, opportunitiesFormula = 'detailed' }) {
  const [logs, setLogs]           = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]     = useState(true)

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

  const dayStr  = (day) => `${year}-${pad(month)}-${pad(day)}`
  const empLogs = (emp) => logs.filter(l => l.employee_name === emp)
  const dayLogs = (day) => logs.filter(l => l.log_date === dayStr(day))

  const NUMERIC = [
    'total_washes','member_washes','google_reviews','net_members',
    'basic','good','better','best',
  ]
  const activeEmployees = employees.filter(emp =>
    empLogs(emp).some(r => NUMERIC.some(f => toInt(r[f]) > 0))
  )

  const now    = new Date()
  const todayDay = (now.getFullYear() === year && now.getMonth() + 1 === month)
    ? now.getDate()
    : null

  const activeDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .filter(day => logs.some(l => l.log_date === dayStr(day)) || day === todayDay)

  const asOfTime = (day) => {
    if (day !== todayDay) return null
    return fmtSlot(shopTotals(dayLogs(day))?.time_slot ?? null)
  }

  // ── Delta helpers ─────────────────────────────────────────────────────────────

  // Returns delta-based day total for (day, emp), or null if no rows
  const getEmpDayTotal = (day, emp) => {
    const rows = dayLogs(day)
    if (!rows.length) return null
    return employeeDeltasByDay(rows)[emp] ?? null
  }

  // Returns the most recently updated row for the shop on a given day
  const getDayShopRow = (day) => shopTotals(dayLogs(day))

  // Get a specific raw/computed field from a delta total
  const deltaVal = (t, field) => {
    if (!t) return 0
    if (field === 'memberships_sold') return toInt(t.basic) + toInt(t.good) + toInt(t.better) + toInt(t.best)
    return toInt(t[field])
  }

  // Get a specific raw/computed field from a shop row
  const shopVal = (r, field) => {
    if (!r) return 0
    if (field === 'memberships_sold') return toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
    return toInt(r[field])
  }

  if (loading) return (
    <div className="py-12 text-center text-gray-400 dark:text-tm-dark-muted text-sm font-brand">
      Loading {monthLabel}…
    </div>
  )
  if (!logs.length) return (
    <div className="py-12 text-center text-gray-400 dark:text-tm-dark-muted text-sm font-brand">
      No data recorded for {monthLabel}.
    </div>
  )

  // ── Shared components ─────────────────────────────────────────────────────────

  const TableHeader = ({ extraCols = [] }) => (
    <thead>
      <tr className="bg-tm-blue dark:bg-tm-navy text-white">
        <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border text-left font-brand font-semibold text-[11px] w-24">DATE</th>
        {activeEmployees.map(emp => (
          <th key={emp} className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-[11px] min-w-[70px]">{emp}</th>
        ))}
        <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-[11px] min-w-[60px]">Total</th>
        {extraCols.map(({ label, cls = '' }) => (
          <th key={label} className={`px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-[11px] min-w-[70px] ${cls}`}>{label}</th>
        ))}
      </tr>
    </thead>
  )

  const TotalRow = ({ cells, extraCells = [] }) => (
    <tr className="bg-tm-sky/20 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
      <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand text-[11px] dark:text-tm-dark-text">Total</td>
      {cells.map((val, i) => (
        <td key={i} className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand text-[11px] dark:text-tm-dark-text">{val}</td>
      ))}
      {extraCells.map(({ val, cls = '' }, i) => (
        <td key={i} className={`border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand text-[11px] ${cls}`}>{val}</td>
      ))}
    </tr>
  )

  const rowBg = (i) => i % 2 === 0
    ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt'
    : 'bg-white dark:bg-tm-dark-surface'

  const SectionTitle = ({ label, accent }) => (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[10px] font-brand font-bold px-2 py-0.5 rounded tracking-widest text-white ${accent}`}>
        {label}
      </span>
    </div>
  )

  // ── Count table ───────────────────────────────────────────────────────────────

  const CountTable = ({ title, accentClass, field }) => {
    const empCellVal  = (day, emp) => deltaVal(getEmpDayTotal(day, emp), field)
    const shopCellVal = (day)      => shopVal(getDayShopRow(day), field)
    const empColTotal = (emp)      => activeDays.reduce((s, d) => s + empCellVal(d, emp), 0)
    const grandTotal               = activeDays.reduce((s, d) => s + shopCellVal(d), 0)

    return (
      <div>
        <SectionTitle label={title} accent={accentClass} />
        <div className="overflow-x-auto">
          <table className="border-collapse text-[11px] w-full">
            <TableHeader />
            <tbody>
              {activeDays.map((day, i) => (
                <tr key={day} className={rowBg(i)}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold text-gray-500 dark:text-tm-dark-muted font-brand leading-tight">
                    {month}/{day}/{year}
                    {asOfTime(day) && (
                      <div className="text-[9px] text-tm-teal font-normal whitespace-nowrap">(as of {asOfTime(day)})</div>
                    )}
                  </td>
                  {activeEmployees.map(emp => {
                    const val = empCellVal(day, emp)
                    return (
                      <td key={emp} className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand dark:text-tm-dark-text">
                        {val > 0 ? val : ''}
                      </td>
                    )
                  })}
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold font-brand dark:text-tm-dark-text">
                    {shopCellVal(day) > 0 ? shopCellVal(day) : ''}
                  </td>
                </tr>
              ))}
              <TotalRow
                cells={[
                  ...activeEmployees.map(emp => empColTotal(emp) || ''),
                  grandTotal || '',
                ]}
              />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Conversion % table ────────────────────────────────────────────────────────

  const ConversionTable = () => {
    const empDayConv = (day, emp) => {
      const t = getEmpDayTotal(day, emp)
      if (!t) return ''
      const ms  = t.basic + t.good + t.better + t.best
      const opp = opportunitiesFormula === 'simple'
        ? Math.max(0, t.total_washes - t.member_washes)
        : Math.max(0, t.total_washes - t.member_washes + ms)
      return pct(ms, opp)
    }

    const shopDayConv = (day) => {
      const r = getDayShopRow(day)
      if (!r) return ''
      const ms  = toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
      const opp = opportunitiesFormula === 'simple'
        ? Math.max(0, toInt(r.total_washes) - toInt(r.member_washes))
        : Math.max(0, toInt(r.total_washes) - toInt(r.member_washes) + ms)
      return pct(ms, opp)
    }

    const empColConv = (emp) => {
      let totMS = 0, totOpp = 0
      activeDays.forEach(day => {
        const t = getEmpDayTotal(day, emp)
        if (!t) return
        const ms  = t.basic + t.good + t.better + t.best
        const opp = opportunitiesFormula === 'simple'
          ? Math.max(0, t.total_washes - t.member_washes)
          : Math.max(0, t.total_washes - t.member_washes + ms)
        totMS  += ms
        totOpp += opp
      })
      return pct(totMS, totOpp)
    }

    let grMS = 0, grOpp = 0
    activeDays.forEach(day => {
      const r = getDayShopRow(day)
      if (!r) return
      const ms  = toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
      const opp = opportunitiesFormula === 'simple'
        ? Math.max(0, toInt(r.total_washes) - toInt(r.member_washes))
        : Math.max(0, toInt(r.total_washes) - toInt(r.member_washes) + ms)
      grMS  += ms
      grOpp += opp
    })

    return (
      <div>
        <SectionTitle label="CONVERSION %" accent="bg-orange-600" />
        <div className="overflow-x-auto">
          <table className="border-collapse text-[11px] w-full">
            <TableHeader extraCols={[{ label: 'Total', cls: 'bg-orange-600' }]} />
            <tbody>
              {activeDays.map((day, i) => (
                <tr key={day} className={rowBg(i)}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold text-gray-500 dark:text-tm-dark-muted font-brand leading-tight">
                    {month}/{day}/{year}
                    {asOfTime(day) && (
                      <div className="text-[9px] text-tm-teal font-normal whitespace-nowrap">(as of {asOfTime(day)})</div>
                    )}
                  </td>
                  {activeEmployees.map(emp => (
                    <td key={emp} className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center text-orange-700 dark:text-orange-300 font-semibold font-brand">
                      {empDayConv(day, emp)}
                    </td>
                  ))}
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 font-semibold font-brand">
                    {shopDayConv(day)}
                  </td>
                </tr>
              ))}
              <TotalRow
                cells={activeEmployees.map(emp => empColConv(emp))}
                extraCells={[{
                  val: pct(grMS, grOpp),
                  cls: 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300',
                }]}
              />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── P-Mix % table ─────────────────────────────────────────────────────────────

  const PMixTable = () => {
    const empDayPmix = (day, emp) => {
      const t = getEmpDayTotal(day, emp)
      if (!t) return ''
      const ms   = t.basic + t.good + t.better + t.best
      const prem = t.better + t.best
      return pct(prem, ms)
    }

    const shopDayPmix = (day) => {
      const r = getDayShopRow(day)
      if (!r) return ''
      const ms   = toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
      const prem = toInt(r.better) + toInt(r.best)
      return pct(prem, ms)
    }

    const empColPmix = (emp) => {
      let totMS = 0, totPrem = 0
      activeDays.forEach(day => {
        const t = getEmpDayTotal(day, emp)
        if (!t) return
        totMS   += t.basic + t.good + t.better + t.best
        totPrem += t.better + t.best
      })
      return pct(totPrem, totMS)
    }

    let grMS = 0, grPrem = 0
    activeDays.forEach(day => {
      const r = getDayShopRow(day)
      if (!r) return
      grMS   += toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
      grPrem += toInt(r.better) + toInt(r.best)
    })

    return (
      <div>
        <SectionTitle label="P-MIX %" accent="bg-orange-600" />
        <div className="overflow-x-auto">
          <table className="border-collapse text-[11px] w-full">
            <TableHeader extraCols={[{ label: 'Total', cls: 'bg-orange-600' }]} />
            <tbody>
              {activeDays.map((day, i) => (
                <tr key={day} className={rowBg(i)}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold text-gray-500 dark:text-tm-dark-muted font-brand leading-tight">
                    {month}/{day}/{year}
                    {asOfTime(day) && (
                      <div className="text-[9px] text-tm-teal font-normal whitespace-nowrap">(as of {asOfTime(day)})</div>
                    )}
                  </td>
                  {activeEmployees.map(emp => (
                    <td key={emp} className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center text-orange-700 dark:text-orange-300 font-semibold font-brand">
                      {empDayPmix(day, emp)}
                    </td>
                  ))}
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 font-semibold font-brand">
                    {shopDayPmix(day)}
                  </td>
                </tr>
              ))}
              <TotalRow
                cells={activeEmployees.map(emp => empColPmix(emp))}
                extraCells={[{
                  val: pct(grPrem, grMS),
                  cls: 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300',
                }]}
              />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Layout ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-tm-blue text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">MTH</span>
        <h2 className="text-sm font-brand font-bold text-tm-blue dark:text-tm-teal tracking-wide uppercase">{monthLabel}</h2>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <CountTable title="TOTAL WASHES"     accentClass="bg-tm-blue"   field="total_washes"     />
        <CountTable title="MEMBER WASHES"    accentClass="bg-tm-blue"   field="member_washes"    />
        <CountTable title="MEMBERSHIP SALES" accentClass="bg-[#1A3555]" field="memberships_sold" />
        <CountTable title="PREMIUM SALES"    accentClass="bg-[#1A3555]" field="best"             />
        <ConversionTable />
        <PMixTable />
      </div>
    </div>
  )
}
