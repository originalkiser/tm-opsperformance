import { useState, useEffect } from 'react'
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

const NUM_FIELDS = [
  'google_reviews', 'total_washes', 'member_washes', 'opportunities',
  'basic', 'good', 'better', 'best', 'memberships_sold', 'net_members',
]

const emptyRow = (timeSlot) =>
  NUM_FIELDS.reduce((acc, f) => ({ ...acc, [f]: '' }), { time_slot: timeSlot, employee_name: '' })

const toInt = (v) => parseInt(v) || 0

export default function DailyLogTable({ locationId, selectedDate, canEdit }) {
  const [rows, setRows] = useState(TIME_SLOTS.map(s => emptyRow(s.value)))
  const [employees, setEmployees] = useState([])
  const [saving, setSaving] = useState(new Set())

  useEffect(() => {
    fetchData()
    fetchEmployees()
  }, [locationId, selectedDate])

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, name')
      .eq('location_id', locationId)
      .eq('is_active', true)
      .order('name')
    setEmployees(data || [])
  }

  const fetchData = async () => {
    const { data } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('location_id', locationId)
      .eq('log_date', selectedDate)

    setRows(TIME_SLOTS.map(slot => {
      const existing = data?.find(d => d.time_slot === slot.value)
      if (!existing) return emptyRow(slot.value)
      return {
        ...existing,
        ...NUM_FIELDS.reduce((acc, f) => ({ ...acc, [f]: existing[f] ?? '' }), {}),
        employee_name: existing.employee_name ?? '',
      }
    }))
  }

  const update = (index, field, value) =>
    setRows(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })

  const saveRow = async (index) => {
    if (!canEdit) return
    const row = rows[index]
    setSaving(prev => new Set([...prev, index]))

    await supabase.from('daily_logs').upsert(
      {
        location_id: locationId,
        log_date: selectedDate,
        time_slot: row.time_slot,
        employee_name: row.employee_name || null,
        ...NUM_FIELDS.reduce((acc, f) => ({ ...acc, [f]: toInt(row[f]) }), {}),
      },
      { onConflict: 'location_id,log_date,time_slot' }
    )

    setSaving(prev => { const n = new Set(prev); n.delete(index); return n })
  }

  const clearDay = async () => {
    if (!window.confirm('Clear all entries for this day? This cannot be undone.')) return
    await supabase
      .from('daily_logs')
      .delete()
      .eq('location_id', locationId)
      .eq('log_date', selectedDate)
    setRows(TIME_SLOTS.map(s => emptyRow(s.value)))
  }

  // Column totals
  const totals = NUM_FIELDS.reduce((acc, f) => ({
    ...acc,
    [f]: rows.reduce((sum, r) => sum + toInt(r[f]), 0),
  }), {})
  const totalPMix = totals.total_washes
    ? ((totals.member_washes / totals.total_washes) * 100).toFixed(1) + '%'
    : ''
  const totalConv = totals.opportunities
    ? ((totals.memberships_sold / totals.opportunities) * 100).toFixed(1) + '%'
    : ''

  const pMix = (row) => {
    const tw = toInt(row.total_washes), mw = toInt(row.member_washes)
    return tw ? ((mw / tw) * 100).toFixed(1) + '%' : ''
  }
  const conv = (row) => {
    const opp = toInt(row.opportunities), sold = toInt(row.memberships_sold)
    return opp ? ((sold / opp) * 100).toFixed(1) + '%' : ''
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[1050px]">
          <thead>
            <tr className="bg-blue-700 text-white">
              {[
                ['Name', 'text-left w-24'],
                ['Time', 'w-20'],
                ['Google Reviews', ''],
                ['Total Washes', ''],
                ['Member Washes', ''],
                ['Opportunities', ''],
                ['Basic', ''],
                ['Good', ''],
                ['Better', ''],
                ['Best', ''],
                ['Memberships Sold', ''],
                ['Net Members', ''],
              ].map(([label, cls]) => (
                <th key={label} className={`px-2 py-2 border border-blue-600 font-semibold ${cls}`}>
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 border border-blue-600 font-semibold bg-red-700">P-Mix</th>
              <th className="px-2 py-2 border border-blue-600 font-semibold bg-red-700">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {TIME_SLOTS.map((slot, i) => {
              const row = rows[i]
              const bg = i % 2 === 0 ? 'bg-blue-50' : 'bg-white'
              const dim = saving.has(i) ? 'opacity-60' : ''
              return (
                <tr key={slot.value} className={`${bg} ${dim}`}>
                  {/* Name */}
                  <td className="border border-gray-200 px-1">
                    {canEdit ? (
                      <>
                        <input
                          list={`emp-${i}`}
                          className="w-full py-1.5 px-1 bg-transparent focus:outline-none focus:bg-white rounded text-xs"
                          value={row.employee_name}
                          onChange={e => update(i, 'employee_name', e.target.value)}
                          onBlur={() => saveRow(i)}
                          placeholder="Name..."
                        />
                        <datalist id={`emp-${i}`}>
                          {employees.map(e => <option key={e.id} value={e.name} />)}
                        </datalist>
                      </>
                    ) : (
                      <span className="px-1">{row.employee_name}</span>
                    )}
                  </td>
                  {/* Time */}
                  <td className="border border-gray-200 px-2 py-1.5 text-center font-medium text-gray-500">
                    {slot.label}
                  </td>
                  {/* Numeric fields */}
                  {NUM_FIELDS.map(f => (
                    <td key={f} className="border border-gray-200 px-1">
                      <input
                        type="number"
                        min="0"
                        className="w-full text-center py-1.5 bg-transparent focus:outline-none focus:bg-white rounded disabled:cursor-default"
                        value={row[f]}
                        disabled={!canEdit}
                        onChange={e => update(i, f, e.target.value)}
                        onBlur={() => saveRow(i)}
                      />
                    </td>
                  ))}
                  {/* Calculated */}
                  <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold bg-orange-50 text-orange-800">
                    {pMix(row)}
                  </td>
                  <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold bg-orange-50 text-orange-800">
                    {conv(row)}
                  </td>
                </tr>
              )
            })}
            {/* Totals row */}
            <tr className="bg-blue-100 font-semibold border-t-2 border-blue-300">
              <td className="border border-gray-300 px-2 py-1.5 text-xs">Totals</td>
              <td className="border border-gray-300" />
              {NUM_FIELDS.map(f => (
                <td key={f} className="border border-gray-300 px-2 py-1.5 text-center text-xs">
                  {totals[f] > 0 ? totals[f] : ''}
                </td>
              ))}
              <td className="border border-gray-300 px-2 py-1.5 text-center text-xs bg-orange-100 text-orange-800">
                {totalPMix}
              </td>
              <td className="border border-gray-300 px-2 py-1.5 text-center text-xs bg-orange-100 text-orange-800">
                {totalConv}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="mt-4">
          <button
            onClick={clearDay}
            className="bg-red-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Clear Content — New Day
          </button>
        </div>
      )}
    </div>
  )
}
