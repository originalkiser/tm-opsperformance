const styles = {
  negative: { className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', background: '#fee2e2', color: '#991b1b' },
  zero: { className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', background: '#fef9c3', color: '#854d0e' },
  positive: { className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', background: '#dcfce7', color: '#166534' },
}
export function netMemberStyle(value) {
  if (value == null || String(value).trim() === '') return null
  const n = Number(String(value).replaceAll(',', ''))
  if (!Number.isFinite(n)) return null
  return styles[n < 0 ? 'negative' : n > 0 ? 'positive' : 'zero']
}
export const netMembersCls = value => netMemberStyle(value)?.className ?? 'text-gray-800 dark:text-tm-dark-text'
