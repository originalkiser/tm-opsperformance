// Shared field metadata + validation for the Budget Tracking daily entry
// form, used both on the Site Entry page (BudgetTrackingSection.jsx) and the
// Reports-page admin override (BudgetTrackingReport.jsx), so the two stay in
// sync and a fix here fixes both places.
//
// Every field is required (any value, including 0, counts as entered) —
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

export const EXTRA_FIELDS = [
  { key: 'mtd_revenue_actual',    label: 'MTD Revenue Actual ($)' },
  { key: 'mtd_membership_actual', label: 'MTD Membership Actual' },
  { key: 'current_rating',        label: 'Current Rating' },
  { key: 'current_reviews',       label: 'Current Reviews' },
]

export const ALL_DAILY_FIELDS = [...YESTERDAY_FIELDS, ...MTD_FIELDS, ...EXTRA_FIELDS]

export function emptyDailyForm() {
  return Object.fromEntries(ALL_DAILY_FIELDS.map(f => [f.key, '']))
}

export const isFieldMissing = (form, key) => form[key] === '' || form[key] == null

export const countMissing = (form) => ALL_DAILY_FIELDS.filter(f => isFieldMissing(form, f.key)).length

// True once every field has an explicit value in the *saved* row (not the
// in-progress form) — drives the "today's numbers are done" highlight.
export const isDayComplete = (entry) =>
  !!entry && ALL_DAILY_FIELDS.every(f => entry[f.key] != null)
