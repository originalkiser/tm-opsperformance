import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import AdminStartingBalancePanel from './AdminStartingBalancePanel'

export default function HistoricalMtdStartingBalances({ locations }) {
  const { profile } = useAuth()
  const [expanded, setExpanded] = useState(false)
  if (profile?.role !== 'admin') return null

  return <section>
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls="historical-mtd-starting-balances"
      onClick={() => setExpanded(open => !open)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-tm-dark-border px-4 py-3 text-left font-brand font-semibold text-tm-blue dark:text-tm-teal"
    >
      Historical MTD Starting Balances
      <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
    </button>
    {expanded && <div id="historical-mtd-starting-balances" className="mt-3">
      {locations.length ? <AdminStartingBalancePanel
        locations={locations}
        onClose={() => setExpanded(false)}
        onSaved={() => {}}
      /> : <p className="text-sm text-gray-500 dark:text-tm-dark-muted">No sites have Budget Tracking enabled.</p>}
    </div>}
  </section>
}
