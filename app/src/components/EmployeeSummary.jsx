import { employeeDeltasByDay } from '../utils/logMath'

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const derive = (d, formula) => {
  const ms  = toInt(d.basic) + toInt(d.good) + toInt(d.better) + toInt(d.best)
  const opp = formula === 'simple'
    ? Math.max(0, toInt(d.total_washes) - toInt(d.member_washes))
    : Math.max(0, toInt(d.total_washes) - toInt(d.member_washes) + ms)
  return {
    tw:         toInt(d.total_washes),
    mw:         toInt(d.member_washes),
    gr:         toInt(d.google_reviews),
    nm:         toInt(d.net_members),
    ms,
    opp,
    btr:        toInt(d.better),
    bst:        toInt(d.best),
    p_mix:      ms  > 0 ? ((toInt(d.better) + toInt(d.best)) / ms  * 100).toFixed(1) + '%' : '',
    conversion: opp > 0 ? (ms / opp * 100).toFixed(1) + '%'                               : '',
  }
}

const HEADERS = [
  ['Employee',         'text-left',                                                           ],
  ['Google Reviews',   '',                                                                    ],
  ['Total Washes',     '',                                                                    ],
  ['Member Washes',    '',                                                                    ],
  ['Memberships Sold', 'bg-[#8ECFCB] text-tm-navy dark:bg-tm-teal/30 dark:text-white'        ],
  ['Opportunities',    'bg-[#8ECFCB] text-tm-navy dark:bg-tm-teal/30 dark:text-white'        ],
  ['Net Members',      '',                                                                    ],
  ['Better',           '',                                                                    ],
  ['Best',             '',                                                                    ],
  ['P-Mix',            'bg-orange-600'                                                        ],
  ['Conversion',       'bg-orange-600'                                                        ],
]

// rows come directly from DailyLogTable's live state — no fetch needed
export default function EmployeeSummary({ rows = [], opportunitiesFormula = 'detailed' }) {
  const namedRows = rows.filter(r => r.employee_name?.trim())
  const deltaMap  = employeeDeltasByDay(namedRows)

  const employees = Object.entries(deltaMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, d]) => ({ name, ...derive(d, opportunitiesFormula) }))

  const sumFields = { total_washes: 0, member_washes: 0, google_reviews: 0, net_members: 0, basic: 0, good: 0, better: 0, best: 0 }
  Object.values(deltaMap).forEach(d => {
    Object.keys(sumFields).forEach(f => { sumFields[f] += toInt(d[f]) })
  })
  const totals = derive(sumFields, opportunitiesFormula)

  return (
    <div>
      <h3 className="text-sm font-brand font-semibold text-tm-blue dark:text-white mb-3 uppercase tracking-widest">
        Employee Rollup
      </h3>

      {!employees.length ? (
        <p className="text-xs text-gray-400 dark:text-tm-dark-muted italic">
          No employee names entered in the log above yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr className="bg-tm-blue dark:bg-tm-navy text-white">
                {HEADERS.map(([h, cls]) => (
                  <th key={h} className={`px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold ${cls}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, i) => (
                <tr key={emp.name} className={i % 2 === 0 ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt' : 'bg-white dark:bg-tm-dark-surface'}>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-3 py-1.5 font-medium font-brand dark:text-tm-dark-text">{emp.name}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.gr  || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.tw  || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.mw  || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.ms  || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.opp || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.nm  || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.btr || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{emp.bst || ''}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 font-semibold">{emp.p_mix}</td>
                  <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 font-semibold">{emp.conversion}</td>
                </tr>
              ))}
              <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
                <td className="border border-gray-300 dark:border-tm-dark-border px-3 py-1.5 font-brand dark:text-tm-dark-text">Totals</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.gr  || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.tw  || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.mw  || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.ms  || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.opp || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.nm  || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.btr || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center dark:text-tm-dark-text">{totals.bst || ''}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300">{totals.p_mix}</td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300">{totals.conversion}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
