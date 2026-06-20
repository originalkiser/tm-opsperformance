import { shopTotals, employeeDeltas } from '../utils/logMath'

const toInt = (v) => Math.max(0, parseInt(v) || 0)
const pct   = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : '—'

function MedalIcon({ rank }) {
  if (rank === 1) return <span className="text-yellow-400 text-base">🥇</span>
  if (rank === 2) return <span className="text-gray-400 text-base">🥈</span>
  if (rank === 3) return <span className="text-orange-500 text-base">🥉</span>
  return <span className="text-gray-300 dark:text-tm-dark-muted text-xs font-bold w-5 text-center">{rank}</span>
}

export default function DailySnapshot({ rows = [], date, locationName, opportunitiesFormula = 'detailed' }) {
  const namedRows = rows.filter(r => r.employee_name?.trim())

  // ── Employee totals via delta logic ──────────────────────────────────────────
  const grouped = {}
  namedRows.forEach(r => {
    const name = r.employee_name.trim()
    if (!grouped[name]) grouped[name] = []
    grouped[name].push(r)
  })

  const empStats = Object.entries(grouped).map(([name, empRows]) => {
    const { dayTotal } = employeeDeltas(empRows)
    const ms  = dayTotal.basic + dayTotal.good + dayTotal.better + dayTotal.best
    const opp = opportunitiesFormula === 'simple'
      ? Math.max(0, dayTotal.total_washes - dayTotal.member_washes)
      : Math.max(0, dayTotal.total_washes - dayTotal.member_washes + ms)
    return {
      name,
      ms,
      opp,
      gr:         dayTotal.google_reviews,
      conversion: pct(ms, opp),
      pmix:       pct(dayTotal.better + dayTotal.best, ms),
    }
  }).sort((a, b) => b.ms - a.ms)

  // ── Shop totals via latest-row logic ─────────────────────────────────────────
  const latest  = shopTotals(rows)
  const totTW   = toInt(latest?.total_washes)
  const totMW   = toInt(latest?.member_washes)
  const totGR   = toInt(latest?.google_reviews)
  const totBasic  = toInt(latest?.basic)
  const totGood   = toInt(latest?.good)
  const totBetter = toInt(latest?.better)
  const totBest   = toInt(latest?.best)
  const totMS   = totBasic + totGood + totBetter + totBest
  const totOpp  = opportunitiesFormula === 'simple'
    ? Math.max(0, totTW - totMW)
    : Math.max(0, totTW - totMW + totMS)
  const totConv = pct(totMS, totOpp)
  const totPmix = pct(totBetter + totBest, totMS)

  const displayDate = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : ''

  if (!rows.length || rows.every(r => !r.employee_name?.trim() && toInt(r.total_washes) === 0)) {
    return (
      <div className="py-12 text-center text-gray-400 dark:text-tm-dark-muted text-sm font-brand">
        No data entered for this day yet.
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">

      {/* Header */}
      <div className="bg-tm-navy dark:bg-tm-dark-nav rounded-xl px-5 py-4 text-white">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex flex-col items-center bg-tm-navy border border-tm-teal/40 rounded px-2 py-0.5 leading-none">
            <span className="text-tm-teal font-brand font-semibold tracking-widest text-[6px] uppercase">Trademark</span>
            <span className="text-white font-brand font-bold tracking-wider text-[10px] uppercase leading-tight">Car Wash</span>
          </div>
          <div>
            <div className="font-brand font-bold text-sm tracking-wide leading-tight">{locationName}</div>
            <div className="text-tm-teal text-xs font-brand">{displayDate}</div>
          </div>
        </div>
      </div>

      {/* Overall Performance */}
      <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border shadow-sm p-4">
        <h3 className="font-brand font-bold text-xs uppercase tracking-widest text-tm-blue dark:text-tm-teal mb-3">
          Overall Performance
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Washes',     value: totTW  || '—', accent: false },
            { label: 'Member Washes',    value: totMW  || '—', accent: false },
            { label: 'Memberships Sold', value: totMS  || '—', accent: false },
            { label: 'Google Reviews',   value: totGR  || '—', accent: false },
            { label: 'Conversion',       value: totConv,        accent: true  },
            { label: 'P-Mix',            value: totPmix,        accent: true  },
          ].map(({ label, value, accent }) => (
            <div
              key={label}
              className={`rounded-lg p-3 ${
                accent
                  ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30'
                  : 'bg-tm-sky/20 dark:bg-tm-teal/10 border border-tm-sky/30 dark:border-tm-teal/20'
              }`}
            >
              <div className="text-[10px] font-brand font-semibold uppercase tracking-wide text-gray-500 dark:text-tm-dark-muted mb-0.5">
                {label}
              </div>
              <div className={`text-xl font-bold font-brand ${
                accent
                  ? 'text-orange-700 dark:text-orange-300'
                  : 'text-tm-blue dark:text-tm-teal'
              }`}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Sellers */}
      {empStats.length > 0 && (
        <div className="bg-white dark:bg-tm-dark-surface rounded-xl border border-gray-100 dark:border-tm-dark-border shadow-sm p-4">
          <h3 className="font-brand font-bold text-xs uppercase tracking-widest text-tm-blue dark:text-tm-teal mb-3">
            Top Sellers
          </h3>
          <div className="space-y-2">
            {empStats.map((emp, idx) => (
              <div
                key={emp.name}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                  idx === 0
                    ? 'bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-100 dark:border-yellow-900/30'
                    : 'bg-gray-50 dark:bg-tm-dark-row-alt border border-gray-100 dark:border-tm-dark-border'
                }`}
              >
                <div className="w-6 flex items-center justify-center flex-shrink-0">
                  <MedalIcon rank={idx + 1} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-brand font-bold text-sm text-gray-800 dark:text-tm-dark-text truncate">
                    {emp.name}
                  </div>
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-gray-500 dark:text-tm-dark-muted font-brand">
                      Conv: <span className="font-semibold text-orange-700 dark:text-orange-300">{emp.conversion}</span>
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-tm-dark-muted font-brand">
                      P-Mix: <span className="font-semibold text-orange-700 dark:text-orange-300">{emp.pmix}</span>
                    </span>
                    {emp.gr > 0 && (
                      <span className="text-[10px] text-gray-500 dark:text-tm-dark-muted font-brand">
                        Reviews: <span className="font-semibold text-tm-blue dark:text-tm-teal">{emp.gr}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-brand font-bold text-lg text-tm-blue dark:text-tm-teal leading-tight">
                    {emp.ms}
                  </div>
                  <div className="text-[10px] font-brand text-gray-400 dark:text-tm-dark-muted uppercase tracking-wide">
                    sold
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
