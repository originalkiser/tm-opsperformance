export default function DateSelector({ value, onChange }) {
  const getDateStr = (daysAgo) => {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().split('T')[0]
  }

  const options = [
    { label: 'Today', date: getDateStr(0) },
    { label: 'Yesterday', date: getDateStr(1) },
    { label: '-2 Days', date: getDateStr(2) },
    { label: '-3 Days', date: getDateStr(3) },
  ]

  return (
    <div className="flex gap-1 items-center">
      <span className="text-xs text-gray-500 mr-1 hidden sm:block">Date:</span>
      {options.map(({ label, date }) => (
        <button
          key={date}
          onClick={() => onChange(date)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            value === date
              ? 'bg-blue-700 text-white shadow-sm'
              : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {label}
        </button>
      ))}
      <span className="ml-2 text-xs text-gray-400 hidden md:block">
        {new Date(value + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
      </span>
    </div>
  )
}
