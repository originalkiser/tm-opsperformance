import { revenuePresentation } from '../utils/budgetRevenue'
const currency = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function BudgetRevenueSummary({ revenue, historical }) {
  const reported = revenuePresentation(revenue, historical)
  return <div className="text-xs space-y-1 text-gray-800 dark:text-gray-100" aria-live="polite">
    <div className="font-semibold">MTD Revenue ({reported.provisional ? `Provisional ${reported.source}` : revenue.startingBalance ? 'October transition' : 'Automatic'})</div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold">{reported.amount != null ? currency(reported.amount) : '—'}</span>
      {!revenue.complete && <span className="text-amber-800 dark:text-amber-300">Incomplete · {revenue.missingDates.length} missing revenue {revenue.missingDates.length === 1 ? 'day' : 'days'}</span>}
    </div>
    {reported.provisional && <div className="text-amber-800 dark:text-amber-300">Provisional · {reported.source} through {reported.throughDate}. Revenue % and pace use this reporting date; daily totals remain incomplete.</div>}
    {!revenue.complete && <details>
      <summary className="cursor-pointer text-gray-700 dark:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">View details</summary>
      <div className="mt-1 text-gray-700 dark:text-gray-200">
      {revenue.startingBalance ? 'Starting balance plus recorded daily subtotal' : 'Recorded subtotal'}: {currency(revenue.recordedTotal)}. Missing or invalid business dates: {revenue.missingDates.join(', ')}.
      Continue normal daily entry. {revenue.startingBalance
        ? 'Complete automatic totals require every elapsed business day after the cutoff; earlier dates do not need backfilling.'
        : 'Backfilling earlier dates is not required. Complete automatic totals become available when every elapsed business day in the month has daily figures.'}
      </div>
      {revenue.startingBalance && <div className="mt-1">Verified starting balance: {currency(Number(revenue.startingBalance.amount))}, including business revenue through {revenue.startingBalance.cutoff_business_date}. Only later daily revenue is added.</div>}
    </details>}
    {revenue.complete && revenue.startingBalance && <div>Starting balance: {currency(Number(revenue.startingBalance.amount))} through {revenue.startingBalance.cutoff_business_date}</div>}
    {!revenue.complete && historical && <div className="text-gray-700 dark:text-gray-200">
      Reported MTD: {currency(historical.amount)} · reported {historical.entryDate} · provisional; never added to daily subtotals.
    </div>}
  </div>
}
