import { revenuePresentation } from '../utils/budgetRevenue'
import { displayMoney } from '../utils/budgetDisplay'

export default function BudgetRevenueNotes({ revenue, historical, monthlyGoal, reportingDate }) {
  const reported = revenuePresentation(revenue, historical)
  return <details className="text-xs text-gray-800 dark:text-gray-100">
    <summary className={`cursor-pointer focus-visible:outline focus-visible:outline-2 ${reported.provisional ? 'text-amber-800 dark:text-amber-300' : ''}`}>Notes</summary>
    <div className="mt-1 min-w-[14rem] max-w-xs space-y-1">
      <p>{reported.provisional ? `Provisional ${reported.source}` : 'Automatic MTD'}{reported.throughDate ? ` through ${reported.throughDate}` : ''}. {reportingDate ? `Pace and MTD goals use selected reporting date ${reportingDate}, not this source date.` : 'Percentages use this reporting date.'}</p>
      {!revenue.complete && <><p>Incomplete · {revenue.missingDates.length} missing or invalid revenue days: {revenue.missingDates.join(', ')}.</p><p>Recorded subtotal {displayMoney(revenue.recordedTotal)} is incomplete and does not drive pace.</p></>}
      {revenue.startingBalance && <p>Verified starting balance: {displayMoney(revenue.startingBalance.amount)} through {revenue.startingBalance.cutoff_business_date}. Earlier daily entries are excluded.</p>}
      {historical && <p>Historical reported MTD: {displayMoney(historical.amount)} · reported {historical.entryDate}; never added to daily totals.</p>}
      {!(Number(monthlyGoal)>0) && <p>No valid monthly revenue goal is set.</p>}
      <p>Revenue % = actual / full-month goal. MTD Goal % = expected share of that goal through the reporting date.</p>
    </div>
  </details>
}
