export default function BudgetSourceNote({ source, daily = false }) {
  if (!source.active) return null
  return <div className="mb-3 text-xs text-gray-700 dark:text-gray-200" role="status">
    {source.loading ? 'Loading Budget Tracking totals…' : source.error || <>
      MTD shop totals prioritize Budget Tracking through {source.cutoff}; covered Daily Logs are excluded.
      {daily && ' Daily charts use explicit previous-business-day entries; gaps are not filled from partial logs. Budget Tracking does not provide daily review counts.'}
      <details><summary className="cursor-pointer">Source details</summary>
        {source.notes.map(n => <div key={n.id}>{n.name}: {n.message}</div>)}
      </details>
    </>}
  </div>
}
