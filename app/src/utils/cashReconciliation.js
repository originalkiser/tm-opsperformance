import { REVENUE_KEYS, revenueCents, shiftDate } from './budgetRevenue.js'

export const CASH_COUNT_LABEL = 'YESTERDAY TOTAL CASH COUNTED (BEFORE DEPOSIT) ($)'
export function cashCountError(value) {
  return value !== '' && value != null && revenueCents(value) == null
    ? 'Enter a non-negative cash count with up to two decimal places.' : ''
}
export function reconcileCash(form, cashOnHandCents) {
  const amounts = REVENUE_KEYS.map(key => revenueCents(form[key]))
  const revenue = amounts.every(value => value != null) ? amounts[0] - amounts[1] - amounts[2] : null
  const count = revenueCents(form.yesterday_cash_counted)
  const hand = Number.isSafeInteger(cashOnHandCents) && cashOnHandCents >= 0 ? cashOnHandCents : null
  const validRevenue = revenue != null && revenue >= 0 ? revenue : null
  const expected = hand != null && validRevenue != null ? hand + validRevenue : null
  const deposit = hand != null && count != null ? count - hand : null
  const variance = deposit != null && validRevenue != null ? deposit - validRevenue : null
  return { revenue: validRevenue, hand, expected, count, deposit, variance,
    status: variance == null ? 'neutral' : variance === 0 ? 'green' : 'red' }
}
export const cashBusinessDate = entryDate => shiftDate(entryDate, -1)
export async function fetchCashSetting(client, locationId, businessDate) {
  const { data, error } = await client.from('cash_on_hand_versions').select('*')
    .eq('location_id', locationId).lte('effective_date', businessDate)
    .order('effective_date', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}
export function applicableCashCents(entry, setting) {
  if (entry?.cash_first_submitted_at != null && entry.cash_on_hand_cents == null) return null
  return entry?.cash_on_hand_version_id != null ? Number(entry.cash_on_hand_cents) : setting ? Number(setting.amount_cents) : null
}
