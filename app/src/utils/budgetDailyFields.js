import { isDetailedBudget, WASH_OVERRIDE_KEYS } from './budgetConversion.js'
import { cashRevenue, revenueError, revenueCents } from './budgetRevenue.js'
import { creditCardInputError } from './creditCardCalculator.js'
import { CASH_COUNT_LABEL, cashCountError } from './cashReconciliation.js'
// Shared field metadata + validation for the Budget Tracking daily entry
// form, used both on the Site Entry page (BudgetTrackingSection.jsx) and the
// Reports-page admin override (BudgetTrackingReport.jsx), so the two stay in
// sync and a fix here fixes both places.
//
// Every field in the required lists is required (including explicit 0) —
// blank is the only invalid state. This exists because the form used to
// show a "0" placeholder in every empty box, so a blank field was visually
// indistinguishable from an intentionally-entered zero, and entries looked
// saved when they weren't.

export const YESTERDAY_FIELDS = [
  { key: 'yesterday_washes',      label: 'Yesterday Washes' },
  { key: 'yesterday_redemptions', label: 'Yesterday Redemptions' },
  { key: 'yesterday_basic',       label: 'Yesterday Basic',  hint: 'Memberships Sold' },
  { key: 'yesterday_good',        label: 'Yesterday Good',   hint: 'Memberships Sold' },
  { key: 'yesterday_better',      label: 'Yesterday Better', hint: 'Memberships Sold' },
  { key: 'yesterday_best',        label: 'Yesterday Best',   hint: 'Memberships Sold' },
]

export const MTD_FIELDS = [
  { key: 'mtd_washes',      label: 'MTD Washes' },
  { key: 'mtd_redemptions', label: 'MTD Redemptions' },
  { key: 'mtd_basic',       label: 'MTD Basic',  hint: 'Memberships Sold' },
  { key: 'mtd_good',        label: 'MTD Good',   hint: 'Memberships Sold' },
  { key: 'mtd_better',      label: 'MTD Better', hint: 'Memberships Sold' },
  { key: 'mtd_best',        label: 'MTD Best',   hint: 'Memberships Sold' },
]

// Optional historical values calculate as zero without rewriting the saved row.
export function budgetCountFields(fields, location) {
  if (!isDetailedBudget(location)) return fields
  return fields.flatMap(field => field.key.endsWith('_redemptions')
    ? [field, { key: field.key.replace('_redemptions', '_wash_overrides'),
      label: field.key.startsWith('yesterday_') ? 'Yesterday Wash Overrides' : 'MTD Wash Overrides',
      hint: 'Blank counts as zero', optional: true }]
    : [field])
}

export const REVENUE_FIELDS = [
  { key: 'yesterday_total_revenue', label: 'YESTERDAY TOTAL TO ACCOUNT FOR / TOTAL PAYMENTS ($)' },
  { key: 'yesterday_cc_revenue', label: 'YESTERDAY CREDIT CARD REVENUE ($)' },
  { key: 'yesterday_house_revenue', label: 'YESTERDAY HOUSE ACCOUNT / OTHER TENDERS ($)' },
]

export const EXTRA_FIELDS = [
  ...REVENUE_FIELDS,
  { key: 'mtd_membership_actual', label: 'MTD Membership Actual' },
  { key: 'current_reviews', label: 'MTD REVIEWS' },
  { key: 'current_rating', label: 'GOOGLE RATING' },
]

export const PERFORMANCE_DAILY_FIELDS = [...YESTERDAY_FIELDS, ...MTD_FIELDS, ...EXTRA_FIELDS]
export const ALL_DAILY_FIELDS = [...PERFORMANCE_DAILY_FIELDS, { key: 'yesterday_cash_counted', label: CASH_COUNT_LABEL }]

export function emptyDailyForm() {
  return { ...Object.fromEntries(ALL_DAILY_FIELDS.map(f => [f.key, ''])), ...Object.fromEntries(WASH_OVERRIDE_KEYS.map(key => [key, ''])), yesterday_cash_counted: '', mtd_revenue_actual: '' }
}

export const isFieldMissing = (form, key) => form[key] === '' || form[key] == null

export const countMissing = (form) => ALL_DAILY_FIELDS.filter(f => isFieldMissing(form, f.key)).length

// True once every field has an explicit value in the *saved* row (not the
// in-progress form) — drives the "today's numbers are done" highlight.
export const isDayComplete = (entry) =>
  !!entry && ALL_DAILY_FIELDS.every(f => !isFieldMissing(entry, f.key)) && !validateRevenue(entry) && !cashCountError(entry.yesterday_cash_counted)

// Cash completion is an entry-workflow requirement, not an eighth scoring
// category. Preserve approved performance scoring and legacy saved records.
export const isPerformanceEntryComplete = (entry) =>
  !!entry && PERFORMANCE_DAILY_FIELDS.every(f => !isFieldMissing(entry, f.key)) && !validateRevenue(entry)

export const calculateCashRevenue = cashRevenue
export const validateRevenue = form => (form.mtd_revenue_actual !== '' && form.mtd_revenue_actual != null && revenueCents(form.mtd_revenue_actual) == null ? 'Enter valid reported MTD revenue with at most two decimal places.' : null) || creditCardInputError(form.yesterday_cc_revenue) || revenueError(form)
