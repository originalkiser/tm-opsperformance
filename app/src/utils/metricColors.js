// Conditional color classes for P-Mix and Conversion metrics.
// Thresholds come from location.metric_thresholds (Supabase), falling back
// to the defaults below when not configured.

export const DEFAULT_THRESHOLDS = {
  pmix_green:  60, // P-Mix turns green at or above this %
  conv_red:     7, // Conversion is red below this %
  conv_yellow: 10, // Conversion is yellow [red, yellow), green at or above
}

// Parse "42.3%" or 42.3 → number, or NaN if empty/invalid
const parsePct = (v) => parseFloat(v)

export function pmixCls(valStr, thresholds) {
  const n = parsePct(valStr)
  if (isNaN(n) || !valStr) return 'bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
  const green = thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green
  if (n >= green) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
  return 'bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
}

export function convCls(valStr, thresholds) {
  const n = parsePct(valStr)
  if (isNaN(n) || !valStr) return 'bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
  const red    = thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red
  const yellow = thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow
  if (n < red)    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
  if (n < yellow) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
  return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
}

// Totals-row variants (slightly deeper background)
export function pmixTotalsCls(valStr, thresholds) {
  const n = parsePct(valStr)
  if (isNaN(n) || !valStr) return 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
  const green = thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green
  if (n >= green) return 'bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-200'
  return 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
}

// Text-only variants (no bg) — for inline values where only text color is needed
export function pmixTextCls(valStr, thresholds) {
  const n = parsePct(valStr)
  if (isNaN(n) || !valStr) return 'text-orange-700 dark:text-orange-300'
  const green = thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green
  if (n >= green) return 'text-green-700 dark:text-green-300'
  return 'text-orange-700 dark:text-orange-300'
}

export function convTextCls(valStr, thresholds) {
  const n = parsePct(valStr)
  if (isNaN(n) || !valStr) return 'text-orange-700 dark:text-orange-300'
  const red    = thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red
  const yellow = thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow
  if (n < red)    return 'text-red-600 dark:text-red-400'
  if (n < yellow) return 'text-yellow-600 dark:text-yellow-300'
  return 'text-green-700 dark:text-green-300'
}

// Hex colors for canvas/SVG (charts) — no dark mode, use on colored backgrounds
export function pmixHex(value, thresholds) {
  if (value == null) return '#9ca3af'
  const green = thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green
  return value >= green ? '#16a34a' : '#ea580c'
}

export function convHex(value, thresholds) {
  if (value == null) return '#9ca3af'
  const red    = thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red
  const yellow = thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow
  if (value < red)    return '#dc2626'
  if (value < yellow) return '#d97706'
  return '#16a34a'
}

export function convTotalsCls(valStr, thresholds) {
  const n = parsePct(valStr)
  if (isNaN(n) || !valStr) return 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
  const red    = thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red
  const yellow = thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow
  if (n < red)    return 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-300'
  if (n < yellow) return 'bg-yellow-200 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200'
  return 'bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-200'
}
