export default function EmployeeScoreDetails({ row }) {
  return <div className="dark:text-tm-dark-text">
    <strong>{row.score == null ? '—' : row.score.toFixed(1)}</strong>
    {row.score != null && <span className="block text-[10px] font-normal">{row.contributions.sales} + {row.contributions.conversion.toFixed(1)} + {row.contributions.pmix.toFixed(1)}</span>}
    {row.issues.length > 0 && <details className="mt-1 text-[10px] text-left">
      <summary className="cursor-pointer">Missing data</summary>
      <ul className="list-disc pl-3">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
    </details>}
  </div>
}
