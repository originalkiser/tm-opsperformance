import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
} from 'recharts'

export const REDEMPTIONS_COLOR = '#1A3555'
export const SALES_COLOR       = '#8ECFCB'
export const OPP_COLOR         = '#ea580c'

function HourlyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const fmt = (v) => Number(v || 0).toLocaleString('en-US')
  return (
    <div className="bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded shadow-md px-3 py-2 text-xs font-brand space-y-0.5">
      <p className="text-gray-500 dark:text-tm-dark-muted font-semibold mb-1">{label}</p>
      <p className="text-tm-navy dark:text-tm-dark-text">Total Washes: <span className="font-semibold">{fmt(row.tw)}</span></p>
      <p style={{ color: REDEMPTIONS_COLOR }}>Membership Redemptions: <span className="font-semibold">{fmt(row.mw)}</span></p>
      <p style={{ color: SALES_COLOR }}>Sales: <span className="font-semibold">{fmt(row.ms)}</span></p>
      <p style={{ color: OPP_COLOR }}>Opportunities: <span className="font-semibold">{fmt(row.opp)}</span></p>
    </div>
  )
}

function TotalLabel({ x, y, width, value, fill }) {
  if (!value) return null
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fontFamily="Chakra Petch" fontWeight={600} fill={fill}>
      {Number(value).toLocaleString('en-US')}
    </text>
  )
}

export default function HourlyStackedChart({ title, data, dark, height = 220 }) {
  const axisColor = dark ? '#7A9BBF' : '#6B7280'
  const gridColor = dark ? '#1E3A5F' : '#f0f0f0'
  const labelFill = dark ? '#D6E4F0' : '#1A3555'
  const hasData   = data.some(d => (d.mw + d.ms + d.opp) > 0)

  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border shadow-sm p-4">
      <p className="text-xs font-brand font-semibold text-gray-600 dark:text-tm-dark-muted uppercase tracking-wide mb-3">{title}</p>
      {!hasData ? (
        <div className="flex items-center justify-center text-gray-300 dark:text-tm-dark-muted text-xs" style={{ height }}>No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: 'Chakra Petch', fill: axisColor }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} tickFormatter={v => Number(v).toLocaleString('en-US')} />
            <Tooltip content={<HourlyTooltip />} />
            <Bar dataKey="mw"  stackId="hr" fill={REDEMPTIONS_COLOR} />
            <Bar dataKey="ms"  stackId="hr" fill={SALES_COLOR} />
            <Bar dataKey="opp" stackId="hr" fill={OPP_COLOR} radius={[2, 2, 0, 0]}>
              <LabelList dataKey="tw" content={<TotalLabel fill={labelFill} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
