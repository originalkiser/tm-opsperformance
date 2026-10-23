import { useState } from 'react'
import { TEXT_OPERATORS, NUMBER_OPERATORS, PRESENCE_OPERATORS, activeFilter, moveColumn } from '../utils/performanceColumns.js'

const control = 'rounded border border-gray-300 dark:border-tm-dark-border bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text p-2 min-h-[40px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-tm-teal'
export default function KpiTableControls({ columns, config, update, reset, unsaved }) {
  const [announcement, setAnnouncement] = useState('')
  const ordered = config.order.map(key => columns.find(c => c.key === key)).filter(Boolean)
  const move = (key, before) => {
    update(previous => ({ ...previous, order: moveColumn(previous.order, key, before) }))
    setAnnouncement(`Moved ${columns.find(c => c.key === key)?.label} before ${columns.find(c => c.key === before)?.label}.`)
  }
  const step = (key, delta) => {
    const index = ordered.findIndex(c => c.key === key), target = ordered[index + delta]
    if (key === 'name' || !target || target.key === 'name') return
    if (delta < 0) move(key, target.key)
    else move(target.key, key)
  }
  const filter = (key, patch) => update(previous => ({ ...previous, filters: { ...previous.filters,
    [key]: { ...previous.filters[key], ...patch } } }))
  return <details className="mb-3 rounded-lg border border-gray-200 dark:border-tm-dark-border p-3 text-gray-800 dark:text-tm-dark-text">
    <summary className="cursor-pointer font-brand font-semibold text-sm min-h-[32px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-tm-teal">Columns &amp; filters</summary>
    <p className="text-xs my-2">Drag a column handle to reorder. Use move buttons on touch screens, or focus a handle and press Arrow Up/Down. Location stays first and visible. Filters compare displayed values. Percentage filters use percentage points (e.g. 25 for 25%). Hiding a column clears its filter.</p>
    <div className="flex flex-wrap gap-2 mb-3">
      <button type="button" className={control} onClick={() => { reset(); setAnnouncement('Default columns, filters and sorting restored.') }}>Reset to Default</button>
      <button type="button" className={control} onClick={() => update(previous => ({ ...previous, filters: {} }))}>Clear filters</button>
    </div>
    {unsaved && <p role="status" className="text-xs mb-2">Browser storage is unavailable. Preferences apply for this session only.</p>}
    <ul className="space-y-2">
      {ordered.map((column, index) => {
        const key = column.key, hidden = config.hidden.includes(key)
        const rule = config.filters[key] || { op: column.type === 'text' ? 'contains' : 'gte', value: '' }
        const presence = ['missing', 'present'].includes(rule.op)
        const invalid = column.type !== 'text' && !presence && rule.value.trim() !== '' && !activeFilter(rule, column)
        return <li key={key} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-tm-dark-border p-2"
          onDragOver={event => { if (key !== 'name') event.preventDefault() }}
          onDrop={event => { event.preventDefault(); const from = event.dataTransfer.getData('text/plain'); if (from !== 'name' && key !== 'name' && ordered.some(c => c.key === from)) move(from, key) }}>
          <button type="button" draggable={key !== 'name'} disabled={key === 'name'} className={`${control} disabled:opacity-40 cursor-grab`}
            aria-label={`Move ${column.label}`} title="Drag to reorder or use Arrow Up/Down"
            onDragStart={event => { event.dataTransfer.setData('text/plain', key); event.dataTransfer.effectAllowed = 'move' }}
            onKeyDown={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); step(key, event.key === 'ArrowUp' ? -1 : 1) } }}>⠿</button>
          <label className="flex items-center gap-2 min-w-[170px] min-h-[40px] text-xs font-semibold">
            <input type="checkbox" checked={!hidden} disabled={key === 'name'} onChange={event => update(previous => ({ ...previous,
              hidden: event.target.checked ? previous.hidden.filter(k => k !== key) : [...previous.hidden, key],
              filters: Object.fromEntries(Object.entries(previous.filters).filter(([k]) => k !== key)),
            }))} />{column.label}{key === 'name' ? ' (always visible)' : ''}
          </label>
          <button type="button" className={`${control} disabled:opacity-40`} aria-label={`Move ${column.label} up`} disabled={index <= 1} onClick={() => step(key, -1)}>↑</button>
          <button type="button" className={`${control} disabled:opacity-40`} aria-label={`Move ${column.label} down`} disabled={key === 'name' || index === ordered.length - 1} onClick={() => step(key, 1)}>↓</button>
          <select className={`${control} text-xs max-w-full`} aria-label={`${column.label} filter operator`} value={rule.op} disabled={hidden} onChange={event => filter(key, { op: event.target.value })}>
            {[...(column.type === 'text' ? TEXT_OPERATORS : NUMBER_OPERATORS), ...PRESENCE_OPERATORS].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {!presence && <input className={`${control} text-xs w-36 max-w-full`} type="text" inputMode={column.type === 'text' ? 'text' : 'decimal'}
            aria-label={`${column.label} filter value`} aria-invalid={invalid || undefined} disabled={hidden} value={rule.value}
            placeholder={column.type === 'percent' ? 'e.g. 25%' : column.type === 'text' ? 'Search text' : 'Enter number'}
            onChange={event => filter(key, { value: event.target.value, op: rule.op })} />}
          {invalid && <span role="status" className="text-xs text-red-700 dark:text-red-300">Enter a valid number; this filter is not applied.</span>}
        </li>
      })}
    </ul>
    <p aria-live="polite" aria-atomic="true" className="text-xs mt-2">{announcement}</p>
  </details>
}
