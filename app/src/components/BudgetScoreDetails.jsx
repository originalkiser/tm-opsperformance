import { SCORE_LABELS, SCORE_WEIGHTS } from '../utils/budgetScoring'

export const formatBudgetScore = result => !result ? '—' : result.score != null ? result.score.toFixed(1) : result.previewPoints != null ? `Provisional preview: ${result.previewPoints.toFixed(1)} / ${result.availableWeight} available points` : 'Unavailable'

export default function BudgetScoreDetails({ result }) {
  if (!result) return <span>—</span>
  return <div className="text-gray-800 dark:text-gray-100">
    <div className={result.score == null ? 'text-amber-800 dark:text-amber-300' : 'font-bold text-tm-blue dark:text-tm-teal'}>
      {formatBudgetScore(result)}
    </div>
    {result.score == null && <div className="text-[10px] font-normal">Unranked · no official score or rank · not scaled to 100</div>}
    <details className="mt-1 text-[10px] font-normal text-left">
      <summary className="cursor-pointer">Score details · {result.completeness.scoredCategories}/7 categories</summary>
      <p className="mt-1">Business cutoff: {result.businessDate}. Reporting entry: {result.reportingDate}.</p>
      <p>Reporting completeness: entry {result.completeness.entryPresent ? result.completeness.dailyEntryComplete ? 'complete' : 'incomplete' : 'missing'}, MTD counts {result.completeness.mtdCountsValid ? 'valid' : 'missing/invalid'}, revenue {result.completeness.revenueComplete ? 'complete' : 'incomplete'}.</p>
      {Object.entries(SCORE_WEIGHTS).map(([key, max]) => <div key={key}>{SCORE_LABELS[key]}: {result.components[key] == null ? 'unavailable' : result.components[key].toFixed(2)} / {max}</div>)}
      {result.issues.length > 0 && <ul className="list-disc pl-4 mt-1">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      {result.completeness.missingRevenueDates.length > 0 && <p>Missing/invalid revenue dates: {result.completeness.missingRevenueDates.join(', ')}.</p>}
      {result.completeness.missingEntryFields?.length > 0 && <p>Missing entry fields: {result.completeness.missingEntryFields.join(', ')}.</p>}
    </details>
  </div>
}
