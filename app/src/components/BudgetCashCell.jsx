import { displayMoney } from '../utils/budgetDisplay'
import { varianceLabel } from '../utils/budgetReportFormatting'
import { REPORT_STATUS_CLS } from '../utils/metricColors'

export default function BudgetCashCell({ cash }) {
  return <div className={`whitespace-nowrap font-semibold ${REPORT_STATUS_CLS[cash.status]}`}>
    <span>{displayMoney(cash.amount)}{varianceLabel(cash.variance) && ` ${varianceLabel(cash.variance)}`}</span>
    <span className="block text-[10px] font-normal">{cash.note}</span>
  </div>
}
