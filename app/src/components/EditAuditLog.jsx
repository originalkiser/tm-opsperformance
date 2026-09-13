import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import TmLoader from './TmLoader'
import { auditTableLabel } from '../utils/auditLog'

function fmtWhen(iso) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return sameDay ? `Today ${time}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${time}`
}

// isMidMonth: flags an edit made well after the month started (day > 5),
// the signal that something was changed outside the normal set-it-once flow.
function isMidMonthEdit(row) {
  const changed = new Date(row.changed_at)
  const period  = new Date(row.period + 'T00:00:00')
  const sameMonth = changed.getFullYear() === period.getFullYear() && changed.getMonth() === period.getMonth()
  return sameMonth && changed.getDate() > 5
}

export default function EditAuditLog({ locations, refreshKey }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchLog() }, [locations, refreshKey])

  const fetchLog = async () => {
    setLoading(true)
    const locIds = locations.map(l => l.id)
    if (!locIds.length) { setRows([]); setLoading(false); return }
    const { data } = await supabase.from('edit_audit_log').select('*')
      .in('location_id', locIds)
      .order('changed_at', { ascending: false })
      .limit(50)
    setRows(data || [])
    setLoading(false)
  }

  const locName = (id) => locations.find(l => l.id === id)?.name || '—'

  if (loading) return <div className="flex justify-center py-8"><TmLoader size={48} /></div>
  if (!rows.length) return <div className="text-xs text-gray-400 dark:text-tm-dark-muted py-6 text-center">No edits recorded yet.</div>

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
      <table className="w-full text-xs font-brand border-collapse">
        <thead>
          <tr className="bg-tm-blue dark:bg-tm-navy text-white">
            <th className="px-3 py-2 text-left">Site</th>
            <th className="px-3 py-2 text-left">Table</th>
            <th className="px-3 py-2 text-left">What Changed</th>
            <th className="px-3 py-2 text-left">Changed By</th>
            <th className="px-3 py-2 text-left">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={`${i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'} ${isMidMonthEdit(r) ? 'border-l-2 border-amber-400' : ''}`}>
              <td className="px-3 py-2 font-semibold text-tm-blue dark:text-tm-teal whitespace-nowrap">{locName(r.location_id)}</td>
              <td className="px-3 py-2 text-gray-500 dark:text-tm-dark-muted whitespace-nowrap">{auditTableLabel(r.table_name)}</td>
              <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-text max-w-[360px]">
                {r.summary}
                {isMidMonthEdit(r) && (
                  <span className="ml-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">mid-month edit</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-text whitespace-nowrap">{r.changed_by_name || 'Unknown'}</td>
              <td className="px-3 py-2 text-gray-500 dark:text-tm-dark-muted whitespace-nowrap">{fmtWhen(r.changed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
