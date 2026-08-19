export const toInt = (v) => Math.max(0, parseInt(v) || 0)
export const pct   = (num, den) => den > 0 ? (num / den * 100).toFixed(1) + '%' : ''
export const pctN  = (num, den) => den > 0 ? parseFloat((num / den * 100).toFixed(1)) : null
export const parsePct = (v) => parseFloat(v) || 0

export function agg(rows) {
  const tw  = rows.reduce((s, r) => s + toInt(r.total_washes),    0)
  const mw  = rows.reduce((s, r) => s + toInt(r.member_washes),   0)
  const ms  = rows.reduce((s, r) => s + toInt(r.memberships_sold),0)
  const opp = rows.reduce((s, r) => s + toInt(r.opportunities),   0)
  const btr = rows.reduce((s, r) => s + toInt(r.better),          0)
  const bst = rows.reduce((s, r) => s + toInt(r.best),            0)
  const gr  = rows.reduce((s, r) => s + toInt(r.google_reviews),  0)
  return {
    tw, mw, ms, opp, gr, btr, bst,
    p_mix:      pct(btr + bst, ms),
    conversion: pct(ms, opp),
    pmixN:      pctN(btr + bst, ms),
    convN:      pctN(ms, opp),
  }
}

// One row per (location, date) — latest time_slot with any data.
export function toDayTotals(rows) {
  const map = {}
  rows.forEach(r => {
    const key = `${r.location_id}::${r.log_date}`
    if (!map[key]) map[key] = []
    map[key].push(r)
  })
  return Object.values(map).map(dayRows => {
    const withData = dayRows.filter(r =>
      toInt(r.total_washes) > 0 || toInt(r.member_washes) > 0 ||
      toInt(r.memberships_sold) > 0 || toInt(r.opportunities) > 0 ||
      toInt(r.google_reviews) > 0
    )
    const src = withData.length ? withData : dayRows
    return src.sort((a, b) => b.time_slot.localeCompare(a.time_slot))[0]
  })
}

export const thCls = 'px-3 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold tracking-wide cursor-pointer select-none hover:bg-tm-navy/80 dark:hover:bg-tm-dark-border/60 transition-colors whitespace-nowrap'
