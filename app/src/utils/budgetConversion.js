// Budget Tracker sources only. Daily Logs and employee sales use their own rules.
export const isDetailedBudget = location => location?.opportunities_formula === 'detailed'
export const WASH_OVERRIDE_KEYS = ['yesterday_wash_overrides', 'mtd_wash_overrides']

export function budgetWashOverrides(value, location) {
  if (!isDetailedBudget(location) || value == null || value === '') return 0
  if (typeof value === 'boolean' || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null
}

export function budgetOpportunities(washes, redemptions, overrides, location) {
  const count = budgetWashOverrides(overrides, location)
  return count == null ? null : Math.max(0, washes - redemptions - count)
}

export function washOverridesError(form, location) {
  return WASH_OVERRIDE_KEYS.some(key => budgetWashOverrides(form[key], location) == null)
    ? 'Wash Overrides must be a nonnegative whole number.' : null
}
