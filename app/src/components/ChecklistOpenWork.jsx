import { useEffect, useRef, useState } from 'react'
import { supabase, supabasePublicKey } from '../lib/supabase'
import { createChecklistTransport } from '../utils/checklistAccess'

export default function ChecklistOpenWork({ locationId, onOpen, disabled = false }) {
  const [rows, setRows] = useState([]), [nextOffset, setNextOffset] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const transport = useRef(null), generation = useRef(0), working = useRef(false)
  if (!transport.current) transport.current = createChecklistTransport(supabase, supabasePublicKey)
  useEffect(() => { load(); return () => { generation.current++ } }, [locationId])
  async function load(more = false) {
    if (working.current || !locationId) return
    working.current = true; setBusy(true); setError('')
    const current = ++generation.current
    try {
      const result = await transport.current.request('context', { location_id: locationId, offset: more ? nextOffset : 0 })
      if (current !== generation.current) return
      const unfinished = result.submissions.filter(row => row.status === 'draft' || row.working_copy_id)
      setRows(previous => more ? [...new Map([...previous, ...unfinished].map(row => [row.id, row])).values()] : unfinished)
      setNextOffset(result.has_more ? result.next_offset : null)
    } catch (error) { if (current === generation.current) setError(error.message) }
    finally { if (current === generation.current) { working.current = false; setBusy(false) } }
  }
  return <section className="space-y-2" aria-label="Unfinished checklists">
    <h2 className="font-bold text-lg">Unfinished checklists</h2>
    <p>Saved drafts keep their original date or week and remain available on later days. Daily corrections close at the end of the assigned site-local day; weekly corrections close at midnight Monday after the assigned week. Unsubmitted corrections do not extend these deadlines.</p>
    {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
    <ul>{rows.map(record => <li key={record.id} className="border-b py-3 flex flex-wrap justify-between items-center gap-2"><span>{record.template_snapshot.name} · {record.period_date}{record.working_copy_id ? ' · Correction' : ''}</span><button disabled={busy || disabled} className="min-h-12 px-4 underline" onClick={() => onOpen(record)}>Continue saved work</button></li>)}</ul>
    {!busy && !rows.length && !error && <p>No unfinished checklists.</p>}
    <div className="flex gap-3"><button disabled={busy || disabled} className="min-h-11 px-3 border rounded" onClick={() => load()}>Refresh unfinished work</button>{nextOffset !== null && <button disabled={busy || disabled} className="min-h-11 px-3 border rounded" onClick={() => load(true)}>Load more saved checklists</button>}</div>
  </section>
}
