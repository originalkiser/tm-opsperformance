import { useState } from 'react'
import { shopTotals, employeeDeltasByDay } from '../utils/logMath'

const toInt = (v) => Math.max(0, parseInt(v) || 0)
const pct   = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : '—'

function MedalIcon({ rank }) {
  if (rank === 1) return <span className="text-yellow-400 text-base">🥇</span>
  if (rank === 2) return <span className="text-gray-400 text-base">🥈</span>
  if (rank === 3) return <span className="text-orange-500 text-base">🥉</span>
  return <span className="text-gray-300 dark:text-tm-dark-muted text-xs font-bold w-5 text-center">{rank}</span>
}

export default function DailySnapshot({ rows = [], date, locationName, opportunitiesFormula = 'detailed' }) {
  const [copyFeedback, setCopyFeedback] = useState(false)

  const namedRows = rows.filter(r => r.employee_name?.trim())

  // ── Employee totals via delta logic ──────────────────────────────────────────
  const deltaMap = employeeDeltasByDay(namedRows)

  const empStats = Object.entries(deltaMap).map(([name, d]) => {
    const ms  = d.basic + d.good + d.better + d.best
    const opp = opportunitiesFormula === 'simple'
      ? Math.max(0, d.total_washes - d.member_washes)
      : Math.max(0, d.total_washes - d.member_washes + ms)
    return {
      name,
      ms,
      opp,
      gr:         d.google_reviews,
      conversion: pct(ms, opp),
      pmix:       pct(d.better + d.best, ms),
    }
  }).sort((a, b) => b.ms - a.ms)

  // ── Shop totals via latest-row logic ─────────────────────────────────────────
  const latest    = shopTotals(rows)
  const totTW     = toInt(latest?.total_washes)
  const totMW     = toInt(latest?.member_washes)
  const totGR     = toInt(latest?.google_reviews)
  const totBasic  = toInt(latest?.basic)
  const totGood   = toInt(latest?.good)
  const totBetter = toInt(latest?.better)
  const totBest   = toInt(latest?.best)
  const totMS     = totBasic + totGood + totBetter + totBest
  const totOpp    = opportunitiesFormula === 'simple'
    ? Math.max(0, totTW - totMW)
    : Math.max(0, totTW - totMW + totMS)
  const totConv = pct(totMS, totOpp)
  const totPmix = pct(totBetter + totBest, totMS)

  const displayDate = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : ''

  const hasData = rows.length && rows.some(r => r.employee_name?.trim() || toInt(r.total_washes) > 0)

  // ── Copy as image ─────────────────────────────────────────────────────────────

  const copySnapshotAsImage = async () => {
    const SCALE = 2
    const W     = 400
    const FONT  = `-apple-system, "Segoe UI", Arial, sans-serif`
    const PAD   = 12

    const C = {
      navy: '#1B3A5C', teal: '#4DBDB5', white: '#FFFFFF',
      tealLight: '#EEF9F8', tealBorder: '#C8EAE8', tealText: '#1E3A8A',
      orangeLight: '#FFF3E8', orangeBorder: '#FED7AA', orangeText: '#92400E',
      body: '#1F2937', muted: '#6B7280',
      sectionBg: '#FFFFFF', border: '#E5E7EB',
      pageBg: '#F3F4F6',
      gold: '#FEF3C7', goldBorder: '#FDE68A',
      rowBg: '#F9FAFB',
    }

    const rr = (ctx, x, y, w, h, r) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y,     x + w, y + r)
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x,     y + h, x,     y + h - r)
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
    }

    const BANNER_H      = 64
    const SEC_TITLE_H   = 30
    const STAT_H        = 64
    const STAT_GAP      = 8
    const STAT_ROWS     = 3
    const OVERALL_H     = PAD + SEC_TITLE_H + STAT_ROWS * STAT_H + (STAT_ROWS - 1) * STAT_GAP + PAD
    const EMP_H         = 50
    const EMP_GAP       = 6
    const TOP_H         = empStats.length > 0
      ? PAD + SEC_TITLE_H + empStats.length * EMP_H + (empStats.length - 1) * EMP_GAP + PAD
      : 0
    const SEC_GAP       = 10
    const totalH = BANNER_H + SEC_GAP + OVERALL_H + (TOP_H > 0 ? SEC_GAP + TOP_H : 0) + PAD

    const canvas = document.createElement('canvas')
    canvas.width  = W * SCALE
    canvas.height = totalH * SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)

    // Page bg
    ctx.fillStyle = C.pageBg
    ctx.fillRect(0, 0, W, totalH)

    // ── Banner ──
    ctx.fillStyle = C.navy
    ctx.fillRect(0, 0, W, BANNER_H)

    // Logo box
    rr(ctx, 12, 14, 54, 36, 4)
    ctx.strokeStyle = 'rgba(77,189,181,0.5)'
    ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = C.teal
    ctx.font = `bold 5.5px ${FONT}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('TRADEMARK', 39, 27)
    ctx.fillStyle = C.white
    ctx.font = `bold 7px ${FONT}`
    ctx.fillText('CAR WASH', 39, 38)

    // Name + date
    ctx.fillStyle = C.white
    ctx.font = `bold 14px ${FONT}`
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(locationName || '', 76, 30)
    ctx.fillStyle = C.teal
    ctx.font = `11px ${FONT}`
    ctx.fillText(displayDate, 76, 47)

    // ── Overall Performance ──
    const s1y = BANNER_H + SEC_GAP
    rr(ctx, PAD, s1y, W - PAD * 2, OVERALL_H, 8)
    ctx.fillStyle = C.sectionBg; ctx.fill()
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke()

    ctx.fillStyle = C.tealText
    ctx.font = `bold 8.5px ${FONT}`
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText('OVERALL PERFORMANCE', PAD + 10, s1y + PAD + SEC_TITLE_H / 2)

    const statItems = [
      { label: 'Total Washes',     value: totTW  || '—', accent: false },
      { label: 'Member Washes',    value: totMW  || '—', accent: false },
      { label: 'Memberships Sold', value: totMS  || '—', accent: false },
      { label: 'Google Reviews',   value: totGR  || '—', accent: false },
      { label: 'Conversion',       value: totConv,        accent: true  },
      { label: 'P-Mix',            value: totPmix,        accent: true  },
    ]

    const statAreaX = PAD + 10
    const statAreaW = W - PAD * 2 - 20
    const cellW     = (statAreaW - STAT_GAP) / 2
    const statStartY = s1y + PAD + SEC_TITLE_H

    statItems.forEach((stat, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      const sx  = statAreaX + col * (cellW + STAT_GAP)
      const sy  = statStartY + row * (STAT_H + STAT_GAP)

      rr(ctx, sx, sy, cellW, STAT_H, 6)
      ctx.fillStyle   = stat.accent ? C.orangeLight : C.tealLight; ctx.fill()
      ctx.strokeStyle = stat.accent ? C.orangeBorder : C.tealBorder
      ctx.lineWidth   = 1; ctx.stroke()

      ctx.fillStyle    = C.muted
      ctx.font         = `bold 7.5px ${FONT}`
      ctx.textAlign    = 'left'; ctx.textBaseline = 'top'
      ctx.fillText(stat.label.toUpperCase(), sx + 8, sy + 9)

      ctx.fillStyle    = stat.accent ? C.orangeText : C.tealText
      ctx.font         = `bold 22px ${FONT}`
      ctx.textBaseline = 'bottom'
      ctx.fillText(String(stat.value), sx + 8, sy + STAT_H - 8)
    })

    // ── Top Sellers ──
    if (empStats.length > 0) {
      const s2y = s1y + OVERALL_H + SEC_GAP
      rr(ctx, PAD, s2y, W - PAD * 2, TOP_H, 8)
      ctx.fillStyle = C.sectionBg; ctx.fill()
      ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke()

      ctx.fillStyle    = C.tealText
      ctx.font         = `bold 8.5px ${FONT}`
      ctx.textAlign    = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText('TOP SELLERS', PAD + 10, s2y + PAD + SEC_TITLE_H / 2)

      const empAreaX  = PAD + 10
      const empAreaW  = W - PAD * 2 - 20
      const empStartY = s2y + PAD + SEC_TITLE_H

      const RANK_TEXT = ['#B45309', '#71717A', '#C2410C']
      const RANK_BG   = ['#FEF3C7', '#F4F4F5', '#FFF7ED']

      empStats.forEach((emp, idx) => {
        const ey = empStartY + idx * (EMP_H + EMP_GAP)

        rr(ctx, empAreaX, ey, empAreaW, EMP_H, 6)
        ctx.fillStyle   = idx === 0 ? C.gold : C.rowBg; ctx.fill()
        ctx.strokeStyle = idx === 0 ? C.goldBorder : C.border
        ctx.lineWidth   = 1; ctx.stroke()

        // Rank badge
        rr(ctx, empAreaX + 8, ey + (EMP_H - 26) / 2, 26, 26, 4)
        ctx.fillStyle = idx < 3 ? RANK_BG[idx] : '#F4F4F5'; ctx.fill()
        ctx.fillStyle    = idx < 3 ? RANK_TEXT[idx] : C.muted
        ctx.font         = `bold 11px ${FONT}`
        ctx.textAlign    = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(idx + 1), empAreaX + 8 + 13, ey + EMP_H / 2)

        // Name
        ctx.fillStyle    = C.body
        ctx.font         = `bold 12px ${FONT}`
        ctx.textAlign    = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(emp.name, empAreaX + 44, ey + EMP_H / 2 - 9)

        // Sub-stats
        const sub = [`Conv: ${emp.conversion}`, `P-Mix: ${emp.pmix}`, emp.gr > 0 ? `Reviews: ${emp.gr}` : null].filter(Boolean).join('  ·  ')
        ctx.fillStyle    = C.muted
        ctx.font         = `9px ${FONT}`
        ctx.fillText(sub, empAreaX + 44, ey + EMP_H / 2 + 9)

        // MS count (right side)
        ctx.fillStyle    = C.tealText
        ctx.font         = `bold 18px ${FONT}`
        ctx.textAlign    = 'right'; ctx.textBaseline = 'middle'
        ctx.fillText(String(emp.ms), empAreaX + empAreaW - 8, ey + EMP_H / 2 - 7)
        ctx.fillStyle    = C.muted
        ctx.font         = `7.5px ${FONT}`
        ctx.fillText('SOLD', empAreaX + empAreaW - 8, ey + EMP_H / 2 + 9)
      })
    }

    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      } catch {}
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    }, 'image/png')
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!hasData) {
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center bg-tm-navy border border-tm-teal/40 rounded px-2 py-0.5 leading-none">
              <span className="text-tm-teal font-brand font-semibold tracking-widest text-[6px] uppercase">Trademark</span>
              <span className="text-white font-brand font-bold tracking-wider text-[10px] uppercase leading-tight">Car Wash</span>
            </div>
            <div>
              <div className="font-brand font-bold text-sm tracking-wide leading-tight">{locationName}</div>
              <div className="text-tm-teal text-xs font-brand">{displayDate}</div>
            </div>
          </div>
          <button
            onClick={copySnapshotAsImage}
            className="px-3 py-1.5 rounded-md border border-tm-teal/40 text-tm-teal bg-tm-navy hover:bg-tm-blue/60 transition-colors font-brand text-xs font-semibold"
          >
            {copyFeedback ? '✓ Copied!' : '⎘ Copy'}
          </button>
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
