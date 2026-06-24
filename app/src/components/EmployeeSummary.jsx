import { useState } from 'react'
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

const IMG_COLS = [
  { key: 'name', label: 'Employee',         align: 'left',   w: 90                    },
  { key: 'gr',   label: 'Google\nReviews',  align: 'center', w: 68                    },
  { key: 'tw',   label: 'Total\nWashes',    align: 'center', w: 64                    },
  { key: 'mw',   label: 'Member\nWashes',   align: 'center', w: 68                    },
  { key: 'ms',   label: 'Memberships\nSold',align: 'center', w: 78, accent: 'teal'    },
  { key: 'opp',  label: 'Opportunities',    align: 'center', w: 74, accent: 'teal'    },
  { key: 'nm',   label: 'Net\nMembers',     align: 'center', w: 64                    },
  { key: 'btr',  label: 'Better',           align: 'center', w: 50                    },
  { key: 'bst',  label: 'Best',             align: 'center', w: 50                    },
  { key: 'p_mix',      label: 'P-Mix',      align: 'center', w: 58, accent: 'orange'  },
  { key: 'conversion', label: 'Conversion', align: 'center', w: 68, accent: 'orange'  },
]

// rows come directly from DailyLogTable's live state — no fetch needed
export default function EmployeeSummary({ rows = [], opportunitiesFormula = 'detailed', locationName, selectedDate }) {
  const [copyFeedback, setCopyFeedback] = useState(false)

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

  // ── Copy rollup as image ─────────────────────────────────────────────────────

  const copyRollupAsImage = async () => {
    if (!employees.length) return

    const SCALE    = 2
    const BANNER_H = 36
    const HEADER_H = 40
    const ROW_H    = 24
    const PAD      = 6
    const FONT     = `-apple-system, "Segoe UI", Arial, sans-serif`

    const totalW = IMG_COLS.reduce((s, c) => s + c.w, 0)
    const totalH = BANNER_H + HEADER_H + (employees.length + 1) * ROW_H  // +1 for totals row

    const canvas = document.createElement('canvas')
    canvas.width  = totalW * SCALE
    canvas.height = totalH * SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)

    const C = {
      navyBg: '#1B3A5C', tealBg: '#4DBDB5', orangeBg: '#D97706',
      white: '#FFFFFF', navyText: '#0F2740', bodyText: '#1F2937',
      blueText: '#1E3A8A', orangeText: '#92400E',
      rowAlt: '#EEF9F8', rowNorm: '#FFFFFF',
      tealCell: '#CBF0EC', orangeCell: '#FFF3E8',
      totRow: '#C0E8E3', totTeal: '#9FD9D4', totOrange: '#FED7AA',
      grid: '#D1D5DB', border: '#9CA3AF',
    }

    const ft = (text, x, y, align) => {
      ctx.textAlign    = align === 'left' ? 'left' : 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(text), x, y)
    }

    // ── Banner ──
    const dateLabel = selectedDate
      ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        })
      : ''
    ctx.fillStyle = C.navyBg
    ctx.fillRect(0, 0, totalW, BANNER_H)
    ctx.fillStyle = C.white
    ctx.font      = `bold 13px ${FONT}`
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(locationName || '', PAD + 2, BANNER_H / 2)
    ctx.font      = `12px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillStyle = '#7DD4CF'
    ctx.fillText(dateLabel, totalW - PAD - 2, BANNER_H / 2)

    // ── Header ──
    let x = 0
    IMG_COLS.forEach(col => {
      ctx.fillStyle = col.accent === 'teal' ? C.tealBg : col.accent === 'orange' ? C.orangeBg : C.navyBg
      ctx.fillRect(x, BANNER_H, col.w, HEADER_H)
      ctx.fillStyle = col.accent === 'teal' ? C.navyText : C.white
      ctx.font      = `bold 10px ${FONT}`
      const lines  = col.label.split('\n')
      const lineH  = 13
      const startY = BANNER_H + HEADER_H / 2 - (lines.length - 1) * lineH / 2
      lines.forEach((line, li) => ft(line, col.align === 'left' ? x + PAD : x + col.w / 2, startY + li * lineH, col.align))
      x += col.w
    })

    // ── Employee rows ──
    employees.forEach((emp, i) => {
      const y   = BANNER_H + HEADER_H + i * ROW_H
      const alt = i % 2 === 0
      let cx = 0
      IMG_COLS.forEach(col => {
        ctx.fillStyle = col.accent === 'teal' ? C.tealCell : col.accent === 'orange' ? C.orangeCell : alt ? C.rowAlt : C.rowNorm
        ctx.fillRect(cx, y, col.w, ROW_H)
        const val = emp[col.key]
        if (val) {
          ctx.fillStyle = col.accent === 'orange' ? C.orangeText : col.accent === 'teal' ? C.blueText : C.bodyText
          ctx.font = `${col.key === 'name' ? '500' : '400'} 10px ${FONT}`
          ft(val, col.align === 'left' ? cx + PAD : cx + col.w / 2, y + ROW_H / 2, col.align)
        }
        cx += col.w
      })
    })

    // ── Totals row ──
    const totY = BANNER_H + HEADER_H + employees.length * ROW_H
    const totVals = { name: 'Totals', ...totals }
    let tx = 0
    IMG_COLS.forEach(col => {
      ctx.fillStyle = col.accent === 'teal' ? C.totTeal : col.accent === 'orange' ? C.totOrange : C.totRow
      ctx.fillRect(tx, totY, col.w, ROW_H)
      const val = totVals[col.key]
      if (val) {
        ctx.fillStyle = col.accent === 'orange' ? C.orangeText : C.blueText
        ctx.font      = `bold 10px ${FONT}`
        ft(val, col.align === 'left' ? tx + PAD : tx + col.w / 2, totY + ROW_H / 2, col.align)
      }
      tx += col.w
    })

    // ── Grid lines ──
    ctx.strokeStyle = C.grid
    ctx.lineWidth   = 0.5
    let gx = 0
    IMG_COLS.forEach(col => {
      ctx.beginPath(); ctx.moveTo(gx, BANNER_H); ctx.lineTo(gx, totalH); ctx.stroke()
      gx += col.w
    })
    ctx.beginPath(); ctx.moveTo(gx, BANNER_H); ctx.lineTo(gx, totalH); ctx.stroke()
    const hLines = [
      BANNER_H, BANNER_H + HEADER_H,
      ...Array.from({ length: employees.length }, (_, i) => BANNER_H + HEADER_H + (i + 1) * ROW_H),
      totalH,
    ]
    hLines.forEach(gy => { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(totalW, gy); ctx.stroke() })
    ctx.strokeStyle = C.border
    ctx.lineWidth   = 1
    ctx.strokeRect(0.5, 0.5, totalW - 1, totalH - 1)

    // ── Copy ──
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      } catch {
        // fallback: nothing to do for employee rollup text copy
      }
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    }, 'image/png')
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-brand font-semibold text-tm-blue dark:text-white uppercase tracking-widest">
          Employee Rollup
        </h3>
        {employees.length > 0 && (
          <button
            onClick={copyRollupAsImage}
            className="px-3 py-1 rounded-md border border-gray-200 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted bg-white dark:bg-tm-dark-surface hover:border-tm-teal hover:text-tm-blue dark:hover:text-tm-teal transition-colors font-brand text-xs font-semibold"
          >
            {copyFeedback ? '✓ Copied!' : '⎘ Copy'}
          </button>
        )}
      </div>

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
