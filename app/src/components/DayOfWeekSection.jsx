import { useState, useMemo } from 'react'
import { employeeDeltasByDay } from '../utils/logMath'
import { pmixCls, convCls, pmixHex, convHex } from '../utils/metricColors'
import { fmtNum } from '../utils/format'
import { toInt, pct, pctN, toDayTotals } from '../utils/insightsHelpers'
import { exportCsv, exportXlsx, exportPdf } from '../utils/exportTable'
import { fmtDateRange } from './DateSelector'
import MiniChart from './MiniChart'
import ExportMenu from './ExportMenu'

const DOW_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon–Sun display order

const TEAL   = '#8ECFCB'
const ORANGE = '#ea580c'

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`}>
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
    </svg>
  )
}

export default function DayOfWeekSection({ logs, locations, dark, dateRange }) {
  const [showTotals, setShowTotals]   = useState(false)
  const [expandedDow, setExpandedDow] = useState(null)
  const [expandedShops, setExpandedShops] = useState(new Set())

  const toggleShop = (key) => {
    setExpandedShops(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const { dowStats, shopDowStats, empDowStats } = useMemo(() => {
    if (!logs.length) return { dowStats: {}, shopDowStats: {}, empDowStats: {} }

    // Group raw hourly rows by location+date for employee delta calc
    const locDateGroups = {}
    logs.forEach(r => {
      const key = `${r.location_id}::${r.log_date}`
      if (!locDateGroups[key]) locDateGroups[key] = []
      locDateGroups[key].push(r)
    })

    // One row per (location, date) for shop-level aggregation
    const dayTotals = toDayTotals(logs)

    // Count unique dates per DOW
    const dowDates = {}
    dayTotals.forEach(r => {
      const dow = new Date(r.log_date + 'T00:00:00').getDay()
      if (!dowDates[dow]) dowDates[dow] = new Set()
      dowDates[dow].add(r.log_date)
    })

    // Accumulate shop-level totals by (dow, locId)
    const shopDowRaw = {}
    dayTotals.forEach(r => {
      const dow = new Date(r.log_date + 'T00:00:00').getDay()
      const key = `${dow}::${r.location_id}`
      if (!shopDowRaw[key]) {
        shopDowRaw[key] = { dow, locId: r.location_id, tw: 0, mw: 0, ms: 0, opp: 0, gr: 0, btr: 0, bst: 0, dates: new Set() }
      }
      const t = shopDowRaw[key]
      t.tw  += toInt(r.total_washes);    t.mw  += toInt(r.member_washes)
      t.ms  += toInt(r.memberships_sold); t.opp += toInt(r.opportunities)
      t.gr  += toInt(r.google_reviews);  t.btr += toInt(r.better); t.bst += toInt(r.best)
      t.dates.add(r.log_date)
    })

    // Aggregate across shops → DOW totals
    const dowRaw = {}
    Object.values(shopDowRaw).forEach(s => {
      if (!dowRaw[s.dow]) dowRaw[s.dow] = { tw: 0, mw: 0, ms: 0, opp: 0, gr: 0, btr: 0, bst: 0 }
      const t = dowRaw[s.dow]
      t.tw += s.tw; t.mw += s.mw; t.ms += s.ms; t.opp += s.opp
      t.gr += s.gr; t.btr += s.btr; t.bst += s.bst
    })

    const makeStat = (raw, count) => {
      const n = Math.max(count, 1)
      return {
        ...raw,
        count:      n,
        avgTw:      Math.round(raw.tw  / n),
        avgMw:      Math.round(raw.mw  / n),
        avgMs:      Math.round(raw.ms  / n),
        avgGr:      Math.round(raw.gr  / n),
        p_mix:      pct(raw.btr + raw.bst, raw.ms),
        conversion: pct(raw.ms, raw.opp),
        pmixN:      pctN(raw.btr + raw.bst, raw.ms),
        convN:      pctN(raw.ms, raw.opp),
      }
    }

    const dowStats = {}
    Object.entries(dowRaw).forEach(([dow, raw]) => {
      dowStats[dow] = makeStat(raw, dowDates[dow]?.size || 1)
    })

    const shopDowStats = {}
    Object.entries(shopDowRaw).forEach(([key, raw]) => {
      shopDowStats[key] = makeStat(raw, raw.dates.size)
    })

    // Employee deltas accumulated by (dow, locId, empName)
    const empAccum = {}
    Object.entries(locDateGroups).forEach(([locDateKey, rows]) => {
      const colonIdx = locDateKey.indexOf('::')
      const locId    = locDateKey.slice(0, colonIdx)
      const date     = locDateKey.slice(colonIdx + 2)
      const dow      = new Date(date + 'T00:00:00').getDay()
      const deltas   = employeeDeltasByDay(rows)
      Object.entries(deltas).forEach(([name, d]) => {
        const eKey = `${dow}::${locId}::${name.toLowerCase()}`
        if (!empAccum[eKey]) {
          empAccum[eKey] = {
            dow, locId, name,
            tw: 0, mw: 0, gr: 0, basic: 0, good: 0, btr: 0, bst: 0,
            dates: new Set(),
          }
        }
        const e = empAccum[eKey]
        e.tw    += d.total_washes;   e.mw  += d.member_washes
        e.gr    += d.google_reviews; e.basic += d.basic; e.good += d.good
        e.btr   += d.better;         e.bst  += d.best
        e.dates.add(date)
      })
    })

    const empDowStats = {}
    Object.entries(empAccum).forEach(([key, e]) => {
      const ms  = e.basic + e.good + e.btr + e.bst
      const loc = locations.find(l => l.id === e.locId)
      const formula = loc?.opportunities_formula
      const opp = formula === 'simple'
        ? Math.max(0, e.tw - e.mw)
        : Math.max(0, e.tw - e.mw + ms)
      const n = Math.max(e.dates.size, 1)
      empDowStats[key] = {
        ...e, ms, opp,
        site:       loc?.name || e.locId,
        count:      n,
        avgMs:      Math.round(ms / n),
        avgGr:      Math.round(e.gr / n),
        p_mix:      pct(e.btr + e.bst, ms),
        conversion: pct(ms, opp),
        pmixN:      pctN(e.btr + e.bst, ms),
        convN:      pctN(ms, opp),
      }
    })

    return { dowStats, shopDowStats, empDowStats }
  }, [logs, locations])

  const navyColor = dark ? '#D6E4F0' : '#1A3555'

  const chartData = DOW_ORDER.map(dow => {
    const s = dowStats[dow]
    if (!s) return { label: DOW_SHORT[dow], tw: null, ms: null, mw: null, gr: null, conversion: null, pmix: null }
    return {
      label:      DOW_SHORT[dow],
      tw:         showTotals ? s.tw  : s.avgTw,
      ms:         showTotals ? s.ms  : s.avgMs,
      mw:         showTotals ? s.mw  : s.avgMw,
      gr:         showTotals ? s.gr  : s.avgGr,
      conversion: s.convN,
      pmix:       s.pmixN,
    }
  })

  const prefix = showTotals ? 'Total' : 'Avg'

  // Export spec for DOW summary table
  const exportRows = DOW_ORDER
    .filter(dow => dowStats[dow])
    .map(dow => {
      const s = dowStats[dow]
      return [
        DOW_FULL[dow],
        showTotals ? s.tw : s.avgTw,
        showTotals ? s.ms : s.avgMs,
        showTotals ? s.gr : s.avgGr,
        s.conversion,
        s.p_mix,
        s.count,
      ]
    })

  const exportSpec = {
    filename: `day-of-week_${dateRange.start}_to_${dateRange.end}`,
    title:    'Day of Week Performance',
    subtitle: `${showTotals ? 'Totals' : 'Averages'} — ${fmtDateRange(dateRange.start, dateRange.end)}`,
    columns: [
      { label: 'Day',               type: 'text' },
      { label: `${prefix} TW`,      type: 'num'  },
      { label: `${prefix} MS`,      type: 'num'  },
      { label: `${prefix} Google`,  type: 'num'  },
      { label: 'Conversion',        type: 'conv' },
      { label: 'P-Mix',             type: 'pmix' },
      { label: '# Days',            type: 'num'  },
    ],
    rows: exportRows,
  }

  if (!Object.keys(dowStats).length) return (
    <div className="text-sm text-gray-400 dark:text-tm-dark-muted py-4">No data for this period.</div>
  )

  return (
    <div>
      {/* Avg / Total toggle + export */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-tm-dark-border shadow-sm">
          {[{ label: 'Averages', val: false }, { label: 'Totals', val: true }].map(({ label, val }) => (
            <button
              key={label}
              onClick={() => setShowTotals(val)}
              className={`px-3 py-1.5 text-xs font-brand font-semibold transition-colors border-r last:border-r-0 border-gray-200 dark:border-tm-dark-border
                ${showTotals === val
                  ? 'bg-tm-blue dark:bg-tm-navy text-white'
                  : 'bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue dark:hover:text-white'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
        <ExportMenu items={[
          { label: 'Excel (.xlsx)', run: () => exportXlsx(exportSpec) },
          { label: 'PDF',           run: () => exportPdf(exportSpec)  },
          { label: 'CSV',           run: () => exportCsv(exportSpec)  },
        ]} />
      </div>

      {/* 6 mini charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <MiniChart title={`${prefix} Memberships Sold`} data={chartData} dataKey="ms"         color={TEAL}      dark={dark} />
        <MiniChart title="Conversion %"                 data={chartData} dataKey="conversion" color={ORANGE}    dark={dark} type="line" isPct />
        <MiniChart title={`${prefix} Google Reviews`}   data={chartData} dataKey="gr"         color={navyColor} dark={dark} />
        <MiniChart title={`${prefix} Total Washes`}     data={chartData} dataKey="tw"         color={navyColor} dark={dark} />
        <MiniChart title="P-Mix %"                      data={chartData} dataKey="pmix"       color={ORANGE}    dark={dark} type="line" isPct />
        <MiniChart title={`${prefix} Member Washes`}    data={chartData} dataKey="mw"         color={TEAL}      dark={dark} />
      </div>

      {/* Drill-down table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white text-left">
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide">Day</th>
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide text-center">{prefix} Total Washes</th>
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide text-center">{prefix} Memberships</th>
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide text-center">{prefix} Google</th>
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide text-center">Conversion</th>
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide text-center">P-Mix</th>
              <th className="px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide text-center"># Days</th>
            </tr>
          </thead>
          <tbody>
            {DOW_ORDER.map((dow, i) => {
              const s = dowStats[dow]
              if (!s) return null
              const isExpanded = expandedDow === dow
              const shopKeys   = Object.keys(shopDowStats).filter(k => k.startsWith(`${dow}::`))

              return [
                // DOW summary row
                <tr
                  key={`dow-${dow}`}
                  onClick={() => setExpandedDow(isExpanded ? null : dow)}
                  className={`cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'} hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10`}
                >
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 dark:text-tm-dark-muted"><ChevronIcon open={isExpanded} /></span>
                      <span className="font-brand font-semibold dark:text-tm-dark-text">{DOW_FULL[dow]}</span>
                    </div>
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">
                    {fmtNum(showTotals ? s.tw : s.avgTw)}
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">
                    {fmtNum(showTotals ? s.ms : s.avgMs)}
                  </td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center dark:text-tm-dark-text">
                    {fmtNum(showTotals ? s.gr : s.avgGr)}
                  </td>
                  <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(s.conversion)}`}>{s.conversion}</td>
                  <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(s.p_mix)}`}>{s.p_mix}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center text-gray-400 dark:text-tm-dark-muted">{s.count}</td>
                </tr>,

                // Expanded: shop rows
                ...(!isExpanded ? [] : shopKeys.map(shopKey => {
                  const ss        = shopDowStats[shopKey]
                  const loc       = locations.find(l => l.id === ss.locId)
                  const locName   = loc?.name || ss.locId
                  const shopExpKey = `${dow}::${ss.locId}`
                  const shopOpen  = expandedShops.has(shopExpKey)
                  const empKeys   = Object.keys(empDowStats).filter(k => k.startsWith(`${dow}::${ss.locId}::`))

                  return [
                    // Shop row
                    <tr
                      key={`shop-${shopKey}`}
                      onClick={() => toggleShop(shopExpKey)}
                      className="bg-tm-sky/10 dark:bg-tm-navy/30 cursor-pointer hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors"
                    >
                      <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 pl-8">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 dark:text-tm-dark-muted"><ChevronIcon open={shopOpen} /></span>
                          <span className="font-brand text-tm-blue dark:text-tm-teal font-medium">{locName}</span>
                        </div>
                      </td>
                      <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">
                        {fmtNum(showTotals ? ss.tw : ss.avgTw)}
                      </td>
                      <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">
                        {fmtNum(showTotals ? ss.ms : ss.avgMs)}
                      </td>
                      <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center text-gray-600 dark:text-tm-dark-text">
                        {fmtNum(showTotals ? ss.gr : ss.avgGr)}
                      </td>
                      <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${convCls(ss.conversion)}`}>{ss.conversion}</td>
                      <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center font-semibold ${pmixCls(ss.p_mix)}`}>{ss.p_mix}</td>
                      <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-2 text-center text-gray-400 dark:text-tm-dark-muted">{ss.count}</td>
                    </tr>,

                    // Employee rows
                    ...(!shopOpen ? [] : empKeys.map(empKey => {
                      const e = empDowStats[empKey]
                      return (
                        <tr key={`emp-${empKey}`} className="bg-white dark:bg-tm-dark-surface">
                          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 pl-14 text-gray-600 dark:text-tm-dark-muted font-brand">
                            {e.name}
                          </td>
                          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 text-center text-gray-500 dark:text-tm-dark-muted">—</td>
                          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 text-center dark:text-tm-dark-text">
                            {fmtNum(showTotals ? e.ms : e.avgMs)}
                          </td>
                          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 text-center dark:text-tm-dark-text">
                            {fmtNum(showTotals ? e.gr : e.avgGr)}
                          </td>
                          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 text-center font-semibold ${convCls(e.conversion)}`}>{e.conversion}</td>
                          <td className={`border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 text-center font-semibold ${pmixCls(e.p_mix)}`}>{e.p_mix}</td>
                          <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 text-center text-gray-400 dark:text-tm-dark-muted">{e.count}</td>
                        </tr>
                      )
                    })),
                  ]
                })),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
