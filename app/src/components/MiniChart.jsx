import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'

function ChartTooltip({ active, payload, label, isPct }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div className="bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded shadow-md px-3 py-2 text-xs font-brand">
      <p className="text-gray-500 dark:text-tm-dark-muted mb-1">{label}</p>
      <p className="font-semibold text-tm-blue dark:text-tm-teal">
        {val != null ? (isPct ? `${val}%` : val.toLocaleString('en-US')) : '—'}
      </p>
    </div>
  )
}

export default function MiniChart({ title, data, dataKey, color, isPct = false, type = 'bar', dark, colorFn, height = 140 }) {
  const axisColor  = dark ? '#7A9BBF' : '#6B7280'
  const gridColor  = dark ? '#1E3A5F' : '#f0f0f0'
  const lineStroke = colorFn ? (dark ? '#4b6175' : '#9ca3af') : color
  const hasData    = data.some(d => d[dataKey] != null && d[dataKey] > 0)

  const customDot = colorFn
    ? (props) => {
        const { cx, cy, value } = props
        if (value == null) return null
        const c = colorFn(value)
        return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={c} stroke={c} strokeWidth={1} />
      }
    : { r: 3, fill: color }

  return (
    <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border shadow-sm p-4">
      <p className="text-xs font-brand font-semibold text-gray-600 dark:text-tm-dark-muted uppercase tracking-wide mb-3">{title}</p>
      {!hasData ? (
        <div className="flex items-center justify-center text-gray-300 dark:text-tm-dark-muted text-xs" style={{ height }}>No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {type === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: 'Chakra Petch', fill: axisColor }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} tickFormatter={v => isPct ? `${v}%` : Number(v).toLocaleString('en-US')} />
              <Tooltip content={<ChartTooltip isPct={isPct} />} />
              <Line type="monotone" dataKey={dataKey} stroke={lineStroke} strokeWidth={2} dot={customDot} connectNulls={false} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: 'Chakra Petch', fill: axisColor }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Chakra Petch', fill: axisColor }} tickFormatter={v => Number(v).toLocaleString('en-US')} />
              <Tooltip content={<ChartTooltip isPct={isPct} />} />
              <Bar dataKey={dataKey} fill={colorFn ? undefined : color} radius={[2, 2, 0, 0]}>
                {colorFn && data.map((entry, i) => (
                  <Cell key={i} fill={colorFn(entry[dataKey])} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}
