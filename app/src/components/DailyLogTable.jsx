import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import EmployeeSelect from './EmployeeSelect'
import TmLoader from './TmLoader'
import { shopTotals } from '../utils/logMath'
import { pmixCls, convCls, pmixTotalsCls, convTotalsCls } from '../utils/metricColors'

const TIME_SLOTS = [
  { label: '8:00 AM',  value: '08:00:00' },
  { label: '9:00 AM',  value: '09:00:00' },
  { label: '10:00 AM', value: '10:00:00' },
  { label: '11:00 AM', value: '11:00:00' },
  { label: '12:00 PM', value: '12:00:00' },
  { label: '1:00 PM',  value: '13:00:00' },
  { label: '2:00 PM',  value: '14:00:00' },
  { label: '3:00 PM',  value: '15:00:00' },
  { label: '4:00 PM',  value: '16:00:00' },
  { label: '5:00 PM',  value: '17:00:00' },
  { label: '6:00 PM',  value: '18:00:00' },
  { label: '7:00 PM',  value: '19:00:00' },
  { label: '8:00 PM',  value: '20:00:00' },
]

const COLUMN_DEFS = [
  { key: 'google_reviews', label: 'Google\nReviews' },
  { key: 'total_washes',   label: 'Total\nWashes'   },
  { key: 'member_washes',  label: 'Member\nWashes'  },
  { key: 'basic',          label: 'Basic'            },
  { key: 'good',           label: 'Good'             },
  { key: 'better',         label: 'Better'           },
  { key: 'best',           label: 'Best'             },
  { key: 'net_members',    label: 'Net\nMembers'     },
]

const ALL_KEYS = COLUMN_DEFS.map(c => c.key)

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const emptyRow = (timeSlot) =>
  ALL_KEYS.reduce((acc, f) => ({ ...acc, [f]: '' }), {
    time_slot: timeSlot,
    employee_name: '',
  })

const compute = (row, formula = 'detailed') => {
  const basic  = toInt(row.basic)
  const good   = toInt(row.good)
  const better = toInt(row.better)
  const best   = toInt(row.best)
  const tw     = toInt(row.total_washes)
  const mw     = toInt(row.member_washes)

  const memberships_sold = basic + good + better + best
  const opportunities    =
    formula === 'simple'
      ? Math.max(0, tw - mw)
      : Math.max(0, tw - mw + memberships_sold)

  const p_mix =
    memberships_sold > 0
      ? ((better + best) / memberships_sold * 100).toFixed(1) + '%'
      : ''
  const conversion =
    opportunities > 0
      ? (memberships_sold / opportunities * 100).toFixed(1) + '%'
      : ''

  return { memberships_sold, opportunities, p_mix, conversion }
}

const rowHasData = (row) =>
  row.employee_name?.trim() || ALL_KEYS.some(f => toInt(row[f]) > 0)

const MAX_HISTORY = 30

// Parse "8:00 AM" / "1:00 PM" → "08:00:00" / "13:00:00"
const parseTimeToSlot = (str) => {
  if (!str) return null
  const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  let h = parseInt(m[1])
  const ampm = m[3].toUpperCase()
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:00:00`
}

// RFC-4180-style TSV parser — handles quoted fields with embedded newlines/tabs
const parseTSV = (text) => {
  const rows = []
  let row = [], cell = '', inQuotes = false, i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (ch === '"') { inQuotes = false }
      else { cell += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === '\t') { row.push(cell); cell = '' }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        row.push(cell); cell = ''
        if (row.some(c => c.trim())) rows.push(row)
        row = []
      } else { cell += ch }
    }
    i++
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row) }
  return rows
}

// ── Edit Employees Modal ─────────────────────────────────────────────────────

function EditEmployeesModal({ locationId, onClose, onRefresh }) {
  const [emps, setEmps]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data } = await supabase
      .from('employees').select('*').eq('location_id', locationId).order('name')
    setEmps(data || [])
    setLoading(false)
  }

  const toggle = async (emp) => {
    await supabase.from('employees').update({ is_active: !emp.is_active }).eq('id', emp.id)
    fetchAll()
    onRefresh()
  }

  const del = async (id) => {
    if (!window.confirm('Delete this employee permanently?')) return
    await supabase.from('employees').delete().eq('id', id)
    fetchAll()
    onRefresh()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-w-sm w-full mx-4 bg-white dark:bg-tm-dark-card rounded-xl shadow-2xl p-5 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-brand font-bold text-sm text-tm-blue dark:text-tm-dark-text">Employees</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-white text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-4"><TmLoader size={56} /></div>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {emps.map(emp => (
              <div
                key={emp.id}
                className="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-tm-dark-border"
              >
                <span className={`flex-1 font-brand text-sm ${
                  emp.is_active
                    ? 'text-gray-800 dark:text-tm-dark-text'
                    : 'line-through text-gray-400 dark:text-tm-dark-muted'
                }`}>
                  {emp.name}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-brand font-semibold ${
                  emp.is_active
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-tm-dark-surface dark:text-gray-400'
                }`}>
                  {emp.is_active ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => toggle(emp)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                    emp.is_active
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {emp.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button
                  onClick={() => del(emp.id)}
                  className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                >
                  Del
                </button>
              </div>
            ))}
            {!emps.length && (
              <p className="text-sm text-gray-400 dark:text-tm-dark-muted py-3">No employees yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Paste Data Modal ─────────────────────────────────────────────────────────

function PasteModal({ onClose, onApply }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const handleApply = () => {
    const result = onApply(text)
    if (result?.error) { setError(result.error); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-w-xl w-full mx-4 bg-white dark:bg-tm-dark-card rounded-xl shadow-2xl p-5 z-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-brand font-bold text-sm text-tm-blue dark:text-tm-dark-text">Paste Table Data</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-tm-dark-muted mb-3 font-brand">
          Copy the table from your spreadsheet and paste it below. Must include a header row with column names (Name, Time, Google Reviews, Total Washes, etc.).
        </p>
        <textarea
          autoFocus
          className="w-full h-44 border border-gray-200 dark:border-tm-dark-border rounded-lg p-2 text-xs font-mono bg-gray-50 dark:bg-tm-dark-surface dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal resize-none"
          placeholder="Paste table data here (Ctrl+V)…"
          value={text}
          onChange={e => { setText(e.target.value); setError('') }}
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-brand">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded border border-gray-200 dark:border-tm-dark-border text-xs font-brand text-gray-600 dark:text-tm-dark-muted hover:bg-gray-50 dark:hover:bg-tm-dark-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!text.trim()}
            className="px-4 py-1.5 rounded bg-tm-blue text-white text-xs font-brand hover:bg-tm-navy disabled:opacity-40 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DailyLogTable({
  locationId,
  locationName,
  selectedDate,
  canEdit,
  opportunitiesFormula = 'detailed',
  onRowsChange,
  profile,
  metricThresholds,
}) {
  const [rows, setRows]       = useState(TIME_SLOTS.map(s => emptyRow(s.value)))
  const [employees, setEmps]  = useState([])
  const [saving, setSaving]   = useState(new Set())
  const [saveError, setSaveError] = useState(null)
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem('tm_daily_view_mode')
    if (saved) return saved
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table'
  })
  const [cardHour, setCardHour] = useState(() => {
    const h = new Date().getHours()
    const target = `${String(Math.max(8, h - 1)).padStart(2, '0')}:00:00`
    return TIME_SLOTS.find(s => s.value === target)?.value ?? TIME_SLOTS[0].value
  })
  const [reorderMode, setReorderMode] = useState(false)
  const [draggedIdx, setDraggedIdx]   = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [copyFeedback, setCopyFeedback]     = useState(false)

  // Column order — scoped per role
  const roleKey = `tm_col_order_${profile?.role || 'default'}`
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(roleKey))
      if (Array.isArray(saved) && saved.length === ALL_KEYS.length &&
          ALL_KEYS.every(k => saved.includes(k))) return saved
    } catch {}
    return [...ALL_KEYS]
  })

  const { updateProfileSettings } = useAuth()
  const profileSyncedRef = useRef(false)

  // Sync column order from profile settings when profile loads (cross-device)
  useEffect(() => {
    if (profileSyncedRef.current || !profile) return
    profileSyncedRef.current = true
    const profileOrder = profile?.settings?.[roleKey]
    if (Array.isArray(profileOrder) && profileOrder.length === ALL_KEYS.length &&
        ALL_KEYS.every(k => profileOrder.includes(k))) {
      setColumnOrder(profileOrder)
      localStorage.setItem(roleKey, JSON.stringify(profileOrder))
    }
  }, [profile])

  const rowsRef      = useRef(rows)
  rowsRef.current    = rows
  const saveTimers   = useRef({})
  const historyRef   = useRef([])
  const employeesRef = useRef(employees)
  employeesRef.current = employees

  const locationIdRef = useRef(locationId)
  const dateRef       = useRef(selectedDate)
  const canEditRef    = useRef(canEdit)
  const formulaRef    = useRef(opportunitiesFormula)
  const tableContainerRef = useRef(null)

  useEffect(() => { locationIdRef.current = locationId },        [locationId])
  useEffect(() => { dateRef.current = selectedDate },            [selectedDate])
  useEffect(() => { canEditRef.current = canEdit },              [canEdit])
  useEffect(() => { formulaRef.current = opportunitiesFormula }, [opportunitiesFormula])

  useEffect(() => { onRowsChange?.(rows) }, [rows])

  useEffect(() => {
    fetchData()
    fetchEmployees()
    historyRef.current = []
  }, [locationId, selectedDate])

  useEffect(() => {
    return () => {
      const pending = Object.keys(saveTimers.current)
      if (!pending.length) return
      pending.forEach(idx => {
        clearTimeout(saveTimers.current[idx])
        flushSave(parseInt(idx))
      })
      saveTimers.current = {}
    }
  }, [])

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, name')
      .eq('location_id', locationIdRef.current)
      .eq('is_active', true)
      .order('name')
    setEmps(data || [])
  }

  const fetchData = async () => {
    const { data } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('location_id', locationId)
      .eq('log_date', selectedDate)

    setRows(
      TIME_SLOTS.map(slot => {
        const existing = data?.find(d => d.time_slot === slot.value)
        if (!existing) return emptyRow(slot.value)
        const hasData = existing.employee_name ||
          ALL_KEYS.some(f => (existing[f] ?? 0) > 0)
        if (!hasData) return emptyRow(slot.value)
        return {
          ...existing,
          ...ALL_KEYS.reduce((acc, f) => ({ ...acc, [f]: existing[f] ?? '' }), {}),
          employee_name: existing.employee_name ?? '',
        }
      })
    )
  }

  // ── Save / delete ────────────────────────────────────────────────────────────

  const doSave = useCallback(async (index) => {
    if (!canEditRef.current) return
    const row = rowsRef.current[index]
    if (!row) return

    if (!rowHasData(row)) {
      if (row.id) {
        await supabase.from('daily_logs').delete().eq('id', row.id)
        setRows(prev => {
          const next = [...prev]
          next[index] = { ...next[index], id: undefined }
          return next
        })
      }
      return
    }

    const { memberships_sold, opportunities } = compute(row, formulaRef.current)
    setSaving(prev => new Set([...prev, index]))
    const { data: saved, error } = await supabase.from('daily_logs').upsert(
      {
        location_id:      locationIdRef.current,
        log_date:         dateRef.current,
        time_slot:        row.time_slot,
        employee_name:    row.employee_name || null,
        google_reviews:   toInt(row.google_reviews),
        total_washes:     toInt(row.total_washes),
        member_washes:    toInt(row.member_washes),
        basic:            toInt(row.basic),
        good:             toInt(row.good),
        better:           toInt(row.better),
        best:             toInt(row.best),
        net_members:      toInt(row.net_members),
        memberships_sold,
        opportunities,
      },
      { onConflict: 'location_id,log_date,time_slot' }
    ).select('id').single()

    if (error) {
      console.error('Save failed:', error)
      setSaveError(`Save failed: ${error.message}`)
      setTimeout(() => setSaveError(null), 5000)
    } else if (saved?.id && !rowsRef.current[index]?.id) {
      setRows(prev => {
        const next = [...prev]
        next[index] = { ...next[index], id: saved.id }
        return next
      })
    }
    setSaving(prev => { const n = new Set(prev); n.delete(index); return n })
  }, [])

  const flushSave = useCallback(async (index) => {
    if (!canEditRef.current) return
    const row = rowsRef.current[index]
    if (!row) return
    if (!rowHasData(row)) {
      if (row.id) await supabase.from('daily_logs').delete().eq('id', row.id)
      return
    }
    const { memberships_sold, opportunities } = compute(row, formulaRef.current)
    await supabase.from('daily_logs').upsert(
      {
        location_id:      locationIdRef.current,
        log_date:         dateRef.current,
        time_slot:        row.time_slot,
        employee_name:    row.employee_name || null,
        google_reviews:   toInt(row.google_reviews),
        total_washes:     toInt(row.total_washes),
        member_washes:    toInt(row.member_washes),
        basic:            toInt(row.basic),
        good:             toInt(row.good),
        better:           toInt(row.better),
        best:             toInt(row.best),
        net_members:      toInt(row.net_members),
        memberships_sold,
        opportunities,
      },
      { onConflict: 'location_id,log_date,time_slot' }
    )
  }, [])

  // ── Undo ─────────────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    const snapshot = historyRef.current[historyRef.current.length - 1]
    historyRef.current = historyRef.current.slice(0, -1)

    const current       = rowsRef.current
    const changedIndices = snapshot
      .map((_, i) => i)
      .filter(i => JSON.stringify(snapshot[i]) !== JSON.stringify(current[i]))

    rowsRef.current = snapshot
    setRows(snapshot)

    changedIndices.forEach(i => {
      clearTimeout(saveTimers.current[i])
      saveTimers.current[i] = setTimeout(() => {
        delete saveTimers.current[i]
        doSave(i)
      }, 100)
    })
  }, [doSave])

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo])

  // ── Edit handlers ────────────────────────────────────────────────────────────

  const update = (index, field, value) => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      rowsRef.current.map(r => ({ ...r })),
    ]
    // Update ref immediately so saves triggered synchronously after onChange see the new value
    const next = [...rowsRef.current]
    next[index] = { ...next[index], [field]: value }
    rowsRef.current = next
    setRows(next)
    clearTimeout(saveTimers.current[index])
    saveTimers.current[index] = setTimeout(() => {
      delete saveTimers.current[index]
      doSave(index)
    }, 800)
  }

  const autoAddEmployee = async (name) => {
    if (!name?.trim()) return
    const trimmed = name.trim()
    if (employeesRef.current.some(e => e.name.toLowerCase() === trimmed.toLowerCase())) return
    const { error } = await supabase.from('employees').insert({
      location_id: locationIdRef.current,
      name: trimmed,
      is_active: true,
    })
    if (!error) fetchEmployees()
  }

  const saveImmediately = (index) => {
    clearTimeout(saveTimers.current[index])
    delete saveTimers.current[index]
    doSave(index)
    const row = rowsRef.current[index]
    if (row?.employee_name?.trim()) autoAddEmployee(row.employee_name)
  }

  // ── Arrow key navigation ─────────────────────────────────────────────────────

  const handleCellKeyDown = (e, rowIdx, colIdx) => {
    const deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (!deltas[e.key]) return
    e.preventDefault()
    const [dr, dc] = deltas[e.key]
    tableContainerRef.current
      ?.querySelector(`[data-row="${rowIdx + dr}"][data-col="${colIdx + dc}"]`)
      ?.focus()
  }

  // ── Copy table as image ───────────────────────────────────────────────────────

  const copyTableAsImage = async () => {
    const SCALE    = 2
    const BANNER_H = 36
    const HEADER_H = 40
    const ROW_H    = 24
    const PAD      = 6
    const FONT     = `-apple-system, "Segoe UI", Arial, sans-serif`

    const KEY_W = {
      employee_name: 90, _time: 64,
      google_reviews: 54, total_washes: 54, member_washes: 60,
      basic: 44, good: 44, better: 44, best: 44, net_members: 54,
      _ms: 74, _opp: 72, _pmix: 55, _conv: 64,
    }

    const imgCols = [
      { key: 'employee_name', label: 'Name',              align: 'left'   },
      { key: '_time',         label: 'Time',              align: 'center' },
      ...orderedCols.map(c => ({ key: c.key, label: c.label, align: 'center' })),
      { key: '_ms',   label: 'Memberships\nSold', align: 'center', accent: 'teal'   },
      { key: '_opp',  label: 'Opportunities',     align: 'center', accent: 'teal'   },
      { key: '_pmix', label: 'P-Mix',             align: 'center', accent: 'orange' },
      { key: '_conv', label: 'Conversion',        align: 'center', accent: 'orange' },
    ]

    const cw     = (col) => KEY_W[col.key] || 54
    const totalW = imgCols.reduce((s, c) => s + cw(c), 0)
    const totalH = BANNER_H + HEADER_H + TIME_SLOTS.length * ROW_H + ROW_H

    const canvas = document.createElement('canvas')
    canvas.width  = totalW * SCALE
    canvas.height = totalH * SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)

    const C = {
      navyBg: '#1B3A5C', tealBg: '#4DBDB5', orangeBg: '#D97706',
      white: '#FFFFFF', navyText: '#0F2740', bodyText: '#1F2937',
      timeText: '#6B7280', blueText: '#1E3A8A',
      rowAlt: '#EEF9F8', rowNorm: '#FFFFFF',
      tealCell: '#CBF0EC',
      totRow: '#C0E8E3', totTeal: '#9FD9D4',
      grid: '#D1D5DB', border: '#9CA3AF',
    }

    const th = metricThresholds
    const pmixBg    = (v) => { const n = parseFloat(v); const g = th?.pmix_green ?? 60; return !isNaN(n) && n >= g ? '#DCFCE7' : '#FFF3E8' }
    const pmixFg    = (v) => { const n = parseFloat(v); const g = th?.pmix_green ?? 60; return !isNaN(n) && n >= g ? '#166534' : '#92400E' }
    const pmixTotBg = (v) => { const n = parseFloat(v); const g = th?.pmix_green ?? 60; return !isNaN(n) && n >= g ? '#BBF7D0' : '#FED7AA' }
    const convBg    = (v) => { const n = parseFloat(v); const r = th?.conv_red ?? 7, y = th?.conv_yellow ?? 10; if (isNaN(n)) return '#FFF3E8'; if (n < r) return '#FEE2E2'; if (n < y) return '#FEF9C3'; return '#DCFCE7' }
    const convFg    = (v) => { const n = parseFloat(v); const r = th?.conv_red ?? 7, y = th?.conv_yellow ?? 10; if (isNaN(n)) return '#92400E'; if (n < r) return '#991B1B'; if (n < y) return '#854D0E'; return '#166534' }
    const convTotBg = (v) => { const n = parseFloat(v); const r = th?.conv_red ?? 7, y = th?.conv_yellow ?? 10; if (isNaN(n)) return '#FED7AA'; if (n < r) return '#FECACA'; if (n < y) return '#FEF08A'; return '#BBF7D0' }

    const fillText = (text, x, y, align) => {
      ctx.textAlign     = align === 'left' ? 'left' : 'center'
      ctx.textBaseline  = 'middle'
      ctx.fillText(String(text), x, y)
    }

    // ── Banner ──
    const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
    ctx.fillStyle = C.navyBg
    ctx.fillRect(0, 0, totalW, BANNER_H)
    ctx.fillStyle = C.white
    ctx.font      = `bold 13px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(locationName || '', PAD + 2, BANNER_H / 2)
    ctx.font      = `12px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillStyle = '#7DD4CF'
    ctx.fillText(dateLabel, totalW - PAD - 2, BANNER_H / 2)

    // ── Header ──
    let x = 0
    imgCols.forEach(col => {
      const w = cw(col)
      ctx.fillStyle = col.accent === 'teal' ? C.tealBg : col.accent === 'orange' ? C.orangeBg : C.navyBg
      ctx.fillRect(x, BANNER_H, w, HEADER_H)

      ctx.fillStyle = col.accent === 'teal' ? C.navyText : C.white
      ctx.font      = `bold 10px ${FONT}`
      const lines   = col.label.split('\n')
      const lineH   = 13
      const startY  = BANNER_H + HEADER_H / 2 - (lines.length - 1) * lineH / 2
      lines.forEach((line, li) => {
        fillText(line, col.align === 'left' ? x + PAD : x + w / 2, startY + li * lineH, col.align)
      })
      x += w
    })

    // ── Data rows ──
    rows.forEach((row, i) => {
      const y    = BANNER_H + HEADER_H + i * ROW_H
      const alt  = i % 2 === 0
      const { memberships_sold, opportunities, p_mix, conversion } = compute(row, opportunitiesFormula)
      const vals = {
        employee_name: row.employee_name || '',
        _time:  TIME_SLOTS[i]?.label || '',
        ...orderedCols.reduce((a, c) => ({ ...a, [c.key]: toInt(row[c.key]) > 0 ? String(row[c.key]) : '' }), {}),
        _ms:   memberships_sold > 0 ? String(memberships_sold) : '',
        _opp:  opportunities    > 0 ? String(opportunities)    : '',
        _pmix: p_mix       || '',
        _conv: conversion  || '',
      }

      let cx = 0
      imgCols.forEach(col => {
        const w   = cw(col)
        const val = vals[col.key]
        let cellBg, cellFg
        if (col.key === '_pmix') {
          cellBg = pmixBg(val); cellFg = pmixFg(val)
        } else if (col.key === '_conv') {
          cellBg = convBg(val); cellFg = convFg(val)
        } else {
          cellBg = col.accent === 'teal' ? C.tealCell : alt ? C.rowAlt : C.rowNorm
          cellFg = col.accent === 'teal' ? C.blueText : col.key === '_time' ? C.timeText : C.bodyText
        }
        ctx.fillStyle = cellBg
        ctx.fillRect(cx, y, w, ROW_H)

        if (val) {
          ctx.fillStyle = cellFg
          ctx.font = `${col.key === 'employee_name' ? '500' : '400'} 10px ${FONT}`
          fillText(val, col.align === 'left' ? cx + PAD : cx + w / 2, y + ROW_H / 2, col.align)
        }
        cx += w
      })
    })

    // ── Totals row ──
    const totY  = BANNER_H + HEADER_H + TIME_SLOTS.length * ROW_H
    const totVs = {
      employee_name: 'Totals', _time: '',
      ...orderedCols.reduce((a, c) => ({ ...a, [c.key]: totals[c.key] > 0 ? String(totals[c.key]) : '' }), {}),
      _ms:   totComputed.memberships_sold > 0 ? String(totComputed.memberships_sold) : '',
      _opp:  totComputed.opportunities    > 0 ? String(totComputed.opportunities)    : '',
      _pmix: totComputed.p_mix       || '',
      _conv: totComputed.conversion  || '',
    }
    let tx = 0
    imgCols.forEach(col => {
      const w   = cw(col)
      const val = totVs[col.key]
      let cellBg, cellFg
      if (col.key === '_pmix') {
        cellBg = pmixTotBg(val); cellFg = pmixFg(val)
      } else if (col.key === '_conv') {
        cellBg = convTotBg(val); cellFg = convFg(val)
      } else {
        cellBg = col.accent === 'teal' ? C.totTeal : C.totRow
        cellFg = C.blueText
      }
      ctx.fillStyle = cellBg
      ctx.fillRect(tx, totY, w, ROW_H)
      if (val) {
        ctx.fillStyle = cellFg
        ctx.font      = `bold 10px ${FONT}`
        fillText(val, col.align === 'left' ? tx + PAD : tx + w / 2, totY + ROW_H / 2, col.align)
      }
      tx += w
    })

    // ── Grid lines ──
    ctx.strokeStyle = C.grid
    ctx.lineWidth   = 0.5
    // Vertical — run full height but skip inside the banner
    let gx = 0
    imgCols.forEach(col => {
      ctx.beginPath(); ctx.moveTo(gx, BANNER_H); ctx.lineTo(gx, totalH); ctx.stroke()
      gx += cw(col)
    })
    ctx.beginPath(); ctx.moveTo(gx, BANNER_H); ctx.lineTo(gx, totalH); ctx.stroke()
    // Horizontal — banner bottom + header bottom + each row
    const hLines = [
      BANNER_H,
      BANNER_H + HEADER_H,
      ...Array.from({ length: TIME_SLOTS.length }, (_, i) => BANNER_H + HEADER_H + (i + 1) * ROW_H),
      totalH,
    ]
    hLines.forEach(gy => {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(totalW, gy); ctx.stroke()
    })
    ctx.strokeStyle = C.border
    ctx.lineWidth   = 1
    ctx.strokeRect(0.5, 0.5, totalW - 1, totalH - 1)

    // ── Copy to clipboard ──
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      } catch {
        // Fallback: TSV text
        const headerRow = ['Name', 'Time', ...orderedCols.map(c => c.label.replace('\n', ' ')), 'Memberships Sold', 'Opportunities', 'P-Mix', 'Conversion']
        const dataRows = TIME_SLOTS.map((slot, i) => {
          const row = rows[i]
          const { memberships_sold, opportunities, p_mix, conversion } = compute(row, opportunitiesFormula)
          return [
            row.employee_name || '', slot.label,
            ...orderedCols.map(col => toInt(row[col.key]) > 0 ? row[col.key] : ''),
            memberships_sold > 0 ? memberships_sold : '',
            opportunities    > 0 ? opportunities    : '',
            p_mix || '', conversion || '',
          ].join('\t')
        })
        await navigator.clipboard.writeText([headerRow.join('\t'), ...dataRows].join('\n'))
      }
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    }, 'image/png')
  }

  // ── Paste from table ──────────────────────────────────────────────────────────

  const applyPaste = (text) => {
    const parsed = parseTSV(text)
    if (parsed.length < 2) return { error: 'No data rows found — paste must include a header row and at least one data row.' }

    // Normalize headers: strip quotes, collapse whitespace
    const headers = parsed[0].map(h => h.replace(/[\n\r\s]+/g, ' ').trim().toLowerCase())
    const timeIdx = headers.findIndex(h => h === 'time')
    if (timeIdx < 0) return { error: 'No "Time" column found. Make sure the header row is included.' }

    const FIELD_MAP = {
      'name': 'employee_name',
      'google reviews': 'google_reviews',
      'total washes': 'total_washes',
      'member washes': 'member_washes',
      'basic': 'basic',
      'good': 'good',
      'better': 'better',
      'best': 'best',
      'net members': 'net_members',
    }
    const colMap = {}
    headers.forEach((h, i) => { if (FIELD_MAP[h]) colMap[i] = FIELD_MAP[h] })

    const snapshot = rowsRef.current.map(r => ({ ...r }))
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), snapshot]

    const next = [...rowsRef.current]
    let updated = 0
    parsed.slice(1).forEach(cells => {
      const slot = parseTimeToSlot(cells[timeIdx]?.trim())
      if (!slot) return
      const slotIdx = TIME_SLOTS.findIndex(s => s.value === slot)
      if (slotIdx < 0) return
      const updatedRow = { ...next[slotIdx] }
      Object.entries(colMap).forEach(([ci, field]) => {
        // blank cells paste as empty string — toInt treats '' as 0
        updatedRow[field] = cells[ci]?.trim() ?? ''
      })
      next[slotIdx] = updatedRow
      updated++
    })

    if (!updated) return { error: 'No matching time slots found (e.g. "8:00 AM", "1:00 PM").' }

    rowsRef.current = next
    setRows(next)
    next.forEach((_, idx) => {
      clearTimeout(saveTimers.current[idx])
      saveTimers.current[idx] = setTimeout(() => { delete saveTimers.current[idx]; doSave(idx) }, 100)
    })
  }

  // ── Column order ─────────────────────────────────────────────────────────────

  const persistColumnOrder = (newOrder) => {
    setColumnOrder(newOrder)
    localStorage.setItem(roleKey, JSON.stringify(newOrder))
    updateProfileSettings({ [roleKey]: newOrder })
  }

  const toggleViewMode = () => {
    const next = viewMode === 'table' ? 'card' : 'table'
    setViewMode(next)
    localStorage.setItem('tm_daily_view_mode', next)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const orderedCols = columnOrder
    .map(key => COLUMN_DEFS.find(c => c.key === key))
    .filter(Boolean)

  const latestRow   = shopTotals(rows)
  const totals      = latestRow ?? {}
  const totComputed = latestRow ? compute(latestRow, opportunitiesFormula) : {}

  const cardSlotIdx = TIME_SLOTS.findIndex(s => s.value === cardHour)
  const cardRow     = rows[cardSlotIdx >= 0 ? cardSlotIdx : 0] ?? emptyRow(cardHour)
  const cardComputed = compute(cardRow, opportunitiesFormula)

  const rowBg = (i) => i % 2 === 0
    ? 'bg-[#f0f9f8] dark:bg-tm-dark-row-alt'
    : 'bg-white dark:bg-tm-dark-surface'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={toggleViewMode}
            className="px-3 py-1.5 rounded-md border border-tm-teal/40 text-tm-blue dark:text-tm-teal bg-white dark:bg-tm-dark-surface hover:bg-tm-sky/20 dark:hover:bg-tm-teal/10 transition-colors font-brand text-xs font-semibold tracking-wide"
          >
            {viewMode === 'table' ? '≡ Switch to Card View' : '⊞ Switch to Table View'}
          </button>
          {canEdit && (
            <button
              onClick={() => setShowEditModal(true)}
              className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted bg-white dark:bg-tm-dark-surface hover:border-tm-teal hover:text-tm-blue dark:hover:text-tm-teal transition-colors font-brand text-xs font-semibold"
            >
              ✎ Employees
            </button>
          )}
          {canEdit && viewMode === 'table' && (
            <button
              onClick={() => setReorderMode(r => !r)}
              className={`px-3 py-1.5 rounded-md border font-brand text-xs font-semibold transition-colors ${
                reorderMode
                  ? 'bg-tm-teal text-tm-navy border-tm-teal'
                  : 'border-gray-200 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted bg-white dark:bg-tm-dark-surface hover:border-tm-teal hover:text-tm-blue dark:hover:text-tm-teal'
              }`}
            >
              ⠿ Columns
            </button>
          )}
          <button
            onClick={copyTableAsImage}
            className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted bg-white dark:bg-tm-dark-surface hover:border-tm-teal hover:text-tm-blue dark:hover:text-tm-teal transition-colors font-brand text-xs font-semibold"
          >
            {copyFeedback ? '✓ Copied!' : '⎘ Copy'}
          </button>
          {canEdit && (
            <button
              onClick={() => setShowPasteModal(true)}
              className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-tm-dark-border text-gray-600 dark:text-tm-dark-muted bg-white dark:bg-tm-dark-surface hover:border-tm-teal hover:text-tm-blue dark:hover:text-tm-teal transition-colors font-brand text-xs font-semibold"
            >
              ⎗ Paste Data
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saving.size > 0 && (
            <span className="text-xs text-tm-teal animate-pulse font-brand">Saving…</span>
          )}
          {canEdit && historyRef.current.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-tm-dark-muted font-brand select-none">
              Ctrl+Z · {historyRef.current.length} step{historyRef.current.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {saveError && (
        <div className="mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs rounded-lg">
          {saveError}
        </div>
      )}

      {/* ── Card View ─────────────────────────────────────────────────────────── */}
      {viewMode === 'card' && (
        <div className="max-w-md mx-auto">
          {/* Time + Employee header */}
          <div className="bg-gray-50 dark:bg-tm-dark-card border border-gray-200 dark:border-tm-dark-border rounded-xl px-3 pt-3 pb-3 mb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Hour
                </label>
                <select
                  className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-2 py-2 text-sm font-brand bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal w-full"
                  value={cardHour}
                  onChange={e => setCardHour(e.target.value)}
                >
                  {TIME_SLOTS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  Employee
                </label>
                {canEdit ? (
                  <div className="border border-gray-300 dark:border-tm-dark-border rounded-lg px-2 py-1.5 bg-white dark:bg-tm-dark-surface min-h-[38px] flex items-center">
                    <EmployeeSelect
                      value={cardRow.employee_name}
                      onChange={v => update(cardSlotIdx, 'employee_name', v)}
                      onBlur={() => saveImmediately(cardSlotIdx)}
                      employees={employees}
                      placeholder="Tap to select…"
                    />
                  </div>
                ) : (
                  <span className="text-sm font-brand text-gray-700 dark:text-tm-dark-text">
                    {cardRow.employee_name || '—'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Input grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              'google_reviews', 'total_washes',
              'member_washes',  'basic',
              'good',           'better',
              'best',           'net_members',
            ].map(field => {
              const def = COLUMN_DEFS.find(c => c.key === field)
              return (
                <div
                  key={field}
                  className="bg-white dark:bg-tm-dark-surface border border-gray-100 dark:border-tm-dark-border rounded-xl p-3 shadow-sm"
                >
                  <label className="block text-[10px] font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1 whitespace-pre-line leading-tight">
                    {def?.label ?? field}
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    className="w-full text-2xl font-semibold text-gray-800 dark:text-tm-dark-text bg-transparent border-none outline-none focus:bg-white dark:focus:bg-tm-dark-card rounded transition-colors min-h-[48px] disabled:cursor-default placeholder:text-gray-300 dark:placeholder:text-tm-dark-muted/40"
                    value={cardRow[field]}
                    disabled={!canEdit}
                    onChange={e => update(cardSlotIdx, field, e.target.value)}
                    onBlur={() => saveImmediately(cardSlotIdx)}
                  />
                </div>
              )
            })}
          </div>

          {/* Computed stats */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Memberships Sold', value: cardComputed.memberships_sold || '—' },
              { label: 'Opportunities',    value: cardComputed.opportunities    || '—' },
              { label: 'P-Mix',            value: cardComputed.p_mix            || '—' },
              { label: 'Conversion',       value: cardComputed.conversion       || '—' },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-tm-sky/20 dark:bg-tm-teal/10 border border-tm-sky/40 dark:border-tm-teal/20 rounded-xl p-3"
              >
                <div className="text-[10px] font-brand font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">
                  {label}
                </div>
                <div className="text-2xl font-bold text-tm-blue dark:text-tm-teal font-brand">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Table View ────────────────────────────────────────────────────────── */}
      {viewMode === 'table' && (
        <div ref={tableContainerRef} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs min-w-[1100px]">
            <thead>
              <tr className="bg-tm-blue dark:bg-tm-navy text-white">
                <th className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-left">
                  Name
                </th>
                <th className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-center">
                  Time
                </th>
                {orderedCols.map((col, colIdx) => (
                  <th
                    key={col.key}
                    draggable={reorderMode}
                    onDragStart={() => setDraggedIdx(colIdx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      if (draggedIdx === null || draggedIdx === colIdx) return
                      const newOrder = [...columnOrder]
                      const [moved] = newOrder.splice(draggedIdx, 1)
                      newOrder.splice(colIdx, 0, moved)
                      persistColumnOrder(newOrder)
                      setDraggedIdx(null)
                    }}
                    onDragEnd={() => setDraggedIdx(null)}
                    className={`px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold whitespace-pre-line leading-tight text-center transition-opacity
                      ${reorderMode ? 'cursor-grab select-none' : ''}
                      ${draggedIdx === colIdx ? 'opacity-40' : ''}
                    `}
                  >
                    {reorderMode && (
                      <span className="text-tm-teal/60 mr-1 text-[10px]">⠿</span>
                    )}
                    {col.label}
                  </th>
                ))}
                <th className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-center bg-[#8ECFCB] dark:bg-tm-teal/30 text-tm-navy dark:text-tm-dark-text whitespace-pre-line leading-tight">
                  {'Memberships\nSold'}
                </th>
                <th className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-center bg-[#8ECFCB] dark:bg-tm-teal/30 text-tm-navy dark:text-tm-dark-text">
                  Opportunities
                </th>
                <th className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-center bg-orange-600">
                  P-Mix
                </th>
                <th className="px-2 py-2 border border-tm-navy dark:border-tm-dark-border font-brand font-semibold text-center bg-orange-600">
                  Conversion
                </th>
              </tr>
            </thead>
            <tbody>
              {TIME_SLOTS.map((slot, i) => {
                const row = rows[i]
                const { memberships_sold, opportunities, p_mix, conversion } = compute(row, opportunitiesFormula)
                const dim = saving.has(i) ? 'opacity-60' : ''

                return (
                  <tr key={slot.value} className={`${rowBg(i)} ${dim}`}>
                    <td className="border border-gray-200 dark:border-tm-dark-border px-1 w-24">
                      {canEdit ? (
                        <EmployeeSelect
                          value={row.employee_name}
                          onChange={v => update(i, 'employee_name', v)}
                          onBlur={() => saveImmediately(i)}
                          employees={employees}
                        />
                      ) : (
                        <span className="px-1 text-gray-700 dark:text-tm-dark-text">{row.employee_name}</span>
                      )}
                    </td>
                    <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-medium text-gray-500 dark:text-tm-dark-muted w-20">
                      {slot.label}
                    </td>
                    {orderedCols.map((col, colIdx) => (
                      <td key={col.key} className="border border-gray-200 dark:border-tm-dark-border px-1">
                        <input
                          type="number"
                          min="0"
                          data-row={i}
                          data-col={colIdx}
                          className="w-full text-center py-1.5 bg-transparent focus:outline-none focus:bg-white dark:focus:bg-tm-dark-card rounded disabled:cursor-default text-gray-800 dark:text-tm-dark-text transition-colors"
                          value={row[col.key]}
                          disabled={!canEdit}
                          onChange={e => update(i, col.key, e.target.value)}
                          onBlur={() => saveImmediately(i)}
                          onKeyDown={e => handleCellKeyDown(e, i, colIdx)}
                        />
                      </td>
                    ))}
                    <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center bg-tm-sky/30 dark:bg-tm-teal/10 text-tm-blue dark:text-tm-dark-text font-semibold font-brand">
                      {memberships_sold > 0 ? memberships_sold : ''}
                    </td>
                    <td className="border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center bg-tm-sky/30 dark:bg-tm-teal/10 text-tm-blue dark:text-tm-dark-text font-semibold font-brand">
                      {opportunities > 0 ? opportunities : ''}
                    </td>
                    <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold ${pmixCls(p_mix, metricThresholds)}`}>
                      {p_mix}
                    </td>
                    <td className={`border border-gray-200 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold ${convCls(conversion, metricThresholds)}`}>
                      {conversion}
                    </td>
                  </tr>
                )
              })}

              <tr className="bg-tm-sky/25 dark:bg-tm-teal/10 font-semibold border-t-2 border-tm-teal/50">
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 font-brand dark:text-tm-dark-text">Totals</td>
                <td className="border border-gray-300 dark:border-tm-dark-border" />
                {orderedCols.map(col => (
                  <td key={col.key} className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center font-brand dark:text-tm-dark-text">
                    {totals[col.key] > 0 ? totals[col.key] : ''}
                  </td>
                ))}
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center bg-tm-teal/20 dark:bg-tm-teal/10 text-tm-blue dark:text-tm-dark-text font-brand">
                  {totComputed.memberships_sold > 0 ? totComputed.memberships_sold : ''}
                </td>
                <td className="border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center bg-tm-teal/20 dark:bg-tm-teal/10 text-tm-blue dark:text-tm-dark-text font-brand">
                  {totComputed.opportunities > 0 ? totComputed.opportunities : ''}
                </td>
                <td className={`border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold ${pmixTotalsCls(totComputed.p_mix, metricThresholds)}`}>
                  {totComputed.p_mix}
                </td>
                <td className={`border border-gray-300 dark:border-tm-dark-border px-2 py-1.5 text-center font-semibold ${convTotalsCls(totComputed.conversion, metricThresholds)}`}>
                  {totComputed.conversion}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Employees Modal */}
      {showEditModal && (
        <EditEmployeesModal
          locationId={locationId}
          onClose={() => setShowEditModal(false)}
          onRefresh={fetchEmployees}
        />
      )}

      {/* Paste Data Modal */}
      {showPasteModal && (
        <PasteModal
          onClose={() => setShowPasteModal(false)}
          onApply={applyPaste}
        />
      )}
    </div>
  )
}
