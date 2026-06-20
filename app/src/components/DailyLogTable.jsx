import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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

const INPUT_FIELDS = [
  'google_reviews', 'total_washes', 'member_washes',
  'basic', 'good', 'better', 'best', 'net_members',
]

const toInt = (v) => Math.max(0, parseInt(v) || 0)

const emptyRow = (timeSlot) =>
  INPUT_FIELDS.reduce((acc, f) => ({ ...acc, [f]: '' }), {
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
  const opportunities =
    formula === 'simple'
      ? Math.max(0, tw - mw)                     // Option 1: TW − MW
      : Math.max(0, tw - mw - memberships_sold)  // Option 2: TW − MW − MS

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

export default function DailyLogTable({ locationId, selectedDate, canEdit, opportunitiesFormula = 'detailed', onRowsChange }) {
  const [rows, setRows]     = useState(TIME_SLOTS.map(s => emptyRow(s.value)))
  const [employees, setEmps] = useState([])
  const [saving, setSaving]  = useState(new Set())
  const [saveError, setSaveError] = useState(null)

  const rowsRef    = useRef(rows)
  rowsRef.current  = rows
  const saveTimers = useRef({})

  // Always-current refs so the unmount cleanup closes over live values
  const locationIdRef  = useRef(locationId)
  const dateRef        = useRef(selectedDate)
  const canEditRef     = useRef(canEdit)
  const formulaRef     = useRef(opportunitiesFormula)

  useEffect(() => { locationIdRef.current = locationId }, [locationId])
  useEffect(() => { dateRef.current = selectedDate },     [selectedDate])
  useEffect(() => { canEditRef.current = canEdit },       [canEdit])
  useEffect(() => { formulaRef.current = opportunitiesFormula }, [opportunitiesFormula])

  useEffect(() => { onRowsChange?.(rows) }, [rows])

  useEffect(() => {
    fetchData()
    fetchEmployees()
  }, [locationId, selectedDate])

  // On unmount: flush any pending debounced saves immediately
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
      .eq('location_id', locationId)
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
        // Skip phantom rows (no name, all zeros) left over from before the save guard
        const hasData = existing.employee_name ||
          INPUT_FIELDS.some(f => (existing[f] ?? 0) > 0)
        if (!hasData) return emptyRow(slot.value)
        return {
          ...existing,
          ...INPUT_FIELDS.reduce((acc, f) => ({ ...acc, [f]: existing[f] ?? '' }), {}),
          employee_name: existing.employee_name ?? '',
        }
      })
    )
  }

  const update = (index, field, value) => {
    setRows(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
    clearTimeout(saveTimers.current[index])
    saveTimers.current[index] = setTimeout(() => {
      delete saveTimers.current[index]
      doSave(index)
    }, 800)
  }

  const saveImmediately = (index) => {
    clearTimeout(saveTimers.current[index])
    delete saveTimers.current[index]
    doSave(index)
  }

  const doSave = useCallback(async (index) => {
    if (!canEditRef.current) return
    const row = rowsRef.current[index]
    if (!row) return
    // Don't write empty rows to the database
    const hasData = row.employee_name?.trim() || INPUT_FIELDS.some(f => toInt(row[f]) > 0)
    if (!hasData) return
    const { memberships_sold, opportunities } = compute(row, formulaRef.current)

    setSaving(prev => new Set([...prev, index]))
    const { error } = await supabase.from('daily_logs').upsert(
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
    if (error) {
      console.error('Save failed:', error)
      setSaveError(`Save failed: ${error.message}`)
      setTimeout(() => setSaveError(null), 5000)
    }
    setSaving(prev => { const n = new Set(prev); n.delete(index); return n })
  }, []) // stable — uses refs for all live values

  // Version used in unmount cleanup (avoids stale closure issue)
  const flushSave = useCallback(async (index) => {
    if (!canEditRef.current) return
    const row = rowsRef.current[index]
    if (!row) return
    const hasData = row.employee_name?.trim() || INPUT_FIELDS.some(f => toInt(row[f]) > 0)
    if (!hasData) return
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

  const totals      = INPUT_FIELDS.reduce((acc, f) => ({ ...acc, [f]: rows.reduce((s, r) => s + toInt(r[f]), 0) }), {})
  const totComputed = compute(totals, opportunitiesFormula)

  const HEADERS = [
    'Name', 'Time', 'Google\nReviews', 'Total\nWashes', 'Member\nWashes',
    'Basic', 'Good', 'Better', 'Best', 'Net\nMembers',
    'Memberships\nSold', 'Opportunities', 'P-Mix', 'Conversion',
  ]

  return (
    <div>
      {saveError && (
        <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
          {saveError}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[1100px]">
          <thead>
            <tr className="bg-tm-blue text-white">
              {HEADERS.map((h, i) => (
                <th
                  key={h}
                  className={`px-2 py-2 border border-tm-navy font-brand font-semibold whitespace-pre-line leading-tight
                    ${i === 0 ? 'text-left' : 'text-center'}
                    ${i >= 10 && i <= 11 ? 'bg-[#8ECFCB] text-tm-navy' : ''}
                    ${i >= 12 ? 'bg-orange-600' : ''}
                  `}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIME_SLOTS.map((slot, i) => {
              const row = rows[i]
              const { memberships_sold, opportunities, p_mix, conversion } = compute(row, opportunitiesFormula)
              const bg  = i % 2 === 0 ? 'bg-[#f0f9f8]' : 'bg-white'
              const dim = saving.has(i) ? 'opacity-60' : ''

              return (
                <tr key={slot.value} className={`${bg} ${dim}`}>
                  <td className="border border-gray-200 px-1 w-24">
                    {canEdit ? (
                      <>
                        <input
                          list={`emp-${i}`}
                          className="w-full py-1.5 px-1 bg-transparent focus:outline-none focus:bg-white rounded text-xs"
                          value={row.employee_name}
                          onChange={e => update(i, 'employee_name', e.target.value)}
                          onBlur={() => saveImmediately(i)}
                          placeholder="Name…"
                        />
                        <datalist id={`emp-${i}`}>
                          {employees.map(e => <option key={e.id} value={e.name} />)}
                        </datalist>
                      </>
                    ) : (
                      <span className="px-1">{row.employee_name}</span>
                    )}
                  </td>
                  <td className="border border-gray-200 px-2 py-1.5 text-center font-medium text-gray-500 w-20">
                    {slot.label}
                  </td>
                  {INPUT_FIELDS.map(f => (
                    <td key={f} className="border border-gray-200 px-1">
                      <input
                        type="number"
                        min="0"
                        className="w-full text-center py-1.5 bg-transparent focus:outline-none focus:bg-white rounded disabled:cursor-default"
                        value={row[f]}
                        disabled={!canEdit}
                        onChange={e => update(i, f, e.target.value)}
                        onBlur={() => saveImmediately(i)}
                      />
                    </td>
                  ))}
                  <td className="border border-gray-200 px-2 py-1.5 text-center bg-tm-sky/30 text-tm-blue font-semibold font-brand">
                    {memberships_sold > 0 ? memberships_sold : ''}
                  </td>
                  <td className="border border-gray-200 px-2 py-1.5 text-center bg-tm-sky/30 text-tm-blue font-semibold font-brand">
                    {opportunities > 0 ? opportunities : ''}
                  </td>
                  <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold">
                    {p_mix}
                  </td>
                  <td className="border border-gray-200 px-2 py-1.5 text-center bg-orange-50 text-orange-800 font-semibold">
                    {conversion}
                  </td>
                </tr>
              )
            })}

            <tr className="bg-tm-sky/25 font-semibold border-t-2 border-tm-teal/50">
              <td className="border border-gray-300 px-2 py-1.5 font-brand">Totals</td>
              <td className="border border-gray-300" />
              {INPUT_FIELDS.map(f => (
                <td key={f} className="border border-gray-300 px-2 py-1.5 text-center font-brand">
                  {totals[f] > 0 ? totals[f] : ''}
                </td>
              ))}
              <td className="border border-gray-300 px-2 py-1.5 text-center bg-tm-teal/20 text-tm-blue font-brand">
                {totComputed.memberships_sold > 0 ? totComputed.memberships_sold : ''}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-center bg-tm-teal/20 text-tm-blue font-brand">
                {totComputed.opportunities > 0 ? totComputed.opportunities : ''}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">
                {totComputed.p_mix}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-center bg-orange-100 text-orange-800">
                {totComputed.conversion}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {saving.size > 0 && (
        <p className="mt-2 text-xs text-tm-teal animate-pulse font-brand">Saving…</p>
      )}
    </div>
  )
}
