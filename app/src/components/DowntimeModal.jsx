import { useState } from 'react'

function fmtTimeStr(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function localIso(dateStr) {
  // dateStr: "HH:MM" → ISO using today's calendar date
  const today = new Date()
  const [h, m] = dateStr.split(':').map(Number)
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0)
  return d.toISOString()
}

export default function DowntimeModal({ mode, reasons = [], activeDowntime, onStart, onEnd, onCancel, onClose }) {
  const [startTime, setStartTime]           = useState(fmtTimeStr(new Date()))
  const [reason, setReason]                 = useState('')
  const [endTime, setEndTime]               = useState(fmtTimeStr(new Date()))
  const [resolutionReason, setResolutionReason] = useState('')
  const [resolutionNotes, setResolutionNotes]   = useState('')
  const [cancelConfirm, setCancelConfirm]   = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')

  const downReasons = reasons.filter(r => r.type === 'reason'     && r.is_active)
  const resReasons  = reasons.filter(r => r.type === 'resolution' && r.is_active)

  const handleStart = async () => {
    if (!reason) { setError('Please select a reason.'); return }
    setSaving(true); setError('')
    await onStart({ started_at: localIso(startTime), reason })
    setSaving(false)
  }

  const handleEnd = async () => {
    setSaving(true); setError('')
    await onEnd({
      ended_at: localIso(endTime),
      resolution_reason: resolutionReason || null,
      resolution_notes:  resolutionNotes  || null,
    })
    setSaving(false)
  }

  const handleCancel = async () => {
    setSaving(true)
    await onCancel()
    setSaving(false)
  }

  const activeStart = activeDowntime
    ? new Date(activeDowntime.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Blurred backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-w-md w-full mx-4 bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-4 ${mode === 'start' ? 'bg-red-600' : 'bg-tm-navy dark:bg-tm-dark-nav'} text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 shrink-0">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
              </svg>
              <span className="font-brand font-bold text-sm tracking-wide">
                {mode === 'start' ? 'Log Site Downtime' : 'End Site Downtime'}
              </span>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none transition-colors ml-3">×</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {mode === 'start' ? (
            <>
              <div>
                <label className="block text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-red-400 w-full font-brand"
                />
              </div>
              <div>
                <label className="block text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <select
                  value={reason}
                  onChange={e => { setReason(e.target.value); setError('') }}
                  className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-red-400 w-full font-brand"
                >
                  <option value="">Select a reason…</option>
                  {downReasons.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
                  {!downReasons.length && (
                    <option disabled>No reasons configured — add in Admin &gt; Downtime</option>
                  )}
                </select>
                {!downReasons.length && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-brand">
                    Ask an admin to configure downtime reasons.
                  </p>
                )}
              </div>

              {error && <p className="text-xs text-red-600 dark:text-red-400 font-brand">{error}</p>}

              <button
                onClick={handleStart}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-brand font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
              >
                {saving ? 'Starting…' : 'Start Downtime'}
              </button>
            </>
          ) : (
            <>
              {/* Active downtime info card */}
              {activeDowntime && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <div className="text-[10px] font-brand font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">Active Downtime</div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-brand text-gray-700 dark:text-tm-dark-text">Started: {activeStart}</div>
                      {activeDowntime.reason && (
                        <div className="text-xs text-gray-500 dark:text-tm-dark-muted mt-0.5">Reason: {activeDowntime.reason}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal w-full font-brand"
                />
              </div>
              <div>
                <label className="block text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Resolution Reason
                </label>
                <select
                  value={resolutionReason}
                  onChange={e => setResolutionReason(e.target.value)}
                  className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal w-full font-brand"
                >
                  <option value="">Select how it was resolved…</option>
                  {resReasons.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Optional additional details…"
                  className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal w-full font-brand resize-none"
                />
              </div>

              {/* Glowing End Downtime button */}
              <button
                onClick={handleEnd}
                disabled={saving}
                style={{ boxShadow: saving ? 'none' : '0 0 22px 6px rgba(20,184,166,0.45)' }}
                className="w-full py-3 rounded-xl bg-tm-teal hover:brightness-110 text-tm-navy font-brand font-bold text-sm tracking-wide transition-all disabled:opacity-50"
              >
                {saving ? 'Ending…' : 'End Downtime'}
              </button>

              {/* Danger Zone */}
              <div className="border border-red-200 dark:border-red-900 rounded-xl p-4 bg-red-50/60 dark:bg-red-900/10">
                <div className="text-[10px] font-brand font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">
                  Danger Zone
                </div>
                {cancelConfirm ? (
                  <>
                    <p className="text-xs text-red-600 dark:text-red-400 font-brand mb-3 leading-relaxed">
                      This will cancel the downtime. It will <strong>NOT</strong> be logged as resolved downtime.
                      The cancellation is recorded but the site will return to normal status immediately.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancel}
                        disabled={saving}
                        className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-brand font-bold text-xs transition-colors disabled:opacity-50"
                      >
                        {saving ? '…' : 'Yes, Cancel Downtime'}
                      </button>
                      <button
                        onClick={() => setCancelConfirm(false)}
                        className="px-4 py-2 rounded-lg border border-gray-200 dark:border-tm-dark-border text-gray-500 dark:text-tm-dark-muted font-brand text-xs hover:bg-gray-50 dark:hover:bg-tm-dark-surface transition-colors"
                      >
                        Nevermind
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => setCancelConfirm(true)}
                    className="text-xs font-brand text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline transition-colors"
                  >
                    Cancel downtime without logging it
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
