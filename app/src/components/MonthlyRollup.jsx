import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { shopTotals, employeeDeltasByDay } from '../utils/logMath'
import { pmixCls, pmixTotalsCls, convCls, convTotalsCls } from '../utils/metricColors'
import { fmtNum } from '../utils/format'

const toInt = (v) => parseInt(v) || 0
const pct   = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : ''

const fmtSlot = (ts) => {
  if (!ts) return null
  const h = parseInt(ts.split(':')[0])
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${h12}:00 ${ampm}`
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr() {
  return toDateStr(new Date())
}

function buildDateList(start, end) {
  const dates = []
  const d = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  while (d <= e) {
    dates.push(toDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

function fmtRangeLabel(start, end) {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  const opts = { month: 'long', day: 'numeric' }
  if (start === end) {
    return s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  }
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`
  }
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}, ${e.getFullYear()}`
  }
  return `${s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

function fmtDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
}

export default function MonthlyRollup({ locationId, dateStart, dateEnd, opportunitiesFormula = 'detailed', metricThresholds }) {
  const [logs, setLogs]       = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [locationId, dateStart, dateEnd])

  const fetchData = async () => {
    setLoading(true)
    const [{ data: logData }, { data: empData }] = await Promise.all([
      supabase.from('daily_logs').select('*')
        .eq('location_id', locationId)
        .gte('log_date', dateStart)
        .lte('log_date', dateEnd),
      supabase.from('employees').select('name')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('name'),
    ])

    // Build canonical employee name map — case-insensitive, first-seen wins
    const canonicalMap = {}
    const addName = (name) => {
      const trimmed = name?.trim()
      if (!trimmed) return
      const lower = trimmed.toLowerCase()
      if (!canonicalMap[lower]) canonicalMap[lower] = trimmed
    }
    ;(empData  || []).forEach(e => addName(e.name))
    ;(logData  || []).forEach(l => addName(l.employee_name))
    const allNames = Object.values(canonicalMap).sort()

    setLogs(logData || [])
    setEmployees(allNames)
    setLoading(false)
  }

  const allDates   = buildDateList(dateStart, dateEnd)
  const today      = todayStr()
  const rangeLabel = fmtRangeLabel(dateStart, dateEnd)

  const dayLogs = (dateStr) => logs.filter(l => l.log_date === dateStr)

  // Case-insensitive employee log filter
  const empLogs = (emp) =>
    logs.filter(l => l.employee_name?.trim().toLowerCase() === emp.toLowerCase())

  const activeDays = allDates.filter(
    d => logs.some(l => l.log_date === d) || d === today
  )

  const asOfTime = (dateStr) => {
    if (dateStr !== today) return null
    return fmtSlot(shopTotals(dayLogs(dateStr))?.time_slot ?? null)
  }

  // ── Delta helpers ─────────────────────────────────────────────────────────────

  const getEmpDayTotal = (dateStr, emp) => {
    const rows = dayLogs(dateStr)
    if (!rows.length) return null
    const deltas = employeeDeltasByDay(rows)
    // Match by canonical name (employeeDeltasByDay returns canonical names)
    const entry = Object.entries(deltas).find(
      ([k]) => k.toLowerCase() === emp.toLowerCase()
    )
    return entry ? entry[1] : null
  }

  const getDayShopRow = (dateStr) => shopTotals(dayLogs(dateStr))

  const deltaVal = (t, field) => {
    if (!t) return 0
    if (field === 'memberships_sold') return toInt(t.basic) + toInt(t.good) + toInt(t.better) + toInt(t.best)
    return toInt(t[field])
  }

  const shopVal = (r, field) => {
    if (!r) return 0
    if (field === 'memberships_sold') return toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
    return toInt(r[field])
  }

  if (loading) return (
    <div className="py-12 flex items-center justify-center">
      <TmLoader />
    </div>
  )
  if (!logs.length) return (
    <div className="py-12 text-center text-gray-400 dark:text-tm-dark-muted text-sm font-brand">
      No data recorded for {rangeLabel}.
    </div>
  )

  // ── Shared sub-components ─────────────────────────────────────────────────────

  const activeEmployees = employees.filter(emp =>
    empLogs(emp).some(r => ['total_washes','member_washes','google_reviews','net_members','basic','good','better','best'].some(f => toInt(r[f]) > 0))
  )

  const TableHeader = ({ extraCols = [] }) => (
    <thead>
      <tr className="bg-tm-blue dark:bg-tm-navy text-white">
        <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border text-left font-brand font-semibold text-[11px] w-28">DATE</th>
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
    const empCellVal  = (d, emp) => deltaVal(getEmpDayTotal(d, emp), field)
    const shopCellVal = (d)      => shopVal(getDayShopRow(d), field)
    const empColTotal = (emp)    => activeDays.reduce((s, d) => s + empCellVal(d, emp), 0)
    const grandTotal             = activeDays.reduce((s, d) => s + shopCellVal(d), 0)

    return (
      <div>
        <SectionTitle label={title} accent={accentClass} />
        <div className="overflow-x-auto">
          <table className="border-collapse text-[11px] w-full">
            <TableHeader />
            <tbody>
              {activeDays.map((dateStr, i) => (
                <tr key={dateStr} className={rowBg(i)}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold text-gray-500 dark:text-tm-dark-muted font-brand leading-tight whitespace-nowrap">
                    {fmtDay(dateStr)}
                    {asOfTime(dateStr) && (
                      <div className="text-[9px] text-tm-teal font-normal whitespace-nowrap">(as of {asOfTime(dateStr)})</div>
                    )}
                  </td>
                  {activeEmployees.map(emp => {
                    const val = empCellVal(dateStr, emp)
                    return (
                      <td key={emp} className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand dark:text-tm-dark-text">
                        {fmtNum(val)}
                      </td>
                    )
                  })}
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold font-brand dark:text-tm-dark-text">
                    {fmtNum(shopCellVal(dateStr))}
                  </td>
                </tr>
              ))}
              <TotalRow
                cells={[
                  ...activeEmployees.map(emp => fmtNum(empColTotal(emp))),
                  fmtNum(grandTotal),
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
    const empDayConv = (dateStr, emp) => {
      const t = getEmpDayTotal(dateStr, emp)
      if (!t) return ''
      const ms  = t.basic + t.good + t.better + t.best
      const opp = opportunitiesFormula === 'simple'
        ? Math.max(0, t.total_washes - t.member_washes)
        : Math.max(0, t.total_washes - t.member_washes + ms)
      return pct(ms, opp)
    }

    const shopDayConv = (dateStr) => {
      const r = getDayShopRow(dateStr)
      if (!r) return ''
      const ms  = toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
      const opp = opportunitiesFormula === 'simple'
        ? Math.max(0, toInt(r.total_washes) - toInt(r.member_washes))
        : Math.max(0, toInt(r.total_washes) - toInt(r.member_washes) + ms)
      return pct(ms, opp)
    }

    const empColConv = (emp) => {
      let totMS = 0, totOpp = 0
      activeDays.forEach(dateStr => {
        const t = getEmpDayTotal(dateStr, emp)
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
    activeDays.forEach(dateStr => {
      const r = getDayShopRow(dateStr)
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
              {activeDays.map((dateStr, i) => (
                <tr key={dateStr} className={rowBg(i)}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold text-gray-500 dark:text-tm-dark-muted font-brand leading-tight whitespace-nowrap">
                    {fmtDay(dateStr)}
                    {asOfTime(dateStr) && (
                      <div className="text-[9px] text-tm-teal font-normal whitespace-nowrap">(as of {asOfTime(dateStr)})</div>
                    )}
                  </td>
                  {activeEmployees.map(emp => (
                    <td key={emp} className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold font-brand ${convCls(empDayConv(dateStr, emp), metricThresholds)}`}>
                      {empDayConv(dateStr, emp)}
                    </td>
                  ))}
                  <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold font-brand ${convCls(shopDayConv(dateStr), metricThresholds)}`}>
                    {shopDayConv(dateStr)}
                  </td>
                </tr>
              ))}
              <TotalRow
                cells={activeEmployees.map(emp => empColConv(emp))}
                extraCells={[{
                  val: pct(grMS, grOpp),
                  cls: convTotalsCls(pct(grMS, grOpp), metricThresholds),
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
    const empDayPmix = (dateStr, emp) => {
      const t = getEmpDayTotal(dateStr, emp)
      if (!t) return ''
      const ms   = t.basic + t.good + t.better + t.best
      const prem = t.better + t.best
      return pct(prem, ms)
    }

    const shopDayPmix = (dateStr) => {
      const r = getDayShopRow(dateStr)
      if (!r) return ''
      const ms   = toInt(r.basic) + toInt(r.good) + toInt(r.better) + toInt(r.best)
      const prem = toInt(r.better) + toInt(r.best)
      return pct(prem, ms)
    }

    const empColPmix = (emp) => {
      let totMS = 0, totPrem = 0
      activeDays.forEach(dateStr => {
        const t = getEmpDayTotal(dateStr, emp)
        if (!t) return
        totMS   += t.basic + t.good + t.better + t.best
        totPrem += t.better + t.best
      })
      return pct(totPrem, totMS)
    }

    let grMS = 0, grPrem = 0
    activeDays.forEach(dateStr => {
      const r = getDayShopRow(dateStr)
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
              {activeDays.map((dateStr, i) => (
                <tr key={dateStr} className={rowBg(i)}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold text-gray-500 dark:text-tm-dark-muted font-brand leading-tight whitespace-nowrap">
                    {fmtDay(dateStr)}
                    {asOfTime(dateStr) && (
                      <div className="text-[9px] text-tm-teal font-normal whitespace-nowrap">(as of {asOfTime(dateStr)})</div>
                    )}
                  </td>
                  {activeEmployees.map(emp => (
                    <td key={emp} className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold font-brand ${pmixCls(empDayPmix(dateStr, emp), metricThresholds)}`}>
                      {empDayPmix(dateStr, emp)}
                    </td>
                  ))}
                  <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold font-brand ${pmixCls(shopDayPmix(dateStr), metricThresholds)}`}>
                    {shopDayPmix(dateStr)}
                  </td>
                </tr>
              ))}
              <TotalRow
                cells={activeEmployees.map(emp => empColPmix(emp))}
                extraCells={[{
                  val: pct(grPrem, grMS),
                  cls: pmixTotalsCls(pct(grPrem, grMS), metricThresholds),
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
        <span className="bg-tm-blue text-white text-xs font-brand font-bold px-2 py-1 rounded tracking-widest">
          {allDates.length <= 7 ? 'WK' : allDates.length <= 31 ? 'MTH' : 'RNG'}
        </span>
        <h2 className="text-sm font-brand font-bold text-tm-blue dark:text-tm-teal tracking-wide uppercase">
          {rangeLabel}
        </h2>
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
