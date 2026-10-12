import { revenueCents } from './budgetRevenue.js'

export const CREDIT_CARD_CALCULATOR_ERROR = 'Use positive amounts or zero with up to two decimal places, separated only by + (for example, 45.25 + 120 + 1000).'

export function calculateCreditCardInput(value) {
  const terms = String(value).split('+')
  let cents = 0
  for (const term of terms) {
    const amount = revenueCents(term.trim())
    if (amount == null) throw new Error(CREDIT_CARD_CALCULATOR_ERROR)
    cents += amount
    if (cents > 999999999999) throw new Error('Credit card total must not exceed $9,999,999,999.99.')
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

export function creditCardInputError(value) {
  if (value === '' || value == null) return null
  try {
    calculateCreditCardInput(value)
    // Existing save validation accepts only a resolved, canonical number.
    return revenueCents(value) == null ? 'Press Enter to calculate this credit card amount before saving.' : null
  } catch (error) { return error.message }
}

export function calculateCreditCardOnEnter(event, value, onResult) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  try { onResult(calculateCreditCardInput(value)) } catch { /* Inline validation displays the error; keep the user's input. */ }
}
