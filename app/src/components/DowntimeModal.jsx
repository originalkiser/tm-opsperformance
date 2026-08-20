import { useState } from 'react'

const DOWNTIME_TYPES = ['Planned', 'Unplanned', 'Weather', 'Utility', 'IT', 'Other']

function fmtTimeStr(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function localIso(dateStr) {
  const today = new Date()
  const [h, m] = dateStr.split(':').map(Number)
  return new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0).toISOString()
}

function Field({ label, hint, children, required }) {
  return (
    <div>
      <label className="block text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 dark:text-tm-dark-muted font-brand mt-1 italic">{hint}</p>}
    </div>
  )
}

function inputCls(accent = 'teal') {
  const ring = accent === 'red' ? 'focus:ring-red-400' : 'focus:ring-tm-teal'
  return `border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 ${ring} w-full font-brand`
}

export default function DowntimeModal({ mode, reasons = [], activeDowntime, onStart, onEnd, onCancel, onClose }) {
  // Start fields
  const [startTime,     setStartTime]     = useState(fmtTimeStr(new Date()))
  const [downtimeType,  setDowntimeType]  = useState('')
  const [reason,        setReason]        = useState('')
  const [details,       setDetails]       = useState('')

  // End fields
  const [endTime,                  setEndTime]                  = useState(fmtTimeStr(new Date()))
  const [resolutionReason,         setResolutionReason]         = useState('')
  const [resolutionNotes,          setResolutionNotes]          = useState('')
  const [correctiveActionNeeded,   setCorrectiveActionNeeded]   = useState(null) // null | true | false
  const [correctiveAction,         setCorrectiveAction]         = useState('')

  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  const downReasons = reasons.filter(r => r.type === 'reason'     && r.is_active)
  const resReasons  = reasons.filter(r => r.type === 'resolution' && r.is_active)

  const handleStart = async () => {
    if (!downtimeType) { setError('Please select a type of downtime.'); return }
    if (!reason)       { setError('Please select a reason.'); return }
    setSaving(true); setError('')
    await onStart({
      started_at:    localIso(startTime),
      downtime_type: downtimeType,
      reason,
      details:       details || null,
    })
    setSaving(false)
  }

  const handleEnd = async () => {
    setSaving(true); setError('')
    await onEnd({
      ended_at:                  localIso(endTime),
      resolution_reason:         resolutionReason         || null,
      resolution_notes:          resolutionNotes          || null,
      corrective_action_needed:  correctiveActionNeeded   ?? null,
      corrective_action:         correctiveActionNeeded ? (correctiveAction || null) : null,
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-w-md w-full mx-4 bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className={`px-5 py-4 shrink-0 ${mode === 'start' ? 'bg-red-600' : 'bg-tm-navy dark:bg-tm-dark-nav'} text-white`}>
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

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {mode === 'start' ? (
            <>
              {/* 1. Start Time */}
              <Field label="Downtime Start Time" required>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={inputCls('red')} />
              </Field>

              {/* 2. Type of Downtime */}
              <Field label="Type of Downtime" required>
                <div className="grid grid-cols-3 gap-2">
                  {DOWNTIME_TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setDowntimeType(t); setError('') }}
                      className={`px-3 py-2 rounded-lg border text-xs font-brand font-semibold transition-colors ${
                        downtimeType === t
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted hover:border-red-400 hover:text-red-600'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>

              {/* 3. Reason */}
              <Field label="Reason for Downtime" required>
                <select value={reason} onChange={e => { setReason(e.target.value); setError('') }} className={inputCls('red')}>
                  <option value="">Select a reason…</option>
                  {downReasons.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
                  {!downReasons.length && <option disabled>No reasons configured — add in Admin › Downtime</option>}
                </select>
              </Field>

              {/* 4. Details */}
              <Field label="Details" hint="The problem.">
                <textarea
                  rows={3}
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder="Describe what's happening…"
                  className={inputCls('red') + ' resize-none'}
                />
              </Field>

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
              {/* Active downtime summary */}
              {activeDowntime && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs font-brand space-y-0.5">
                  <div className="font-bold text-[10px] uppercase tracking-wide text-red-500 dark:text-red-400 mb-1">Active Downtime</div>
                  <div className="flex gap-4 flex-wrap text-gray-600 dark:text-tm-dark-text">
                    <span>Started: {activeStart}</span>
                    {activeDowntime.downtime_type && <span>Type: {activeDowntime.downtime_type}</span>}
                  </div>
                  {activeDowntime.reason  && <div className="text-gray-500 dark:text-tm-dark-muted">Reason: {activeDowntime.reason}</div>}
                  {activeDowntime.details && <div className="text-gray-500 dark:text-tm-dark-muted">Details: {activeDowntime.details}</div>}
                </div>
              )}

              {/* 5. End Time */}
              <Field label="Downtime End Time" required>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputCls()} />
              </Field>

              {/* 6. Resolution */}
              <Field label="Resolution">
                {resReasons.length > 0 && (
                  <select value={resolutionReason} onChange={e => setResolutionReason(e.target.value)} className={inputCls() + ' mb-2'}>
                    <option value="">Select how it was resolved…</option>
                    {resReasons.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
                  </select>
                )}
                <textarea
                  rows={3}
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Describe what resolved the issue…"
                  className={inputCls() + ' resize-none'}
                />
                <p className="text-[11px] text-gray-400 dark:text-tm-dark-muted font-brand mt-1 italic">The fix.</p>
              </Field>

              {/* 7. Corrective Action Needed */}
              <Field label="Corrective Action Needed?">
                <div className="flex gap-4">
                  {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map(opt => (
                    <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="corrective_action_needed"
                        checked={correctiveActionNeeded === opt.value}
                        onChange={() => setCorrectiveActionNeeded(opt.value)}
                        className="accent-tm-teal w-4 h-4"
                      />
                      <span className="text-sm font-brand text-gray-700 dark:text-tm-dark-text">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </Field>

              {/* 8. Corrective Action (conditional) */}
              {correctiveActionNeeded === true && (
                <Field label="Corrective Action" hint="How to prevent this from being a recurring issue.">
                  <textarea
                    rows={3}
                    value={correctiveAction}
                    onChange={e => setCorrectiveAction(e.target.value)}
                    placeholder="Describe the corrective action…"
                    className={inputCls() + ' resize-none'}
                    autoFocus
                  />
                </Field>
              )}

              {/* Save Downtime */}
              <button
                onClick={handleEnd}
                disabled={saving}
                style={{ boxShadow: saving ? 'none' : '0 0 22px 6px rgba(20,184,166,0.45)' }}
                className="w-full py-3 rounded-xl bg-tm-teal hover:brightness-110 text-tm-navy font-brand font-bold text-sm tracking-wide transition-all disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Downtime'}
              </button>

              {/* Danger Zone */}
              <div className="border border-red-200 dark:border-red-900 rounded-xl p-4 bg-red-50/60 dark:bg-red-900/10">
                <div className="text-[10px] font-brand font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Danger Zone</div>
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
