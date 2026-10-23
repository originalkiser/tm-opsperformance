import { SCORE_LABELS, SCORE_WEIGHTS } from '../utils/budgetScoring'

export const formatBudgetScore = result => result && Number.isFinite(result.score) ? result.score.toFixed(1) : '—'

export default function BudgetScoreDetails({ result }) {
  if (!result) return <span>—</span>
  return <div className="text-gray-800 dark:text-gray-100">
    <div className="font-bold text-tm-blue dark:text-tm-teal">{formatBudgetScore(result)}</div>
    {result.issues.length > 0 && <div className="text-[10px] font-normal text-amber-800 dark:text-amber-300">Incomplete reporting · unavailable categories receive 0 points</div>}
    <div className="text-[10px] font-normal">Last entry: {result.lastEntryDate || 'None this month'}</div>
    <details className="mt-1 text-[10px] font-normal text-left">
      <summary className="cursor-pointer">Score details · {result.completeness.scoredCategories}/7 categories supported</summary>
      <p>Official score: {formatBudgetScore(result)} / 100 · Rank: {result.rank ?? '—'}. No reweighting for missing categories.</p>
      <p>Business cutoff: {result.businessDate}. Reporting entry: {result.reportingDate}.</p>
      <p>Reporting completeness: entry {result.completeness.entryPresent ? result.completeness.dailyEntryComplete ? 'complete' : 'incomplete' : 'missing'}, MTD counts {result.completeness.mtdCountsValid ? 'valid' : 'missing/invalid'}, revenue {result.completeness.revenueComplete ? 'complete' : 'incomplete'}.</p>
      <p>Expected MTD revenue: {result.expectedRevenue == null ? '—' : result.expectedRevenue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Expected net growth: {result.expectedGrowth ?? '—'}. Both use the selected reporting cutoff.</p>
      {result.scoringRevenue != null && <p>Revenue used for scoring: {result.scoringRevenue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} through {result.reportedThrough}.{result.provisionalRevenue && ' Provisional source; not complete verified MTD actual revenue.'}</p>}
      {Object.entries(SCORE_WEIGHTS).map(([key, max]) => <div key={key}>
        {SCORE_LABELS[key]}: {(result.components[key] ?? 0).toFixed(2)} / {max}
        {result.componentSources?.[key]?.throughDate && <span> · supported through {result.componentSources[key].throughDate}</span>}
        {result.componentIssues?.[key] && <span> · {result.componentIssues[key]}</span>}
      </div>)}
      {result.issues.length > 0 && <ul className="list-disc pl-4 mt-1">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      {result.completeness.missingRevenueDates.length > 0 && <p>Missing/invalid revenue dates: {result.completeness.missingRevenueDates.join(', ')}.</p>}
      {result.completeness.missingReportingDates?.length > 0 && <p>Missing reporting dates: {result.completeness.missingReportingDates.join(', ')}.</p>}
      {result.completeness.incompleteReportingDates?.length > 0 && <p>Incomplete/ambiguous reporting dates: {result.completeness.incompleteReportingDates.join(', ')}.</p>}
      {result.completeness.missingEntryFields?.length > 0 && <p>Missing entry fields: {result.completeness.missingEntryFields.join(', ')}.</p>}
    </details>
  </div>
}
