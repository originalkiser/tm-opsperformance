import { useId } from 'react'
import { REVENUE_FIELDS } from '../utils/budgetDailyFields'
import { creditCardInputError, calculateCreditCardOnEnter } from '../utils/creditCardCalculator'

// Shared by Manager Site Entry and Admin daily-entry editing.
export default function BudgetRevenueFields({ form, set, fieldCls }) {
  const prefix = useId()
  const calculatorError = creditCardInputError(form.yesterday_cc_revenue)
  return <>{REVENUE_FIELDS.map(({ key, label }) => {
    const calculator = key === 'yesterday_cc_revenue'
    const id = `${prefix}-${key}`
    return <div key={key} className="min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold leading-snug break-words text-gray-700 dark:text-gray-200 mb-1">{label}</label>
      <input id={id} type={calculator ? 'text' : 'number'} min={calculator ? undefined : '0'} step={calculator ? undefined : '0.01'}
        value={form[key]} onChange={event => set(key, event.target.value)}
        onKeyDown={calculator ? event => calculateCreditCardOnEnter(event, form[key], result => set(key, result)) : undefined}
        aria-invalid={calculator && !!calculatorError}
        aria-describedby={calculator ? `${id}-hint${calculatorError ? ` ${id}-error` : ''}` : undefined}
        className={fieldCls(key)} />
      {calculator && <p id={`${id}-hint`} className="mt-1 text-xs text-gray-700 dark:text-gray-200">Add amounts with +, then press Enter to calculate.</p>}
      {calculator && calculatorError && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{calculatorError}</p>}
    </div>
  })}</>
}
