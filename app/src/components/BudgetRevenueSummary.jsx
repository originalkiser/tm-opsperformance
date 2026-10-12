const currency = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function BudgetRevenueSummary({ revenue, historical }) {
  return <div className="text-xs space-y-1 text-gray-800 dark:text-gray-100" aria-live="polite">
    <div className="font-semibold">MTD Revenue ({revenue.startingBalance ? 'October transition' : 'Automatic'})</div>
    {revenue.startingBalance && <div>Verified starting balance: {currency(Number(revenue.startingBalance.amount))}, including business revenue through {revenue.startingBalance.cutoff_business_date}. Only later daily revenue is added.</div>}
    <div>{revenue.complete ? currency(revenue.total) : 'Incomplete — total unavailable'}</div>
    {!revenue.complete && <div className="text-amber-700 dark:text-amber-400">
      {revenue.startingBalance ? 'Starting balance plus recorded daily subtotal' : 'Recorded subtotal'}: {currency(revenue.recordedTotal)}. Missing or invalid business dates: {revenue.missingDates.join(', ')}.
      Continue normal daily entry. {revenue.startingBalance
        ? 'Totals and revenue pace require every elapsed business day after the cutoff; earlier dates do not need backfilling.'
        : 'Backfilling earlier dates is not required. Automatic totals and revenue pace become available when every elapsed business day in the month has daily figures.'}
    </div>}
    {!revenue.complete && historical && <div className="text-gray-700 dark:text-gray-200">
      <div className="font-semibold">Historical MTD reference: {currency(historical.amount)}</div>
      Recorded on {historical.entryDate}. Preserved reference only; not included in automatic totals or revenue pace.
    </div>}
  </div>
}
