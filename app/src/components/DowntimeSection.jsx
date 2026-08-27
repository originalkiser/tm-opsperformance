import { useState, useMemo, useEffect, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import ExportMenu from './ExportMenu'
import { exportDowntimeXlsx, exportDowntimePdf } from '../utils/exportTable'

// ── Constants ─────────────────────────────────────────────────────────────────

const DOWNTIME_TYPES = ['Planned', 'Unplanned', 'Weather', 'Utility', 'IT', 'Other']
const SCOPE_OPTIONS  = ['Site', 'Lane', 'Vacuum']

const TYPE_COLORS = {
  Planned: '#3B82F6', Unplanned: '#EF4444', Weather: '#8B5CF6',
  Utility: '#F59E0B', IT: '#06B6D4', Other: '#6B7280',
}
const SCOPE_COLORS = { Site: '#EF4444', Lane: '#F59E0B', Vacuum: '#3B82F6' }

const ALL_COLS = [
  { key: 'date',       label: 'Date',               defaultHidden: false },
  { key: 'location',   label: 'Location',            defaultHidden: false },
  { key: 'scope',      label: 'Scope',               defaultHidden: false },
  { key: 'type',       label: 'Type',                defaultHidden: false },
  { key: 'reason',     label: 'Reason',              defaultHidden: false },
  { key: 'details',    label: 'Details',             defaultHidden: false },
  { key: 'started',    label: 'Start Time',          defaultHidden: false },
  { key: 'ended',      label: 'End Time',            defaultHidden: false },
  { key: 'duration',   label: 'Duration',            defaultHidden: false },
  { key: 'status',     label: 'Status',              defaultHidden: false },
  { key: 'resolution', label: 'Resolution',          defaultHidden: false },
  { key: 'ca_needed',  label: 'Corrective Action?',  defaultHidden: false },
  { key: 'ca',         label: 'Corrective Action',   defaultHidden: true  },
  { key: 'multi_day',  label: 'Multi-Day?',          defaultHidden: true  },
  { key: 'site_email', label: 'Site Email',          defaultHidden: true  },
]

const COL_STORAGE_KEY = 'tm_downtime_hidden_cols'

function loadHiddenCols() {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {}
  return new Set(ALL_COLS.filter(c => c.defaultHidden).map(c => c.key))
}

function saveHiddenCols(set) {
  try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...set])) } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtDateTime(iso) { return iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '—' }
function fmtDuration(ms) {
  if (!ms || isNaN(ms)) return '—'
  const m = Math.round(ms / 60000), h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}
function toLocalDatetimeInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({ label, value, sub }) {
  return (
    <div className="bg-gray-50 dark:bg-tm-dark-card rounded-xl px-4 py-3 border border-gray-100 dark:border-tm-dark-border">
      <div className="text-xs font-brand font-semibold text-gray-400 dark:text-tm-dark-muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-brand font-bold text-tm-blue dark:text-tm-teal mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-400 dark:text-tm-dark-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function CustomTooltip({ active, payload, label, dark }) {
  if (!active || !payload?.length) return null
  return (
    <div className={`rounded-lg px-3 py-2 shadow-lg border text-xs font-brand ${dark ? 'bg-tm-dark-card border-tm-dark-border text-tm-dark-text' : 'bg-white border-gray-200 text-gray-700'}`}>
      <div className="font-semibold mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.fill || p.color }} />
          <span>{p.name}: <strong>{p.value}</strong></span>
        </div>
      ))}
    </div>
  )
}

function ScopeTag({ scope }) {
  if (!scope) return <span className="text-gray-400 dark:text-tm-dark-muted">—</span>
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: (SCOPE_COLORS[scope] || '#6B7280') + '22', color: SCOPE_COLORS[scope] || '#6B7280' }}>
      {scope}
    </span>
  )
}

function TypeTag({ type }) {
  if (!type) return <span className="text-gray-400 dark:text-tm-dark-muted">—</span>
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: (TYPE_COLORS[type] || '#6B7280') + '22', color: TYPE_COLORS[type] || '#6B7280' }}>
      {type}
    </span>
  )
}

function StatusBadge({ status }) {
  const cls = status === 'active'
    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
    : status === 'resolved'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : 'bg-gray-100 text-gray-500 dark:bg-tm-dark-card dark:text-tm-dark-muted'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${cls}`}>{status || '—'}</span>
}

// ── Column Picker ─────────────────────────────────────────────────────────────

function ColPicker({ hiddenCols, onChange, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-xl shadow-xl w-52 p-3">
      <div className="text-[10px] font-brand font-bold uppercase tracking-wide text-gray-400 dark:text-tm-dark-muted mb-2">Show / Hide Columns</div>
      <div className="space-y-1">
        {ALL_COLS.map(col => (
          <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={!hiddenCols.has(col.key)}
              onChange={() => {
                const next = new Set(hiddenCols)
                next.has(col.key) ? next.delete(col.key) : next.add(col.key)
                onChange(next)
              }}
              className="accent-tm-teal w-3.5 h-3.5"
            />
            <span className="text-xs font-brand text-gray-700 dark:text-tm-dark-text group-hover:text-tm-blue dark:group-hover:text-tm-teal">{col.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Detail / Edit / Delete Modal ───────────────────────────────────────────────

function DetailModal({ record, locMap, isAdmin, onClose, onSaved, onDeleted }) {
  const [mode, setMode]               = useState('view')  // 'view' | 'edit' | 'delete'
  const [deleteText, setDeleteText]   = useState('')
  const [deleting, setDeleting]       = useState(false)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const [form, setForm] = useState({
    started_at:               toLocalDatetimeInput(record.started_at),
    ended_at:                 toLocalDatetimeInput(record.ended_at),
    scope:                    record.scope             || '',
    downtime_type:            record.downtime_type     || '',
    reason:                   record.reason            || '',
    details:                  record.details           || '',
    resolution_notes:         record.resolution_notes  || '',
    corrective_action_needed: record.corrective_action_needed ?? null,
    corrective_action:        record.corrective_action || '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const dur = record.started_at && record.ended_at
    ? fmtDuration(new Date(record.ended_at) - new Date(record.started_at))
    : null

  const handleSave = async () => {
    setSaving(true); setError('')
    const { error: err } = await supabase.from('downtime_logs').update({
      started_at:               form.started_at ? new Date(form.started_at).toISOString() : null,
      ended_at:                 form.ended_at   ? new Date(form.ended_at).toISOString()   : null,
      scope:                    form.scope             || null,
      downtime_type:            form.downtime_type     || null,
      reason:                   form.reason            || null,
      details:                  form.details           || null,
      resolution_notes:         form.resolution_notes  || null,
      corrective_action_needed: form.corrective_action_needed,
      corrective_action:        form.corrective_action_needed ? (form.corrective_action || null) : null,
      updated_at:               new Date().toISOString(),
    }).eq('id', record.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
    onClose()
  }

  const handleDelete = async () => {
    if (deleteText.toLowerCase() !== 'delete') return
    setDeleting(true); setError('')

    // 1. Copy to deleted_downtime_logs
    const { error: insErr } = await supabase.from('deleted_downtime_logs').insert({
      original_id: record.id,
      location_id: record.location_id,
      started_at:  record.started_at,
      ended_at:    record.ended_at,
      scope:       record.scope,
      downtime_type:            record.downtime_type,
      reason:                   record.reason,
      details:                  record.details,
      resolution_notes:         record.resolution_notes,
      corrective_action_needed: record.corrective_action_needed,
      corrective_action:        record.corrective_action,
      status:                   record.status,
      site_email:               record.site_email,
      jotform_submission_id:    record.jotform_submission_id,
      started_by:               record.started_by,
      ended_by:                 record.ended_by,
    })
    if (insErr) { setError(insErr.message); setDeleting(false); return }

    // 2. Delete from JotForm if we have a submission ID
    if (record.jotform_submission_id) {
      try {
        const { data: cfg } = await supabase.from('app_settings').select('value').eq('key', 'jotform').maybeSingle()
        if (cfg?.value?.api_key) {
          await fetch(`https://api.jotform.com/submission/${record.jotform_submission_id}?apiKey=${cfg.value.api_key}`, { method: 'DELETE' })
        }
      } catch {}
    }

    // 3. Delete from downtime_logs
    await supabase.from('downtime_logs').delete().eq('id', record.id)

    setDeleting(false)
    onDeleted()
    onClose()
  }

  const inputCls = 'border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal w-full font-brand'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-w-lg w-full mx-4 bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <div className="font-brand font-bold text-sm">{locMap[record.location_id] || 'Downtime Event'}</div>
            <div className="text-tm-teal text-xs mt-0.5">{fmtDate(record.started_at)}</div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={record.status} />
            <button onClick={onClose} className="text-white/60 hover:text-white text-xl ml-2">×</button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4 text-sm font-brand">

          {mode === 'delete' ? (
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-xs text-red-700 dark:text-red-300 space-y-1 leading-relaxed">
                <p className="font-bold text-sm mb-2">⚠ This action cannot be undone</p>
                <p>Deleting this downtime will:</p>
                <ul className="list-disc ml-4 space-y-0.5">
                  <li>Remove it from the downtime list and all reports</li>
                  <li>Remove the submission from the JotForm table (if connected)</li>
                  <li>Archive it for 90 days (recoverable from the report)</li>
                </ul>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Type <strong>delete</strong> to confirm
                </label>
                <input
                  type="text"
                  value={deleteText}
                  onChange={e => setDeleteText(e.target.value)}
                  placeholder="delete"
                  className={inputCls}
                  autoFocus
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting || deleteText.toLowerCase() !== 'delete'}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-40"
                >
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button onClick={() => setMode('view')} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-tm-dark-border text-gray-500 dark:text-tm-dark-muted hover:bg-gray-50 dark:hover:bg-tm-dark-surface text-sm transition-colors">
                  Cancel
                </button>
              </div>
            </div>

          ) : mode === 'edit' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-xs">Start Time</label>
                  <input type="datetime-local" value={form.started_at} onChange={e => set('started_at', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="label-xs">End Time</label>
                  <input type="datetime-local" value={form.ended_at} onChange={e => set('ended_at', e.target.value)} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Scope</label>
                <div className="flex gap-2">
                  {SCOPE_OPTIONS.map(s => (
                    <button key={s} type="button" onClick={() => set('scope', s)}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${form.scope === s ? 'bg-tm-blue border-tm-blue text-white' : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {DOWNTIME_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => set('downtime_type', t)}
                      className={`py-1.5 rounded-lg border text-xs font-semibold transition-colors ${form.downtime_type === t ? 'bg-tm-blue border-tm-blue text-white' : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Reason</label>
                <input type="text" value={form.reason} onChange={e => set('reason', e.target.value)} className={inputCls} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Details</label>
                <textarea rows={2} value={form.details} onChange={e => set('details', e.target.value)} className={inputCls + ' resize-none'} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Resolution</label>
                <textarea rows={2} value={form.resolution_notes} onChange={e => set('resolution_notes', e.target.value)} className={inputCls + ' resize-none'} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Corrective Action Needed?</label>
                <div className="flex gap-4">
                  {[{ l: 'Yes', v: true }, { l: 'No', v: false }].map(opt => (
                    <label key={opt.l} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={form.corrective_action_needed === opt.v} onChange={() => set('corrective_action_needed', opt.v)} className="accent-tm-teal w-4 h-4" />
                      <span className="text-sm">{opt.l}</span>
                    </label>
                  ))}
                </div>
              </div>

              {form.corrective_action_needed === true && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Corrective Action</label>
                  <textarea rows={2} value={form.corrective_action} onChange={e => set('corrective_action', e.target.value)} className={inputCls + ' resize-none'} />
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button onClick={() => setMode('view')} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-tm-dark-border text-gray-500 dark:text-tm-dark-muted text-sm hover:bg-gray-50 dark:hover:bg-tm-dark-surface transition-colors">
                  Cancel
                </button>
              </div>
            </div>

          ) : (
            /* View mode */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Detail label="Scope">     <ScopeTag scope={record.scope} /></Detail>
                <Detail label="Type">      <TypeTag  type={record.downtime_type} /></Detail>
                <Detail label="Reason">    {record.reason     || '—'}</Detail>
                <Detail label="Start">     {fmtDateTime(record.started_at)}</Detail>
                <Detail label="End">       {fmtDateTime(record.ended_at)}</Detail>
                <Detail label="Duration">  {dur || '—'}</Detail>
              </div>

              {record.details && (
                <DetailBlock label="Details">{record.details}</DetailBlock>
              )}
              {record.resolution_notes && (
                <DetailBlock label="Resolution">{record.resolution_notes}</DetailBlock>
              )}
              {record.corrective_action_needed !== null && (
                <Detail label="Corrective Action Needed">
                  <span className={record.corrective_action_needed ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                    {record.corrective_action_needed ? 'Yes' : 'No'}
                  </span>
                </Detail>
              )}
              {record.corrective_action && (
                <DetailBlock label="Corrective Action">{record.corrective_action}</DetailBlock>
              )}
              {record.site_email && <Detail label="Site Email">{record.site_email}</Detail>}
            </div>
          )}
        </div>

        {/* Footer */}
        {mode === 'view' && (
          <div className="px-5 pb-4 shrink-0 flex justify-between items-center border-t border-gray-100 dark:border-tm-dark-border pt-3">
            <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">Close</button>
            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={() => setMode('edit')}
                  className="px-4 py-1.5 rounded-lg bg-tm-blue text-white text-xs font-brand font-semibold hover:brightness-110 transition-colors">
                  Edit
                </button>
                <button onClick={() => setMode('delete')}
                  className="px-4 py-1.5 rounded-lg border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs font-brand font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Detail({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-brand font-semibold uppercase tracking-wide text-gray-400 dark:text-tm-dark-muted mb-0.5">{label}</div>
      <div className="text-sm text-gray-700 dark:text-tm-dark-text">{children}</div>
    </div>
  )
}

function DetailBlock({ label, children }) {
  return (
    <div className="bg-gray-50 dark:bg-tm-dark-surface rounded-lg p-3">
      <div className="text-[10px] font-brand font-semibold uppercase tracking-wide text-gray-400 dark:text-tm-dark-muted mb-1">{label}</div>
      <div className="text-sm text-gray-700 dark:text-tm-dark-text leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DowntimeSection({ logs = [], locations = [], dark, isAdmin = false, onRefresh }) {
  const [groupBy,    setGroupBy]    = useState('day')
  const [metric,     setMetric]     = useState('count')
  const [sortCol,    setSortCol]    = useState('started_at')
  const [sortDir,    setSortDir]    = useState('desc')
  const [typeFilter, setTypeFilter] = useState('all')
  const [scopeFilter,setScopeFilter]= useState('all')
  const [hiddenCols, setHiddenCols] = useState(loadHiddenCols)
  const [showColPicker, setShowColPicker] = useState(false)
  const [selectedRow,   setSelectedRow]   = useState(null)
  const [deletedLogs,   setDeletedLogs]   = useState([])
  const [showDeleted,   setShowDeleted]   = useState(false)
  const colPickerRef = useRef(null)

  const locMap = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l.name])), [locations])
  const visibleColKeys = ALL_COLS.map(c => c.key).filter(k => !hiddenCols.has(k))
  const hiddenCount = hiddenCols.size

  // Fetch deleted logs for this section's location set
  useEffect(() => {
    const locIds = locations.map(l => l.id)
    if (!locIds.length) return
    supabase.from('deleted_downtime_logs')
      .select('*')
      .in('location_id', locIds)
      .order('deleted_at', { ascending: false })
      .then(({ data }) => setDeletedLogs(data || []))
  }, [locations, logs])

  const handleHiddenColsChange = (next) => {
    setHiddenCols(next)
    saveHiddenCols(next)
  }

  const filtered = useMemo(() => {
    let r = logs
    if (typeFilter  !== 'all') r = r.filter(x => x.downtime_type === typeFilter)
    if (scopeFilter !== 'all') r = r.filter(x => x.scope === scopeFilter)
    return r
  }, [logs, typeFilter, scopeFilter])

  const stats = useMemo(() => {
    const total  = filtered.length
    const active = filtered.filter(r => r.status === 'active').length
    const res    = filtered.filter(r => r.status === 'resolved' && r.started_at && r.ended_at)
    const durs   = res.map(r => new Date(r.ended_at) - new Date(r.started_at))
    const totalMs = durs.reduce((a, b) => a + b, 0)
    const avgMs   = durs.length ? totalMs / durs.length : 0
    return { total, active, totalMs, avgMs }
  }, [filtered])

  const chartData = useMemo(() => {
    const makeEntry = (label, r) => ({
      label,
      count:      0,
      durationMs: 0,
      _add(rec) { this.count++; if (rec.ended_at && rec.started_at) this.durationMs += new Date(rec.ended_at) - new Date(rec.started_at) },
    })
    const map = {}

    filtered.forEach(r => {
      let key
      if (groupBy === 'day')      key = r.started_at?.slice(0, 10)
      if (groupBy === 'location') key = locMap[r.location_id] || r.location_id
      if (groupBy === 'type')     key = r.downtime_type || 'Unknown'
      if (groupBy === 'scope')    key = r.scope         || 'Unknown'
      if (!key) return
      if (!map[key]) map[key] = { label: groupBy === 'day' ? new Date(key + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : key, count: 0, durationMs: 0 }
      map[key].count++
      if (r.ended_at && r.started_at) map[key].durationMs += new Date(r.ended_at) - new Date(r.started_at)
    })

    return Object.entries(map)
      .map(([, v]) => ({ label: v.label, value: metric === 'count' ? v.count : Math.round(v.durationMs / 60000) }))
      .sort(groupBy === 'day' ? (a, b) => 0 : (a, b) => b.value - a.value)
  }, [filtered, groupBy, metric, locMap])

  const tableRows = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      const colToField = { date: 'started_at', location: 'location_id', scope: 'scope', type: 'downtime_type', reason: 'reason', details: 'details', started: 'started_at', ended: 'ended_at', duration: null, status: 'status', resolution: 'resolution_notes', ca_needed: 'corrective_action_needed', ca: 'corrective_action', multi_day: null, site_email: 'site_email' }
      const field = colToField[sortCol] || sortCol
      const va = a[field] ?? '', vb = b[field] ?? ''
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1  : -1
      return 0
    })
    return copy
  }, [filtered, sortCol, sortDir])

  const sortBy = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }) => sortCol !== col ? null : <span className="ml-1 opacity-60">{sortDir === 'asc' ? '▲' : '▼'}</span>

  const gridColor = dark ? '#2a3448' : '#e5e7eb'
  const axisColor = dark ? '#8899bb' : '#6b7280'
  const allTypes  = [...new Set(logs.map(r => r.downtime_type).filter(Boolean))].sort()
  const allScopes = [...new Set(logs.map(r => r.scope).filter(Boolean))].sort()

  const handleRecover = async (delRecord) => {
    // Re-insert into downtime_logs
    const { error } = await supabase.from('downtime_logs').insert({
      location_id:              delRecord.location_id,
      started_at:               delRecord.started_at,
      ended_at:                 delRecord.ended_at,
      scope:                    delRecord.scope,
      downtime_type:            delRecord.downtime_type,
      reason:                   delRecord.reason,
      details:                  delRecord.details,
      resolution_notes:         delRecord.resolution_notes,
      corrective_action_needed: delRecord.corrective_action_needed,
      corrective_action:        delRecord.corrective_action,
      status:                   delRecord.status,
      site_email:               delRecord.site_email,
      jotform_submission_id:    delRecord.jotform_submission_id,
      started_by:               delRecord.started_by,
      ended_by:                 delRecord.ended_by,
    })
    if (!error) {
      await supabase.from('deleted_downtime_logs').delete().eq('id', delRecord.id)
      setDeletedLogs(prev => prev.filter(r => r.id !== delRecord.id))
      if (onRefresh) onRefresh()
    }
  }

  if (!logs.length && !deletedLogs.length) {
    return <div className="py-10 text-center text-sm text-gray-400 dark:text-tm-dark-muted font-brand">No downtime events found for the selected period and locations.</div>
  }

  const visibleCols = ALL_COLS.filter(c => !hiddenCols.has(c.key))

  const getCellVal = (row, key) => {
    const start = row.started_at ? new Date(row.started_at) : null
    const end   = row.ended_at   ? new Date(row.ended_at)   : null
    switch (key) {
      case 'date':       return start ? fmtDate(row.started_at)     : '—'
      case 'location':   return locMap[row.location_id]             || '—'
      case 'scope':      return <ScopeTag scope={row.scope} />
      case 'type':       return <TypeTag  type={row.downtime_type} />
      case 'reason':     return <span className="truncate max-w-[120px] block" title={row.reason}>{row.reason || '—'}</span>
      case 'details':    return <span className="truncate max-w-[140px] block" title={row.details}>{row.details || '—'}</span>
      case 'started':    return start ? <><div>{fmtDate(row.started_at)}</div><div className="text-[10px] text-gray-400 dark:text-tm-dark-muted">{fmtTime(row.started_at)}</div></> : '—'
      case 'ended':      return end   ? <><div>{fmtDate(row.ended_at)}</div><div className="text-[10px] text-gray-400 dark:text-tm-dark-muted">{fmtTime(row.ended_at)}</div></>   : '—'
      case 'duration':   return row.status === 'active' ? <span className="text-red-500 font-semibold animate-pulse text-[10px]">Active</span> : (start && end ? fmtDuration(end - start) : '—')
      case 'status':     return <StatusBadge status={row.status} />
      case 'resolution': return <span className="truncate max-w-[160px] block" title={row.resolution_notes}>{row.resolution_notes || '—'}</span>
      case 'ca_needed':  return row.corrective_action_needed === true ? <span className="text-amber-500 font-bold">✓ Yes</span> : row.corrective_action_needed === false ? <span className="text-gray-400">No</span> : <span className="text-gray-300 dark:text-tm-dark-border text-[10px]">n/a</span>
      case 'ca':         return <span className="truncate max-w-[160px] block" title={row.corrective_action}>{row.corrective_action || '—'}</span>
      case 'multi_day':  return start && end && start.toDateString() !== end.toDateString() ? 'Yes' : start && end ? 'No' : '—'
      case 'site_email': return <span className="truncate max-w-[140px] block" title={row.site_email}>{row.site_email || '—'}</span>
      default:           return '—'
    }
  }

  return (
    <div className="space-y-5 mt-3">

      {/* Stats */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Total Events"    value={stats.total}  sub={stats.active ? `${stats.active} active` : 'none active'} />
          <StatTile label="Total Downtime"  value={fmtDuration(stats.totalMs)} sub="resolved events" />
          <StatTile label="Avg Duration"    value={fmtDuration(stats.avgMs)}   sub="per resolved event" />
          <StatTile label="Showing"         value={filtered.length} sub={`of ${logs.length} events`} />
        </div>
      )}

      {/* Filters + group controls */}
      <div className="flex flex-wrap gap-2 items-center text-xs font-brand">
        <span className="text-gray-500 dark:text-tm-dark-muted font-semibold uppercase tracking-wide">Group by:</span>
        {['day', 'location', 'type', 'scope'].map(g => (
          <button key={g} onClick={() => setGroupBy(g)}
            className={`px-3 py-1 rounded-full border transition-colors capitalize ${groupBy === g ? 'bg-tm-blue text-white border-tm-blue' : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted hover:border-tm-blue'}`}>
            {g}
          </button>
        ))}
        <span className="ml-2 text-gray-500 dark:text-tm-dark-muted font-semibold uppercase tracking-wide">Metric:</span>
        {[{ k: 'count', l: 'Events' }, { k: 'duration', l: 'Minutes' }].map(m => (
          <button key={m.k} onClick={() => setMetric(m.k)}
            className={`px-3 py-1 rounded-full border transition-colors ${metric === m.k ? 'bg-tm-teal text-tm-navy border-tm-teal font-bold' : 'border-gray-300 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted hover:border-tm-teal'}`}>
            {m.l}
          </button>
        ))}
        <div className="flex-1" />
        {allTypes.length > 0 && (
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="border border-gray-300 dark:border-tm-dark-border rounded-md px-2 py-1 bg-white dark:bg-tm-dark-card text-gray-700 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal text-xs font-brand">
            <option value="all">All Types</option>
            {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {allScopes.length > 0 && (
          <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}
            className="border border-gray-300 dark:border-tm-dark-border rounded-md px-2 py-1 bg-white dark:bg-tm-dark-card text-gray-700 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal text-xs font-brand">
            <option value="all">All Scopes</option>
            {allScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-gray-50 dark:bg-tm-dark-card rounded-xl border border-gray-100 dark:border-tm-dark-border px-4 py-4">
          <div className="text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-3">
            {metric === 'count' ? 'Event Count' : 'Total Duration (min)'} by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor, fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: axisColor, fontFamily: 'inherit' }} axisLine={false} tickLine={false} allowDecimals={false} width={35} />
              <Tooltip content={<CustomTooltip dark={dark} />} cursor={{ fill: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="value" name={metric === 'count' ? 'Events' : 'Minutes'} radius={[4, 4, 0, 0]}>
                {chartData.map((entry, idx) => {
                  let fill = '#0d6fb8'
                  if (groupBy === 'type')  fill = TYPE_COLORS[entry.label]  || '#6B7280'
                  if (groupBy === 'scope') fill = SCOPE_COLORS[entry.label] || '#6B7280'
                  return <Cell key={idx} fill={fill} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table toolbar */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide">
          {tableRows.length} event{tableRows.length !== 1 ? 's' : ''}
          {isAdmin && <span className="ml-1 text-gray-400 dark:text-tm-dark-muted font-normal normal-case">· click a row to view / edit</span>}
        </span>
        <div className="flex items-center gap-2">
          {/* Edit Columns */}
          <div className="relative" ref={colPickerRef}>
            <button
              onClick={() => setShowColPicker(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-brand font-semibold rounded-lg border border-gray-200 dark:border-tm-dark-border bg-white dark:bg-tm-dark-surface text-gray-500 dark:text-tm-dark-muted hover:text-tm-blue hover:border-tm-teal transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M2 4a1 1 0 011-1h10a1 1 0 011 1v1a1 1 0 01-1 1H3a1 1 0 01-1-1V4zm0 5a1 1 0 011-1h10a1 1 0 011 1v1a1 1 0 01-1 1H3a1 1 0 01-1-1V9zm0 5a1 1 0 011-1h6a1 1 0 010 2H3a1 1 0 01-1-1v-1z"/>
              </svg>
              Edit Columns
              {hiddenCount > 0 && <span className="ml-0.5 text-[10px] text-amber-500 font-bold">{hiddenCount} hidden</span>}
            </button>
            {showColPicker && (
              <ColPicker
                hiddenCols={hiddenCols}
                onChange={handleHiddenColsChange}
                onClose={() => setShowColPicker(false)}
              />
            )}
          </div>

          {/* Export */}
          <ExportMenu items={[
            { label: 'Excel — table data', run: () => exportDowntimeXlsx({ logs: filtered, locMap, visibleColKeys, filename: 'downtime_report' }) },
            { label: 'PDF — table data',   run: () => exportDowntimePdf({  logs: filtered, locMap, visibleColKeys, filename: 'downtime_report' }) },
          ]} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
        <table className="w-full text-xs font-brand border-collapse" style={{ minWidth: `${visibleCols.length * 120}px` }}>
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              {visibleCols.map(col => (
                <th
                  key={col.key}
                  onClick={() => sortBy(col.key)}
                  className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap select-none cursor-pointer hover:text-tm-teal"
                >
                  {col.label}<SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => (
              <tr
                key={row.id}
                onClick={() => setSelectedRow(row)}
                className={`border-t border-gray-100 dark:border-tm-dark-border cursor-pointer transition-colors hover:bg-tm-sky/10 dark:hover:bg-tm-teal/5 ${i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}`}
              >
                {visibleCols.map(col => (
                  <td key={col.key} className="px-3 py-2 text-gray-700 dark:text-tm-dark-text align-top">
                    {getCellVal(row, col.key)}
                  </td>
                ))}
              </tr>
            ))}
            {!tableRows.length && (
              <tr><td colSpan={visibleCols.length} className="px-4 py-8 text-center text-gray-400 dark:text-tm-dark-muted">No events match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Deleted events */}
      {deletedLogs.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowDeleted(o => !o)}
            className="text-xs font-brand text-gray-400 dark:text-tm-dark-muted hover:text-gray-600 dark:hover:text-white transition-colors flex items-center gap-1"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${showDeleted ? '' : '-rotate-90'}`}>
              <path fillRule="evenodd" d="M1.646 4.646a.5.5 0 01.708 0L8 10.293l5.646-5.647a.5.5 0 01.708.708l-6 6a.5.5 0 01-.708 0l-6-6a.5.5 0 010-.708z" clipRule="evenodd"/>
            </svg>
            {deletedLogs.length} downtime event{deletedLogs.length !== 1 ? 's' : ''} deleted
          </button>

          {showDeleted && (
            <div className="mt-2 rounded-xl border border-dashed border-red-200 dark:border-red-900 overflow-hidden">
              <table className="w-full text-xs font-brand border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                    <th className="px-3 py-2 text-left font-semibold">Location</th>
                    <th className="px-3 py-2 text-left font-semibold">Date</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-left font-semibold">Reason</th>
                    <th className="px-3 py-2 text-left font-semibold">Deleted</th>
                    <th className="px-3 py-2 text-left font-semibold">Expires</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {deletedLogs.map((r, i) => (
                    <tr key={r.id} className={`border-t border-red-100 dark:border-red-900/30 ${i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-red-50/30 dark:bg-red-900/10'}`}>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-text">{locMap[r.location_id] || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-text">{fmtDate(r.started_at)}</td>
                      <td className="px-3 py-2"><TypeTag type={r.downtime_type} /></td>
                      <td className="px-3 py-2 text-gray-600 dark:text-tm-dark-text">{r.reason || '—'}</td>
                      <td className="px-3 py-2 text-gray-400 dark:text-tm-dark-muted">{fmtDate(r.deleted_at)}</td>
                      <td className="px-3 py-2 text-gray-400 dark:text-tm-dark-muted">{fmtDate(r.expires_at)}</td>
                      <td className="px-3 py-2 text-right">
                        {isAdmin && (
                          <button onClick={() => handleRecover(r)}
                            className="text-[10px] font-semibold text-tm-teal hover:text-tm-blue transition-colors uppercase tracking-wide">
                            Recover
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedRow && (
        <DetailModal
          record={selectedRow}
          locMap={locMap}
          isAdmin={isAdmin}
          onClose={() => setSelectedRow(null)}
          onSaved={() => { setSelectedRow(null); if (onRefresh) onRefresh() }}
          onDeleted={() => { setSelectedRow(null); if (onRefresh) onRefresh() }}
        />
      )}
    </div>
  )
}
