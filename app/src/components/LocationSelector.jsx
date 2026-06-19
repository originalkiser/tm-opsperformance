export default function LocationSelector({ locations, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 hidden sm:block">Location:</label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[180px]"
      >
        <option value="">— Select Location —</option>
        {locations.map(loc => (
          <option key={loc.id} value={loc.id}>
            {loc.name}
          </option>
        ))}
      </select>
    </div>
  )
}
