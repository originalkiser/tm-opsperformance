const currency = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function BudgetRevenueSummary({ revenue, historical }) {
  return <div className="text-xs space-y-1" aria-live="polite">
    <div className="font-semibold">MTD Revenue (Automatic)</div>
    <div>{revenue.complete ? currency(revenue.total) : 'Incomplete — total unavailable'}</div>
    {!revenue.complete && <div className="text-amber-700 dark:text-amber-400">
      Recorded subtotal: {currency(revenue.recordedTotal)}. Missing or invalid business dates: {revenue.missingDates.join(', ')}.
      Enter or correct the following morning’s entry for each date.
    </div>}
    {historical != null && historical !== '' && <div className="text-gray-500">
      Previously entered MTD: {currency(Number(historical))} (preserved; not included in the automatic total).
    </div>}
  </div>
}
