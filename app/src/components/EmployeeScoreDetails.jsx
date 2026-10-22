import { EMPLOYEE_WEIGHTS } from '../utils/employeePerformance.js'

export default function EmployeeScoreDetails({ row }) {
  return <div>
    <strong>{row.score == null ? 'Unavailable' : row.score.toFixed(2)}</strong>
    {row.score == null && <div className="text-[10px]">Unranked</div>}
    <details className="mt-1 text-[10px] text-left">
      <summary className="cursor-pointer">Score details</summary>
      <p>Employee/site row · {row.formula} opportunity formula · {row.opp ?? 'unknown'} reliably attributed opportunities.</p>
      {row.contributions && <>
        <div>Sales: {row.contributions.sales.toFixed(2)} / {EMPLOYEE_WEIGHTS.sales} · {row.ms} / highest eligible sales {row.denominators.sales}</div>
        <div>Conversion: {row.contributions.conversion.toFixed(2)} / {EMPLOYEE_WEIGHTS.conversion} · relative to highest eligible {row.formula} rate {(row.denominators.conversion * 100).toFixed(2)}%</div>
        <div>P-Mix: {row.contributions.pmix.toFixed(2)} / {EMPLOYEE_WEIGHTS.pmix} · against 100%</div>
      </>}
      {row.issues.length > 0 && <ul className="list-disc pl-3">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <p>Google Reviews are informational only. Ranks are separate by opportunity formula; sales benchmarks use all eligible employee/site rows in the selected filters.</p>
    </details>
  </div>
}
