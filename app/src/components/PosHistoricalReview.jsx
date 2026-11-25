import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { historicalChanges, historicalRpc, POS_PARSER_VERSION, prepareHistoricalManifest } from '../utils/posImportStorage'

const button = 'rounded border px-3 py-2 disabled:opacity-50'
const display = value => value == null ? 'Unavailable' : String(value)

export default function PosHistoricalReview({ jobs, busy, run }) {
  const [reason, setReason] = useState('')
  const [rollbackReason, setRollbackReason] = useState('')
  const [manifest, setManifest] = useState(null)
  const [manifestId, setManifestId] = useState('')
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const workbooks = jobs.map(job => job.result).filter(Boolean)
  const ready = workbooks.length && workbooks.length === jobs.length &&
    workbooks.every(w => !w.issues.length && !w.storageError && w.candidates.length &&
      w.candidates.every(row => historicalChanges(row).invariant))
  async function statusFor(id) {
    const result = await historicalRpc(supabase, 'status', { p_id: id })
    setStatus(result)
    return result
  }
  function action(task) {
    return run(async () => {
      setError('')
      try { await task() } catch (failure) { setError(failure.message) }
    })
  }

  return <details className="space-y-3 rounded-xl border p-4 text-sm dark:border-tm-dark-border">
    <summary className="cursor-pointer font-semibold">Historical reprocessing</summary>
    <p>Preview original workbooks using Review import, then lock and approve the reviewed manifest here. Workbook files stay in this browser.</p>
    {!manifest && <div className="space-y-2">
      <p>Parser {POS_PARSER_VERSION}</p>
      {workbooks.map(workbook => <details key={workbook.sha + workbook.name}>
        <summary>{workbook.name} · {workbook.day}</summary>
        <p className="break-all">SHA-256 {workbook.sha}</p>
        <ul className="space-y-2 pl-4">{workbook.candidates.map(row => {
          const { changes, invariant, unresolved } = historicalChanges(row)
          return <li key={row.locationId}>
            <details><summary>{row.name} · Expected revision {row.expectedRevision} · {invariant ? 'Invariants pass' : 'Blocked'} · {row.change}</summary>
              <ul className="pl-4">{changes.map(change => <li key={change.key}>
                {change.key} · {display(change.previous)} → {display(change.proposed)}
                {change.previous == null && change.proposed != null && ' · Newly available'}
              </li>)}</ul>
              {!!unresolved.length && <p>Unresolved · {unresolved.join(' · ')}</p>}
            </details>
          </li>
        })}</ul>
      </details>)}
      <label className="block">Correction reason <input className="rounded border bg-transparent p-1" maxLength={500}
        value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <button type="button" className={button} disabled={busy || !ready || !reason.trim()} onClick={() => action(async () => {
        const locked = await prepareHistoricalManifest(supabase, workbooks, reason)
        setManifest(locked)
        setManifestId(locked.id)
        await statusFor(locked.id)
      })}>Lock reviewed manifest</button>
    </div>}
    {manifest && <div className="space-y-2">
      <p className="break-all">Manifest digest {manifest.digest}</p>
      <p>Correction reason · {reason}</p>
      <button type="button" className={button} disabled={busy || (status?.id === manifest.id && status.approved)} onClick={() => {
        if (!window.confirm('Approve the locked manifest for all listed workbooks? This authorizes new POS revisions.')) return
        action(async () => {
          await historicalRpc(supabase, 'approve', { p_id: manifest.id, p_digest: manifest.digest })
          await statusFor(manifest.id)
        })
      }}>Approve complete manifest</button>
      <button type="button" className={button} disabled={busy} onClick={() => setManifest(null)}>Review another batch</button>
    </div>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault()
      action(() => statusFor(manifestId.trim()))
    }}>
      <label>Resume manifest ID <input className="rounded border bg-transparent p-1" value={manifestId} required
        disabled={busy} onChange={event => setManifestId(event.target.value)} /></label>
      <button className={button} disabled={busy}>Load status</button>
    </form>
    {status && <div className="space-y-2" aria-live="polite">
      <p className="break-all">{status.id} · {status.approved ? 'Approved' : 'Pending approval'}</p>
      <button type="button" className={button} disabled={busy || !status.approved ||
        !status.workbooks.some(w => !w.outcome || w.outcome.status === 'failed')} onClick={() => action(async () => {
        for (const w of status.workbooks.filter(item => !item.outcome || item.outcome.status === 'failed')) {
          await historicalRpc(supabase, 'workbook', { p_id: status.id, p_sha: w.sha })
          await statusFor(status.id)
        }
      })}>Process pending and failed workbooks</button>
      {status.workbooks.some(w => w.outcome?.status === 'completed') &&
        <label className="block">Rollback reason <input className="rounded border bg-transparent p-1" maxLength={470}
          disabled={busy} value={rollbackReason} onChange={event => setRollbackReason(event.target.value)} /></label>}
      <ul className="space-y-2">{status.workbooks.map(w => <li key={w.sha} className="break-words">
        {w.name} · {w.day} · {w.outcome?.status ?? 'pending'} {w.outcome?.error}
        {w.outcome?.status === 'completed' && <button type="button" className={button} disabled={busy || !rollbackReason.trim()}
          onClick={() => {
            if (!window.confirm('Append audited rollback revisions for this workbook?')) return
            action(async () => {
              await historicalRpc(supabase, 'rollback', { p_id: status.id, p_sha: w.sha, p_reason: rollbackReason.trim() })
              await statusFor(status.id)
            })
          }}>Roll back workbook</button>}
      </li>)}</ul>
    </div>}
    {error && <p role="alert">{error}</p>}
  </details>
}
