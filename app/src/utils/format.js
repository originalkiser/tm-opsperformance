// Display formatting for counts: thousands separators ("1,234").
// Returns '' for zero/empty/invalid so call sites keep their blank-cell behavior.
export const fmtNum = (v) => {
  const n = Number(v)
  return !n || isNaN(n) ? '' : n.toLocaleString('en-US')
}
