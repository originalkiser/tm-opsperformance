// Fixed display-only catalog. Never use these values as field identities or rules.
export const budgetLabelFields = [
  {
    "id": "yesterday-washes",
    "field": "yesterday_washes",
    "label": "Yesterday Washes",
    "helper": ""
  },
  {
    "id": "yesterday-redemptions",
    "field": "yesterday_redemptions",
    "label": "Yesterday Redemptions",
    "helper": ""
  },
  {
    "id": "yesterday-wash-overrides",
    "field": "yesterday_wash_overrides",
    "label": "Yesterday Wash Overrides",
    "helper": "Blank counts as zero"
  },
  {
    "id": "yesterday-basic",
    "field": "yesterday_basic",
    "label": "Yesterday Basic",
    "helper": "Memberships Sold"
  },
  {
    "id": "yesterday-good",
    "field": "yesterday_good",
    "label": "Yesterday Good",
    "helper": "Memberships Sold"
  },
  {
    "id": "yesterday-better",
    "field": "yesterday_better",
    "label": "Yesterday Better",
    "helper": "Memberships Sold"
  },
  {
    "id": "yesterday-best",
    "field": "yesterday_best",
    "label": "Yesterday Best",
    "helper": "Memberships Sold"
  },
  {
    "id": "mtd-washes",
    "field": "mtd_washes",
    "label": "MTD Washes",
    "helper": ""
  },
  {
    "id": "mtd-redemptions",
    "field": "mtd_redemptions",
    "label": "MTD Redemptions",
    "helper": ""
  },
  {
    "id": "mtd-wash-overrides",
    "field": "mtd_wash_overrides",
    "label": "MTD Wash Overrides",
    "helper": "Blank counts as zero"
  },
  {
    "id": "mtd-basic",
    "field": "mtd_basic",
    "label": "MTD Basic",
    "helper": "Memberships Sold"
  },
  {
    "id": "mtd-good",
    "field": "mtd_good",
    "label": "MTD Good",
    "helper": "Memberships Sold"
  },
  {
    "id": "mtd-better",
    "field": "mtd_better",
    "label": "MTD Better",
    "helper": "Memberships Sold"
  },
  {
    "id": "mtd-best",
    "field": "mtd_best",
    "label": "MTD Best",
    "helper": "Memberships Sold"
  },
  {
    "id": "yesterday-total-revenue",
    "field": "yesterday_total_revenue",
    "label": "YESTERDAY TOTAL TO ACCOUNT FOR / TOTAL PAYMENTS ($)",
    "helper": ""
  },
  {
    "id": "yesterday-cc-revenue",
    "field": "yesterday_cc_revenue",
    "label": "YESTERDAY CREDIT CARD REVENUE ($)",
    "helper": "Add amounts with +, then press Enter to calculate."
  },
  {
    "id": "yesterday-house-revenue",
    "field": "yesterday_house_revenue",
    "label": "YESTERDAY HOUSE ACCOUNT / OTHER TENDERS ($)",
    "helper": ""
  },
  {
    "id": "mtd-revenue-actual",
    "field": "mtd_revenue_actual",
    "label": "REPORTED MTD REVENUE ($)",
    "helper": "Cumulative revenue through the prior business day. Leave blank to retain the saved report."
  },
  {
    "id": "mtd-membership-actual",
    "field": "mtd_membership_actual",
    "label": "Current Total Members",
    "helper": ""
  },
  {
    "id": "current-reviews",
    "field": "current_reviews",
    "label": "MTD REVIEWS",
    "helper": ""
  },
  {
    "id": "current-rating",
    "field": "current_rating",
    "label": "GOOGLE RATING",
    "helper": ""
  }
]
const byField = new Map(budgetLabelFields.map(item => [item.field, item]))
const byId = new Map(budgetLabelFields.map(item => [item.id, item]))
export function budgetFieldWording(field, labels = {}) {
  const item = byField.get(field)
  if (!item) throw Error('This Budget Tracker field is not configurable.')
  return labels[item.id] || { label: item.label, helper: item.helper }
}
export function budgetDisplayFields(fields, labels) {
  return fields.map(field => { const wording = budgetFieldWording(field.key, labels); return { ...field, label: wording.label, hint: wording.helper } })
}
export function parseBudgetLabels(items) {
  if (!Array.isArray(items) || items.length !== budgetLabelFields.length) throw Error('Budget Tracker wording was incomplete.')
  const labels = {}
  for (const item of items) {
    if (!byId.has(item.id) || labels[item.id] || typeof item.label !== 'string' || !item.label.trim() || [...item.label].length > 100 || typeof item.helper !== 'string' || [...item.helper].length > 400) throw Error('Budget Tracker wording was incomplete.')
    labels[item.id] = { label: item.label, helper: item.helper }
  }
  return labels
}
export async function readBudgetLabels(client) {
  const { data, error } = await client.rpc('budget_tracker_labels')
  if (error) throw Error('Custom Budget Tracker wording could not be loaded. Showing original wording.')
  return parseBudgetLabels(data)
}
export async function budgetLabelEditorAction(client, action, item = null, label = null, helper = null) {
  const { data, error } = await client.rpc('budget_tracker_label_editor', { p_action: action, p_key: item?.id ?? null, p_revision: item?.revision ?? null, p_label: label, p_helper: helper })
  if (error) throw Error(error.code === 'PT409' || error.code === '409' ? 'This wording changed elsewhere. Reload before editing again; your unsaved text is still shown.' : error.message || 'Unable to update Budget Tracker wording.')
  parseBudgetLabels(data?.items)
  if (!Array.isArray(data.history) || data.items.some(item => !Number.isInteger(item.revision) || item.revision < 0 || item.default_label !== byId.get(item.id).label || item.default_helper !== byId.get(item.id).helper)) throw Error('Budget Tracker editor response was incomplete.')
  return data
}
