import { useState } from 'react'
import { convHex, pmixHex } from '../utils/metricColors'
import { toInt, toDayTotals } from '../utils/insightsHelpers'
import { exportTrendsXlsx, exportTrendsPdf } from '../utils/exportTable'
import { fmtDateRange } from './DateSelector'
import MiniChart from './MiniChart'
import ExportMenu from './ExportMenu'
import { ShopMultiSelect } from './FilterControls'

const TEAL   = '#8ECFCB'
const ORANGE = '#ea580c'

export default function DailyTrendsSection({ logs, dark, locations, selected, onSelectedChange, dateRange }) {
  const chartData = (() => {
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
  })()

  const navyColor    = dark ? '#D6E4F0' : '#1A3555'
  const selectedLocs = selected === null
    ? locations
    : locations.filter(l => selected.includes(l.id))
  const trendLocation = selectedLocs.length === 1 ? selectedLocs[0] : null
  const shopsLabel = selectedLocs.length === locations.length
    ? 'All Sites'
    : selectedLocs.length === 1
      ? selectedLocs[0].name
      : `${selectedLocs.length} of ${locations.length} sites`
  const thresholds    = trendLocation?.metric_thresholds
  const convColorFn   = (v) => convHex(v, thresholds)
  const pmixColorFn   = (v) => pmixHex(v, thresholds)

  const trendsSpec = {
    filename: `daily-trends_${dateRange.start}_to_${dateRange.end}`,
    title:    'Daily Trends',
    subtitle: `${shopsLabel} — ${fmtDateRange(dateRange.start, dateRange.end)}`,
    charts: [
      { title: 'Daily Memberships Sold', dataKey: 'ms',         type: 'bar',  color: '#8ECFCB' },
      { title: 'Daily Conversion %',     dataKey: 'conversion', type: 'line', isPct: true, colorFn: convColorFn },
      { title: 'Daily Google Reviews',   dataKey: 'gr',         type: 'bar',  color: '#1A3555' },
      { title: 'Daily Total Washes',     dataKey: 'tw',         type: 'bar',  color: '#1A3555' },
      { title: 'Daily P-Mix %',          dataKey: 'pmix',       type: 'line', isPct: true, colorFn: pmixColorFn },
      { title: 'Daily Member Washes',    dataKey: 'mw',         type: 'bar',  color: '#8ECFCB' },
    ],
    data: chartData,
    thresholds,
    columns: [
      { label: 'Date',             type: 'text' },
      { label: 'Total Washes',     type: 'num'  },
      { label: 'Member Washes',    type: 'num'  },
      { label: 'Memberships Sold', type: 'num'  },
      { label: 'Google Reviews',   type: 'num'  },
      { label: 'P-Mix',            type: 'pmix' },
      { label: 'Conversion',       type: 'conv' },
    ],
    rows: chartData.map(d => [
      d.label, d.tw, d.mw, d.ms, d.gr,
      d.pmix       != null ? `${d.pmix}%`       : '',
      d.conversion != null ? `${d.conversion}%` : '',
    ]),
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <span className="text-sm text-gray-500 dark:text-tm-dark-muted">{shopsLabel}</span>
        <div className="flex items-center gap-2">
          {locations.length > 1 && (
            <>
              <label className="text-xs text-gray-500 dark:text-tm-dark-muted font-brand">Locations:</label>
              <ShopMultiSelect locations={locations} selected={selected} onChange={onSelectedChange} />
            </>
          )}
          {chartData.length > 0 && (
            <ExportMenu items={[
              { label: 'Excel — charts + table', run: () => exportTrendsXlsx({ ...trendsSpec, includeTable: true  }) },
              { label: 'Excel — charts only',    run: () => exportTrendsXlsx({ ...trendsSpec, includeTable: false }) },
              { label: 'PDF — charts + table',   run: () => exportTrendsPdf({  ...trendsSpec, includeTable: true  }) },
              { label: 'PDF — charts only',      run: () => exportTrendsPdf({  ...trendsSpec, includeTable: false }) },
            ]} />
          )}
        </div>
      </div>
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
