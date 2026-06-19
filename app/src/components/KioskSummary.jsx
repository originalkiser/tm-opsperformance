import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const NUM_FIELDS = ['total_washes', 'member_washes', 'opportunities', 'sold', 'premium_sold']

const emptyData = () =>
  NUM_FIELDS.reduce((acc, f) => ({ ...acc, [f]: '' }), { kiosk_name: '' })

const toInt = (v) => parseInt(v) || 0

export default function KioskSummary({ locationId, selectedDate, canEdit }) {
  const [data, setData] = useState(emptyData())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [locationId, selectedDate])

  const fetchData = async () => {
    const { data: row } = await supabase
      .from('kiosk_summaries')
      .select('*')
      .eq('location_id', locationId)
      .eq('log_date', selectedDate)
      .maybeSingle()

    if (row) {
      setData({
        kiosk_name: row.kiosk_name ?? '',
        ...NUM_FIELDS.reduce((acc, f) => ({ ...acc, [f]: row[f] ?? '' }), {}),
      })
    } else {
      setData(emptyData())
    }
  }

  const update = (field, value) => setData(prev => ({ ...prev, [field]: value }))

  const save = async () => {
    if (!canEdit) return
    setSaving(true)
    await supabase.from('kiosk_summaries').upsert(
      {
        location_id: locationId,
        log_date: selectedDate,
        kiosk_name: data.kiosk_name || null,
        ...NUM_FIELDS.reduce((acc, f) => ({ ...acc, [f]: toInt(data[f]) }), {}),
      },
      { onConflict: 'location_id,log_date' }
    )
    setSaving(false)
  }

  const tw = toInt(data.total_washes)
  const mw = toInt(data.member_washes)
  const opp = toInt(data.opportunities)
  const sold = toInt(data.sold)
  const pMix = tw ? ((mw / tw) * 100).toFixed(1) + '%' : '0%'
  const conversion = opp ? ((sold / opp) * 100).toFixed(1) + '%' : '0%'

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wide">
        Kiosk Summary
      </h3>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr className="bg-gray-700 text-white">
              {['Kiosk', 'Total Washes', 'Member Washes', 'Opportunities', 'Sold', 'Premium Sold'].map(h => (
                <th key={h} className="px-3 py-2 border border-gray-600 font-semibold">{h}</th>
              ))}
              <th className="px-3 py-2 border border-gray-600 font-semibold bg-red-700">P-Mix</th>
              <th className="px-3 py-2 border border-gray-600 font-semibold bg-red-700">Conversion</th>
            </tr>
          </thead>
          <tbody>
            <tr className={`bg-gray-50 ${saving ? 'opacity-60' : ''}`}>
              <td className="border border-gray-200 px-1 min-w-[90px]">
                {canEdit ? (
                  <input
                    className="w-full py-1.5 px-1 bg-transparent focus:outline-none focus:bg-white rounded"
                    value={data.kiosk_name}
                    onChange={e => update('kiosk_name', e.target.value)}
                    onBlur={save}
                    placeholder="Kiosk..."
                  />
                ) : (
                  <span className="px-1">{data.kiosk_name}</span>
                )}
              </td>
              {NUM_FIELDS.map(f => (
                <td key={f} className="border border-gray-200 px-1">
                  <input
                    type="number"
                    min="0"
                    className="w-full text-center py-1.5 bg-transparent focus:outline-none focus:bg-white rounded disabled:cursor-default min-w-[80px]"
                    value={data[f]}
                    disabled={!canEdit}
                    onChange={e => update(f, e.target.value)}
                    onBlur={save}
                  />
                </td>
              ))}
              <td className="border border-gray-200 px-3 py-1.5 text-center font-semibold bg-orange-50 text-orange-800 min-w-[60px]">
                {pMix}
              </td>
              <td className="border border-gray-200 px-3 py-1.5 text-center font-semibold bg-orange-50 text-orange-800 min-w-[70px]">
                {conversion}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
